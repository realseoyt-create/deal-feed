import { danawaLookup, sameProduct, cleanQuery } from './danawa.js';
import { judgeMatch, hasGemini } from './gemini.js';
import { send, esc } from './telegram.js';

// notified: 0 미판정 · 1 발송 · 2 대상이었으나 텔레그램 미설정 · 3 다나와 확인 결과 탈락
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HOUR = 3600e3;
const won = n => n.toLocaleString('ko-KR') + '원';

// 최근 24시간 글의 분당 조회수 상위 N% 기준값 (표본이 적으면 설정값)
export function hotThreshold(deals, a) {
  const vs = deals.filter(d => Date.now() - new Date(d.first_seen) < 24 * HOUR).map(d => d.views_per_min).sort((x, y) => x - y);
  const fallback = a.hotViewsPerMin ?? 30;
  if (vs.length < 30) return fallback;
  return Math.max(fallback, vs[Math.floor(vs.length * (1 - (a.hotTopPercent ?? 10) / 100))]);
}

export function candidate(d, a, hotV) {
  if (d.excluded_hint || (a.excludeKeywords ?? []).some(k => d.title.includes(k))) return null;
  const minDisc = -(a.minDiscountPct ?? 10);
  const kw = (a.keywords ?? []).find(k => d.title.includes(k));
  if (kw) return { reason: `키워드 "${kw}"`, maxDiff: 0, needCompare: false };
  if (d.hist?.lowest && d.hist.count >= 1) return { reason: `📉 뽐뿌 역대 최저 (이전 ${won(d.hist.prevMin)})`, maxDiff: 0, needCompare: false };
  if (d.recommend >= (a.hotRecommend ?? 3)) return { reason: `👍 추천 ${d.recommend}`, maxDiff: 0, needCompare: false };
  if ((a.categories ?? []).includes(d.category) && d.price != null && d.price <= (a.maxPrice ?? Infinity))
    return { reason: `관심 카테고리 ${d.category}`, maxDiff: minDisc, needCompare: false };
  if (d.views_per_min >= hotV) return { reason: `🔥 조회 상위 (${d.views_per_min}/분)`, maxDiff: minDisc, needCompare: true };
  return null;
}

// 다나와 비교 1건 → d.danawa 저장. 한 번 확인한 딜은 다시 조회 안 함
async function checkDanawa(d) {
  if (d.danawa_checked || !d.price) return d.danawa?.diffPct ?? null;
  d.danawa_checked = true;
  try {
    const q = cleanQuery(d.product || d.title);
    const r = await danawaLookup(d.product || d.title);
    await sleep(1500);
    // 가격이 0.1~5배 범위 밖이면 애초에 후보 제외
    const cands = r.items.filter(i => d.price / i.price >= 0.1 && d.price / i.price <= 5).slice(0, 5);
    if (!cands.length) return null;

    let m = null, ratio = 1, by = 'rule';
    if (hasGemini()) {
      try {
        const j = await judgeMatch(d.title, d.price, cands);
        if (j && j.match >= 0 && j.confidence >= 0.6) { m = cands[j.match]; ratio = j.ratio; by = 'ai'; }
        else if (j) return null; // AI가 "같은 상품 없음" → 비교 안 함
      } catch (e) { console.error('[gemini]', e.message); }
    }
    if (!m) {
      m = cands.find(i => sameProduct(q, i.name) && d.price / i.price >= 0.15 && d.price / i.price <= 3);
      if (!m) return null;
    }
    const ref = Math.round(m.price * ratio);           // 딜과 같은 총량 기준 다나와 가격
    const diffPct = Math.round((d.price - ref) / ref * 100);
    if (diffPct < -85 || diffPct > 200) return null;   // 비현실적인 차이는 오매칭으로 간주
    d.danawa = { price: ref, unitPrice: m.price, ratio, name: m.name, url: m.url, diffPct, by };
    return diffPct;
  } catch (e) { console.error('[danawa]', e.message); return null; }
}

// 화면 표시용: 반응이 중간 이상인 최근 딜을 실행당 최대 N건 비교 (대량 조회 방지)
export async function enrichDanawa(deals, limit = 12) {
  // 규칙 매칭 결과는 규칙이 강화되면 재검증 (AI 판정 결과는 유지)
  for (const d of deals) {
    if (d.danawa && d.danawa.by !== 'ai' && (!sameProduct(cleanQuery(d.product || d.title), d.danawa.name) || !d.price)) delete d.danawa;
  }
  const recent = deals.filter(d => Date.now() - new Date(d.posted_at) < 6 * HOUR);
  const vs = recent.map(d => d.views_per_min).sort((a, b) => a - b);
  const median = vs.length ? vs[Math.floor(vs.length / 2)] : 0;
  const targets = recent
    .filter(d => !d.danawa_checked && d.price > 0 && d.views_per_min >= median)
    .sort((a, b) => b.views_per_min - a.views_per_min)
    .slice(0, limit);
  for (const d of targets) await checkDanawa(d);
  console.log(`[danawa] 표시용 비교 ${targets.length}건 (${hasGemini() ? 'AI 매칭' : '규칙 매칭'})`);
}

export async function notifyPending(deals, { telegram, alerts = {} }) {
  const hotV = hotThreshold(deals, alerts);
  let sent = 0, dropped = 0;
  for (const d of deals) {
    if (d.notified !== 0 || Date.now() - new Date(d.first_seen) > 3 * HOUR) continue;
    const c = candidate(d, alerts, hotV);
    if (!c) continue; // 미달 → 반응이 오르면 다음 실행에 재검사

    const diff = await checkDanawa(d);
    const pass = diff == null ? !c.needCompare : diff <= c.maxDiff;
    if (!pass) { d.notified = 3; dropped++; continue; }
    d.alert = c.reason;

    if (!telegram?.botToken || !telegram?.chatId) { d.notified = 2; continue; }
    const price = d.price == null ? '' : d.price === 0 ? ' · 무료' : ` · <b>${won(d.price)}</b>`;
    const dnLine = diff == null ? '다나와 비교 불가'
      : `다나와 ${won(d.danawa.price)} 대비 <b>${diff <= 0 ? `${-diff}% 쌈` : `${diff}% 비쌈`}</b>${d.danawa.ratio !== 1 ? ` (수량 ×${d.danawa.ratio} 환산)` : ''}`;
    const histLine = d.hist ? `\n뽐뿌 이전 최저 ${won(d.hist.prevMin)} (${d.hist.count}회)` : '';
    const msg = `${esc(c.reason)}\n[${esc(d.mall ?? '')}] ${esc(d.product || d.title)}${price}${d.shipping ? ` (${esc(d.shipping)})` : ''}\n${dnLine}${histLine}\n${esc(d.url)}`;
    try { await send(telegram, msg); d.notified = 1; sent++; }
    catch (e) { console.error('[notify]', e.message); break; }
  }
  console.log(`[notify] 발송 ${sent}건, 다나와 탈락 ${dropped}건 (조회 기준 ${hotV}/분)`);
  return sent;
}
