// 개인 알림: 사람마다 다른 키워드·가격 목표 (관리자 = settings.json, 구독자 = 암호화된 구독자 목록)
import { createHash } from 'node:crypto';

// 공개 파일에 채팅 ID를 남기지 않기 위해 발송 기록은 해시로 저장
export const hid = id => createHash('sha256').update(`deal-feed:${id}`).digest('hex').slice(0, 10);

// "생수 10000" / "생수 1만" / "생수 9,900원" → { kw, max }
export function parseTarget(arg) {
  const m = String(arg).trim().match(/^(.+?)\s+([\d,.]+)\s*(만)?\s*원?$/);
  if (!m) return null;
  let n = Number(m[2].replace(/,/g, ''));
  if (m[3]) n *= 10000;
  if (!(n > 0) || !m[1].trim()) return null;
  return { kw: m[1].trim().slice(0, 30), max: Math.round(n) };
}

// "휴지 60" / "휴지 60일" → { kw, days }
export function parseCycle(arg) {
  const m = String(arg).trim().match(/^(.+?)\s+(\d{1,3})\s*일?$/);
  if (!m) return null;
  const days = Number(m[2]);
  return days >= 7 && days <= 365 ? { kw: m[1].trim().slice(0, 30), days } : null;
}

// 재구매 주기 알림: 하루 1번(오전 9시 이후) 확인 → 주기가 된 품목이면 최근 3일 딜 중 싼 것과 함께 알림
// people: [{ id, p }] (p.cycles = [{kw, days, last}]). 반환: 알림 보낸 수
export async function cycleReminders(state, people, sendTo) {
  const kst = new Date(Date.now() + 9 * 3600e3);
  const ymd = kst.toISOString().slice(0, 10);
  if (kst.getUTCHours() < 9 || state.lastCycleCheck === ymd) return 0;
  state.lastCycleCheck = ymd;
  const DAY = 86400e3;
  let n = 0;
  for (const { id, p } of people) {
    for (const c of p.cycles ?? []) {
      if (Date.now() - new Date(c.last).getTime() < c.days * DAY) continue;
      const deals = state.deals
        .filter(d => d.title.includes(c.kw) && !d.ended && (d.eff ?? d.price) > 0 && Date.now() - new Date(d.posted_at) < 3 * DAY)
        .sort((a, b) => (a.eff ?? a.price) - (b.eff ?? b.price)).slice(0, 3);
      const list = deals.length
        ? deals.map(d => `• <a href="${d.url}">${(d.product || d.title).slice(0, 40).replace(/[<>&]/g, '')}</a> ${(d.eff ?? d.price).toLocaleString('ko-KR')}원`).join('\n')
        : '최근 3일 안에 올라온 딜은 없어요. 키워드로 알림을 걸어두면 뜰 때 알려드려요.';
      try {
        const kw = c.kw.replace(/[<>&]/g, ''); // 사용자 입력 → HTML 안전하게
        await sendTo(id, `🔁 <b>${kw}</b> 살 때가 됐어요 (${c.days}일 주기)\n\n${list}\n\n샀으면 /bought ${kw}`);
        c.last = new Date().toISOString(); // 다시 주기만큼 뒤에 알림 (/bought 로도 초기화)
        n++;
      } catch (e) { console.error('[cycle]', e.message.slice(0, 100)); }
    }
  }
  return n;
}

// 딜이 이 사람 조건에 맞으면 사유 문자열, 아니면 null
export function personalReason(d, p) {
  if (!p || d.price == null) return null;
  const title = d.title;
  const pay = d.eff ?? d.price; // 실구매가(배송비 포함) 기준
  for (const t of p.targets ?? []) {
    if (title.includes(t.kw) && pay > 0 && pay <= t.max)
      return `🎯 목표가 도달 — "${t.kw}" ${t.max.toLocaleString('ko-KR')}원 이하`;
  }
  const kw = (p.keywords ?? []).find(k => title.includes(k));
  if (kw && d.ai?.verdict !== '비추천' && !(d.danawa && d.danawa.diffPct > 0)) return `🔔 내 키워드 "${kw}"`;
  return null;
}
