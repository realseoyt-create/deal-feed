import { danawaLookup, sameProduct, cleanQuery } from './danawa.js';
import { judgeMatch, categorizeBatch, extractPoints, genQueries, hasGemini, budgetOk } from './gemini.js';
import { productKey } from './history.js';
import { personalReason, hid } from './personal.js';
import { send, broadcast, esc } from './telegram.js';

// notified: 0 미판정 · 1 발송 · 2 대상이었으나 텔레그램 미설정 · 3 다나와 확인 결과 탈락 · 4 방해 금지 시간이라 대기 중
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HOUR = 3600e3;
const won = n => n.toLocaleString('ko-KR') + '원';
const WEB = 'https://realseoyt-create.github.io/deal-feed/';

// 최근 24시간 글의 분당 조회수 상위 N% 기준값 (표본이 적으면 설정값)
export function hotThreshold(deals, a) {
  const vs = deals.filter(d => Date.now() - new Date(d.first_seen) < 24 * HOUR).map(d => d.views_per_min).sort((x, y) => x - y);
  const fallback = a.hotViewsPerMin ?? 30;
  if (vs.length < 30) return fallback;
  return Math.max(fallback, vs[Math.floor(vs.length * (1 - (a.hotTopPercent ?? 10) / 100))]);
}

export function candidate(d, a, hotV) {
  if (d.ended || d.excluded_hint || (a.excludeKeywords ?? []).some(k => d.title.includes(k))) return null;
  const minDisc = -(a.minDiscountPct ?? 10);
  if (d.ai?.verdict === '강력추천') return { reason: `🏆 AI 강력추천 — ${d.ai.reason}`, maxDiff: 0, needCompare: false };
  if (d.ai?.verdict === '비추천') return null; // AI가 비추천하면 다른 조건에 걸려도 보내지 않음
  const kw = (a.keywords ?? []).find(k => d.title.includes(k));
  if (kw) return { reason: `키워드 "${kw}"`, maxDiff: 0, needCompare: false };
  if (d.hist?.lowest && d.hist.count >= 1) return { reason: `📉 뽐뿌 역대 최저 (이전 ${won(d.hist.prevMin)})`, maxDiff: 0, needCompare: false };
  if (d.recommend >= (a.hotRecommend ?? 3)) return { reason: `👍 추천 ${d.recommend}`, maxDiff: 0, needCompare: false };
  if ((a.categories ?? []).includes(d.category) && d.price != null && d.price <= (a.maxPrice ?? Infinity))
    return { reason: `관심 카테고리 ${d.category}`, maxDiff: minDisc, needCompare: false };
  if (d.views_per_min >= hotV) return { reason: `🔥 조회 상위 (${d.views_per_min}/분)`, maxDiff: minDisc, needCompare: true };
  return null;
}

// 한국 시간 기준 방해 금지 시간인지
export function isQuiet(q, now = new Date()) {
  if (!q || q.start == null || q.end == null) return false;
  const h = (now.getUTCHours() + 9) % 24;
  return q.start <= q.end ? (h >= q.start && h < q.end) : (h >= q.start || h < q.end);
}

// AI로 카테고리 분류 (아직 AI가 안 본 딜만, 1회 호출로 최대 40건)
export async function aiCategorize(deals) {
  const targets = deals.filter(d => d.cat_by !== 'ai').slice(0, 40);
  if (!hasGemini() || !targets.length || !budgetOk('lite', 'low')) return;
  try {
    const cats = await categorizeBatch(targets.map(d => d.title));
    if (!cats) return;
    targets.forEach((d, i) => { if (cats[i]) { d.category = cats[i]; d.cat_by = 'ai'; } });
    console.log(`[category] AI 분류 ${targets.length}건`);
  } catch (e) { console.error('[category]', e.message); }
}

