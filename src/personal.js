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

// 딜이 이 사람 조건에 맞으면 사유 문자열, 아니면 null
export function personalReason(d, p) {
  if (!p || d.price == null) return null;
  const title = d.title;
  for (const t of p.targets ?? []) {
    if (title.includes(t.kw) && d.price > 0 && d.price <= t.max)
      return `🎯 목표가 도달 — "${t.kw}" ${t.max.toLocaleString('ko-KR')}원 이하`;
  }
  const kw = (p.keywords ?? []).find(k => title.includes(k));
  if (kw && d.ai?.verdict !== '비추천' && !(d.danawa && d.danawa.diffPct > 0)) return `🔔 내 키워드 "${kw}"`;
  return null;
}
