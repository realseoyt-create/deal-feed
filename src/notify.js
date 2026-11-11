import { danawaLookup, sameProduct, cleanQuery } from './danawa.js';

// notified: 0 미판정 · 1 발송 · 2 대상이었으나 텔레그램 미설정 · 3 다나와 확인 결과 탈락
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HOUR = 3600e3;

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
  if (d.recommend >= (a.hotRecommend ?? 3)) return { reason: `👍 추천 ${d.recommend}`, maxDiff: 0, needCompare: false };
  if ((a.categories ?? []).includes(d.category) && d.price != null && d.price <= (a.maxPrice ?? Infinity))
    return { reason: `관심 카테고리 ${d.category}`, maxDiff: minDisc, needCompare: false };
  if (d.views_per_min >= hotV) return { reason: `🔥 조회 상위 (${d.views_per_min}/분)`, maxDiff: minDisc, needCompare: true };
  return null;
}

const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const won = n => n.toLocaleString('ko-KR') + '원';

async function send(token, chatId, html) {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!r.ok) throw new Error(`telegram ${r.status} ${await r.text()}`);
}

export async function notifyPending(deals, { telegram, alerts = {} }) {
  const hotV = hotThreshold(deals, alerts);
  let sent = 0, dropped = 0;
  for (const d of deals) {
    if (d.notified !== 0 || Date.now() - new Date(d.first_seen) > 3 * HOUR) continue;
    const c = candidate(d, alerts, hotV);
    if (!c) continue; // 미달 → 반응이 오르면 다음 실행에 재검사

    // 다나와 확인 (후보만, 1.5초 간격) — 같은 상품으로 보이는 결과만 비교
    let diff = null;
    if (d.price) {
      try {
        const q = cleanQuery(d.product || d.title);
        const r = await danawaLookup(d.product || d.title);
        const m = r.items.find(i => sameProduct(q, i.name));
        if (m) {
          diff = Math.round((d.price - m.price) / m.price * 100);
          d.danawa = { price: m.price, name: m.name, url: m.url, diffPct: diff };
        }
        await sleep(1500);
      } catch (e) { console.error('[danawa]', e.message); }
    }
    const pass = diff == null ? !c.needCompare : diff <= c.maxDiff;
    if (!pass) { d.notified = 3; dropped++; continue; }
    d.alert = c.reason;

    if (!telegram?.botToken || !telegram?.chatId) { d.notified = 2; continue; }
    const price = d.price == null ? '' : d.price === 0 ? ' · 무료' : ` · <b>${won(d.price)}</b>`;
    const dnLine = diff == null ? '다나와 비교 불가'
      : `다나와 ${won(d.danawa.price)} 대비 <b>${diff <= 0 ? `${-diff}% 쌈` : `${diff}% 비쌈`}</b> (${esc(d.danawa.name.slice(0, 30))})`;
    const msg = `${esc(c.reason)}\n[${esc(d.mall ?? '')}] ${esc(d.product || d.title)}${price}${d.shipping ? ` (${esc(d.shipping)})` : ''}\n${dnLine}\n${esc(d.url)}`;
    try { await send(telegram.botToken, telegram.chatId, msg); d.notified = 1; sent++; }
    catch (e) { console.error('[notify]', e.message); break; }
  }
  console.log(`[notify] 발송 ${sent}건, 다나와 탈락 ${dropped}건 (조회 기준 ${hotV}/분)`);
  return sent;
}