// 본문 앞부분에서 구매 포인트 추출 (아직 안 뽑은 딜만, 1회 호출 최대 15건)
export async function aiTips(deals) {
  const targets = deals.filter(d => d._body && !d.tips).slice(0, 15);
  if (!hasGemini() || !targets.length || !budgetOk('lite', 'low')) return;
  try {
    const out = await extractPoints(targets);
    if (!out) return;
    targets.forEach((d, i) => {
      const o = out[i] ?? {};
      const clip = (s, n) => String(s ?? '').trim().slice(0, n);
      d.tips = {
        points: (Array.isArray(o.points) ? o.points : []).map(p => clip(p, 24)).filter(Boolean).slice(0, 3),
        unit: clip(o.unit, 20), caution: clip(o.caution, 20),
      };
    });
    console.log(`[tips] 구매 포인트 ${targets.length}건 (포인트 있음 ${targets.filter(d => d.tips?.points.length).length}건)`);
  } catch (e) { console.error('[tips]', e.message); }
}

// AI 검색어 준비: 아직 검색어가 없는 딜을 묶어서 1회 호출 (최대 20건)
export async function prepareQueries(deals) {
  // 예전 방식(제목 그대로 검색)으로 실패했던 최근 딜도 새 검색어로 한 번 더 시도
  const retry = d => d.danawa_checked && !d.danawa && !d.danawa_wrong && Date.now() - new Date(d.posted_at) < 6 * HOUR;
  const targets = deals.filter(d => d.price > 0 && !d.dq && (!d.danawa_checked || retry(d))).slice(0, 20);
  if (!hasGemini() || !targets.length) return;
  try {
    const out = await genQueries(targets.map(d => d.title));
    if (!out) return;
    targets.forEach((d, i) => { d.dq = out[i]; if (retry(d)) d.danawa_checked = false; });
    console.log(`[query] 검색어 ${targets.length}건 (비교 불가 ${out.filter(o => !o.comparable).length}건)`);
  } catch (e) { console.error('[query]', e.message); }
}

// 같은 상품의 다나와 비교 결과 재사용 (상품 키 기준 3일) — 조회·AI 호출 절약
const CACHE_TTL = 3 * 24 * HOUR;
let dnCache = {};
export const setDanawaCache = c => { dnCache = c ?? {}; };
export function pruneDanawaCache() {
  for (const k of Object.keys(dnCache)) if (Date.now() - dnCache[k].at > CACHE_TTL) delete dnCache[k];
  return dnCache;
}

// 다나와 상품명의 브랜드(첫 단어)가 딜 제목에 없으면 "같은 상품"이라 볼 수 없음 → similar 로 낮춤
// 예: "국내산 볶음김치" ↔ "종가 볶음 김치" (브랜드 다름)
const GENERIC_HEAD = /^(\(주\)|주식회사|농업회사법인|영농조합법인|국내산|국산|햇|신선)$/;
function brandInTitle(name, title) {
  const words = name.split(/\s+/).filter(w => !GENERIC_HEAD.test(w));
  const brand = words[0];
  if (!brand || brand.length < 2) return true;
  const norm = s => s.toLowerCase().replace(/[\s\-_]/g, '');
  return norm(title).includes(norm(brand));
}

// "할인 확정 근거"로 쓸 수 있는 비교인지: 같은 상품(exact)만 인정, 비슷한 상품은 참고용
export const confirmedOff = d => (d.danawa && d.danawa.type !== 'similar' ? -d.danawa.diffPct : null);

function applyMatch(d, m, ratio, by, type) {
  if (type !== 'similar' && !brandInTitle(m.name, d.title)) type = 'similar';
  const ref = Math.round(m.price * ratio);           // 딜과 같은 총량 기준 다나와 가격
  const diffPct = Math.round((d.price - ref) / ref * 100);
  if (diffPct < -85 || diffPct > 200) return null;   // 비현실적인 차이는 오매칭으로 간주
  d.danawa = { price: ref, unitPrice: m.price, ratio, name: m.name, url: m.url, diffPct, by, type };
  return diffPct;
}

