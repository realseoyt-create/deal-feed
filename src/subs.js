// 알림 구독자 목록 — 공개 저장소이므로 AES-256-GCM으로 암호화해 저장
// 키는 봇 토큰(GitHub Secrets)에서 파생 → 별도 비밀값 불필요
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'subscribers.enc');
const keyOf = token => createHash('sha256').update(`deal-feed:subs:${token}`).digest();

// 반환: [{ id, name, at }]  (토큰 없거나 복호화 실패 시 빈 배열)
export function loadSubs(token) {
  if (!token || !existsSync(FILE)) return [];
  try {
    const raw = Buffer.from(readFileSync(FILE, 'utf8').trim(), 'base64');
    const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), data = raw.subarray(28);
    const d = createDecipheriv('aes-256-gcm', keyOf(token), iv);
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString('utf8'));
  } catch (e) {
    console.error('[subs] 복호화 실패:', e.message);
    return [];
  }
}

export function saveSubs(token, subs) {
  if (!token) return;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyOf(token), iv);
  const data = Buffer.concat([c.update(JSON.stringify(subs), 'utf8'), c.final()]);
  writeFileSync(FILE, Buffer.concat([iv, c.getAuthTag(), data]).toString('base64') + '\n');
}

// 알림 받을 채팅 목록: 관리자 + 구독자 (중복 제거)
export function recipients(tg, subs) {
  return [...new Set([tg.chatId, ...subs.map(s => s.id)].filter(Boolean).map(String))];
}
