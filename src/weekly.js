// 주간 리포트: 일요일 20시(한국) 이후 첫 실행에서 1회, 이번 주 좋은 딜 TOP 5
// deals.json 은 3일만 보관하므로 좋은 딜만 state.best 에 8일간 따로 기록
import { broadcast, esc } from './telegram.js';
import { recipients } from './subs.js';

const DAY = 86400e3;
const won = n => n.toLocaleString('ko-KR') + '원';
const WEB = 'https://realseoyt-create.github.io/deal-feed/';

// 좋은 딜 점수: 다나와 할인율 + AI 점수 (근거 있는 것만)
function goodScore(d) {
  const off = d.danawa ? -d.danawa.diffPct : 0;
  if (off < 15 && d.ai?.verdict !== '강력추천' && !d.hist?.lowest) return null;
  return off + (d.ai?.score ?? 0) / 4 + (d.hist?.lowest ? 10 : 0);
}

export function recordBest(state) {
  const best = new Map((state.best ?? []).map(b => [b.id, b]));
  for (const d of state.deals) {
    const s = goodScore(d);
    if (s == null) continue;
    best.set(d.id, {
      id: d.id, title: (d.product || d.title).slice(0, 50), mall: d.mall, price: d.price, url: d.url,
      off: d.danawa ? -d.danawa.diffPct : null, verdict: d.ai?.verdict ?? null, reason: d.ai?.reason ?? null,
      lowest: !!d.hist?.lowest, score: Math.round(s), at: d.posted_at,
    });
  }
  state.best = [...best.values()].filter(b => Date.now() - new Date(b.at) < 8 * DAY);
}

export async function weeklyReport(state, tg, subs) {
  const kst = new Date(Date.now() + 9 * 3600e3);
  const ymd = kst.toISOString().slice(0, 10);
  if (kst.getUTCDay() !== 0 || kst.getUTCHours() < 20 || state.lastWeekly === ymd) return; // 일요일 20시 이후 1회
  if (!tg?.botToken || !tg?.chatId) return;
  const top = (state.best ?? []).filter(b => Date.now() - new Date(b.at) < 7 * DAY).sort((a, b) => b.score - a.score).slice(0, 5);
  state.lastWeekly = ymd;
  if (!top.length) return;
  const medal = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
  const body = top.map((b, i) => `${medal[i]} <a href="${esc(b.url)}">${esc(b.title)}</a>\n   ${b.price ? `<b>${won(b.price)}</b>` : ''}${b.off ? ` · 다나와보다 ${b.off}% 쌈` : ''}${b.lowest ? ' · 📉 뽐뿌 역대 최저' : ''}${b.verdict === '강력추천' ? ' · 🏆' : ''}`).join('\n\n');
  try {
    await broadcast(tg, recipients(tg, subs), `📅 <b>이번 주 역대급 딜 TOP ${top.length}</b>\n<i>대부분 끝났을 수 있어요 — 다음에 비슷한 가격이 뜨면 놓치지 마세요</i>\n\n${body}`, [[{ text: '웹에서 이번 주 딜 보기', url: WEB }]]);
    console.log(`[weekly] 주간 리포트 발송 (${top.length}건)`);
  } catch (e) { console.error('[weekly]', e.message); }
}