// 다나와 비교 1건 → d.danawa 저장. 한 번 확인한 딜은 다시 조회 안 함
async function checkDanawa(d) {
  if (d.danawa_wrong) return null;                       // 사용자가 "비교 틀림" 표시
  if (d.danawa_checked || !d.price) return d.danawa?.diffPct ?? null;
  if (d.dq && !d.dq.comparable) { d.danawa_checked = true; return null; } // 묶음·여행 등 비교 무의미

  // 같은 상품을 최근에 비교했으면 그 결과 재사용 (단, 같은 구성 비율일 때)
  const key = productKey(d.product || d.title);
  const hit = key && dnCache[key];
  if (hit) { d.danawa_checked = true; return applyMatch(d, hit.item, hit.ratio, 'cache', hit.type); }

  d.danawa_checked = true;
  try {
    const q = cleanQuery(d.product || d.title);
    const r = await danawaLookup(d.product || d.title, d.dq?.query);
    await sleep(1500);
    // 가격이 0.03~5배 범위 밖이면 후보 제외 (낱개↔박스 비교를 위해 아래쪽은 넉넉히)
    const cands = r.items.filter(i => d.price / i.price >= 0.03 && d.price / i.price <= 5).slice(0, 5);
    if (!cands.length) return null;

    let m = null, ratio = 1, by = 'rule', type = 'exact';
    if (hasGemini()) {
      try {
        const j = await judgeMatch(d.title, d.price, cands);
        const minConf = j?.type === 'similar' ? 0.5 : 0.6;
        if (j && j.match >= 0 && j.confidence >= minConf) { m = cands[j.match]; ratio = j.ratio; by = 'ai'; type = j.type; }
        else if (j) return null; // AI가 "맞는 상품 없음" → 비교 안 함
      } catch (e) { console.error('[gemini]', e.message); }
    }
    if (!m) {
      m = cands.find(i => sameProduct(q, i.name) && d.price / i.price >= 0.15 && d.price / i.price <= 3);
      if (!m) return null;
    }
    const diff = applyMatch(d, m, ratio, by, type);
    if (diff != null && key && by === 'ai') dnCache[key] = { item: { name: m.name, url: m.url, price: m.price }, ratio, type, at: Date.now() };
    return diff;
  } catch (e) { console.error('[danawa]', e.message); return null; }
}

// 화면 표시용: 반응이 중간 이상인 최근 딜을 실행당 최대 N건 비교 (대량 조회 방지)
export async function enrichDanawa(deals, limit = 8, budgetMs = 150e3) {
  const t0 = Date.now();
  for (const d of deals) {
    // 기존 결과에도 브랜드 검사 소급 적용
    if (d.danawa && d.danawa.type !== 'similar' && !brandInTitle(d.danawa.name, d.title)) d.danawa.type = 'similar';
    if (!d.danawa || d.danawa.by === 'ai' || d.danawa.by === 'cache') continue;
    if (hasGemini()) d.recheck = true;                                                             // 규칙 매칭 결과는 AI로 다시 판정 (실제 검사 직전에 교체)
    else if (!sameProduct(cleanQuery(d.product || d.title), d.danawa.name) || !d.price) delete d.danawa;
  }
  const recent = deals.filter(d => Date.now() - new Date(d.posted_at) < 6 * HOUR);
  const vs = recent.map(d => d.views_per_min).sort((a, b) => a - b);
  const median = vs.length ? vs[Math.floor(vs.length / 2)] : 0;
  const targets = [
    ...deals.filter(d => d.recheck),
    // 비교 가능한 딜 우선, 그다음 반응 순 (반응 기준은 중간값의 절반까지 완화해 커버리지 확대)
    ...recent.filter(d => !d.recheck && !d.danawa_checked && !d.danawa_wrong && d.price > 0 && d.dq?.comparable !== false && d.views_per_min >= median / 2)
      .sort((a, b) => b.views_per_min - a.views_per_min),
  ].slice(0, limit);
  // Actions 실행 시간 제한을 넘지 않도록 시간 예산 안에서만 처리, 남은 건 다음 실행으로
  let done = 0;
  for (const d of targets) {
    if (Date.now() - t0 > budgetMs) break;
    if (d.recheck) {
      if (!hasGemini()) break;                         // AI가 쉬는 중이면 재검증은 다음 실행으로
      const prev = d.danawa;
      delete d.danawa; d.danawa_checked = false;
      await checkDanawa(d);
      if (!d.danawa && !d.danawa_checked) d.danawa = prev; // 호출 자체가 안 됐으면 원복
    } else await checkDanawa(d);
    delete d.recheck; done++;
  }
  // 재검증 대상인데 이번에 못 한 딜은 표시를 유지해 다음 실행에 처리
  console.log(`[danawa] 표시용 비교 ${done}/${targets.length}건 ${Math.round((Date.now() - t0) / 1000)}초 (${hasGemini() ? 'AI 매칭' : '규칙 매칭'})`);
}

function dealLines(d) {
  const price = d.price == null ? '' : d.price === 0 ? ' · 무료' : ` · <b>${won(d.price)}</b>`;
  const dn = d.danawa
    ? `\n${d.danawa.type === 'similar' ? '(참고) 비슷한 상품 ' : ''}다나와 ${won(d.danawa.price)} 대비 <b>${d.danawa.diffPct <= 0 ? `${-d.danawa.diffPct}% 쌈` : `${d.danawa.diffPct}% 비쌈`}</b>${d.danawa.ratio !== 1 ? ` (수량 ×${d.danawa.ratio} 환산)` : ''}\n<i>비교: ${esc(d.danawa.name.slice(0, 40))}</i>`
    : '';
  const hist = d.hist ? `\n뽐뿌 이전 최저 ${won(d.hist.prevMin)} (${d.hist.count}회)` : '';
  const ai = d.ai && !String(d.alert ?? '').includes('AI 강력추천') ? `\n🤖 AI ${d.ai.verdict} ${d.ai.score}점: ${esc(d.ai.reason)}` : '';
  const t = d.tips;
  const tips = t && (t.points.length || t.unit || t.caution)
    ? `\n💡 ${esc([...t.points, t.unit].filter(Boolean).join(' · '))}${t.caution ? `\n⚠️ ${esc(t.caution)}` : ''}`
    : '';
  // 본문 앞부분은 비공개 텔레그램에만 (공개 웹·저장소에는 없음)
  const body = d._body ? `\n<blockquote>${esc(d._body.slice(0, 160))}${d._body.length > 160 ? '…' : ''}</blockquote>` : '';
  return `[${esc(d.mall ?? '')}] ${esc(d.product || d.title)}${price}${d.shipping ? ` (${esc(d.shipping)})` : ''}${dn}${hist}${tips}${ai}${body}`;
}

function dealButtons(d) {
  const row = [{ text: '뽐뿌 글 보기', url: d.url }];
  if (d.danawa) row.push({ text: '다나와 보기', url: d.danawa.url });
  return d.danawa ? [row, [{ text: '❌ 비교가 틀렸어요', callback_data: `wrong:${d.id}` }]] : [row];
}

// subs: 구독자 배열 — 탈퇴(봇 차단)한 사람은 여기서 제거됨
export async function notifyPending(deals, { telegram, alerts = {}, quietHours, targets }, subs = []) {
  const hotV = hotThreshold(deals, alerts);
  const quiet = isQuiet(quietHours);
  const canSend = telegram?.botToken && telegram?.chatId;
  let sent = 0, dropped = 0, queued = 0;
  const subIds = () => subs.map(s => String(s.id)).filter(id => id !== String(telegram?.chatId));
  const prune = gone => { for (const id of gone) { const i = subs.findIndex(s => String(s.id) === id); if (i >= 0) subs.splice(i, 1); } };
  // 관리자에게는 "비교 틀림" 버튼 포함, 구독자에게는 링크 버튼만
  const sendAll = async (html, ownerButtons, subButtons) => {
    await send(telegram, html, ownerButtons);
    prune(await broadcast(telegram, subIds(), html, subButtons).catch(() => []));
  };

  // 방해 금지가 끝났으면 밤사이 대기 딜을 한 번에 발송
  const waiting = deals.filter(d => d.notified === 4);
  if (waiting.length && !quiet && canSend) {
    const top = waiting.slice(0, 10);
    const body = top.map(d => `• ${esc(d.alert ?? '')}\n<a href="${esc(d.url)}">${esc((d.product || d.title).slice(0, 45))}</a>${d.price ? ` · <b>${won(d.price)}</b>` : ''}${d.danawa ? ` · 다나와 대비 ${d.danawa.diffPct <= 0 ? -d.danawa.diffPct + '% 쌈' : d.danawa.diffPct + '% 비쌈'}` : ''}`).join('\n\n');
    const more = waiting.length > top.length ? `\n\n외 ${waiting.length - top.length}건` : '';
    try {
      const btn = [[{ text: '웹에서 전체 보기', url: WEB }]];
      await sendAll(`🌙 <b>방해 금지 시간에 모인 딜 ${waiting.length}건</b>\n\n${body}${more}`, btn, btn);
      waiting.forEach(d => { d.notified = 1; });
      sent += waiting.length;
    } catch (e) { console.error('[notify]', e.message); }
  }

  for (const d of deals) {
    if (d.notified !== 0 || Date.now() - new Date(d.first_seen) > 3 * HOUR) continue;
    const c = candidate(d, alerts, hotV);
    if (!c) continue; // 미달 → 반응이 오르면 다음 실행에 재검사

    await checkDanawa(d);
    // 비슷한 상품 비교는 참고용 → 통과 판정에는 같은 상품(exact) 비교만 사용
    const conf = confirmedOff(d);
    const diff = conf == null ? null : -conf;
    const pass = diff == null ? !c.needCompare : diff <= c.maxDiff;
    if (!pass) { d.notified = 3; dropped++; continue; }
    d.alert = c.reason;

    if (!canSend) { d.notified = 2; continue; }
    if (quiet) { d.notified = 4; queued++; continue; }
    try {
      const html = `${c.reason.startsWith('🏆') ? `<b>${esc(c.reason)}</b>` : esc(c.reason)}\n${dealLines(d)}`;
      await sendAll(html, dealButtons(d), [dealButtons(d)[0]]);
      d.notified = 1; sent++;
    }
    catch (e) { console.error('[notify]', e.message); break; }
  }
  // ── 개인 알림: 사람마다 키워드·목표가 (공통 알림으로 이미 받은 딜은 제외) ──
  let personal = 0;
  if (canSend && !quiet) {
    const people = [
      { id: String(telegram.chatId), p: { keywords: [], targets: targets ?? [] } }, // 관리자 키워드는 공통 알림에서 처리
      ...subs.filter(s => String(s.id) !== String(telegram.chatId)).map(s => ({ id: String(s.id), p: s })),
    ];
    for (const d of deals) {
      if (d.notified === 1 || d.ended || Date.now() - new Date(d.first_seen) > 3 * HOUR) continue;
      for (const { id, p } of people) {
        const reason = personalReason(d, p);
        const h = hid(id);
        if (!reason || d.ps?.includes(h)) continue;
        try {
          await send({ ...telegram, chatId: id }, `${esc(reason)}\n${dealLines(d)}`, [dealButtons(d)[0]]);
          d.ps = [...(d.ps ?? []), h]; personal++;
          if (reason.startsWith('🎯')) d.targetHit = true;
        } catch (e) {
          if (/telegram 403/.test(e.message)) prune([id]);
          else console.error('[personal]', e.message.slice(0, 120));
        }
      }
    }
  }
  console.log(`[notify] 발송 ${sent}건, 개인 ${personal}건, 다나와 탈락 ${dropped}건, 방해금지 대기 ${queued}건 (조회 기준 ${hotV}/분)`);
  return sent;
}
