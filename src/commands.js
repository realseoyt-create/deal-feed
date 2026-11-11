// 텔레그램 명령으로 settings.json 수정 (본인 채팅 ID에서 온 메시지만 처리)
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getUpdates, send, esc } from './telegram.js';

const SETTINGS = join(dirname(fileURLToPath(import.meta.url)), '..', 'settings.json');
const readS = () => JSON.parse(readFileSync(SETTINGS, 'utf8').replace(/^﻿/, ''));
const writeS = s => writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + '\n');

const HELP = `<b>꿀딜 봇 명령어</b>
/watch 단어 — 관심 키워드 추가
/unwatch 단어 — 키워드 삭제
/exclude 단어 — 제외어 추가
/include 단어 — 제외어 삭제
/min 숫자 — 다나와 대비 최소 할인율(%)
/maxprice 숫자 — 관심 카테고리 최대 가격(원)
/list — 현재 설정 보기
/status — 수집 상태
(반영은 다음 수집 때, 최대 10~20분)`;

function apply(cmd, arg, s) {
  const a = s.alerts;
  const uniq = arr => [...new Set(arr)];
  switch (cmd) {
    case '/watch': if (!arg) return '단어를 같이 보내주세요. 예: /watch 생수';
      a.keywords = uniq([...(a.keywords ?? []), arg]); return `✅ 키워드 추가: <b>${esc(arg)}</b>`;
    case '/unwatch': a.keywords = (a.keywords ?? []).filter(k => k !== arg); return `🗑 키워드 삭제: ${esc(arg)}`;
    case '/exclude': if (!arg) return '단어를 같이 보내주세요.';
      a.excludeKeywords = uniq([...(a.excludeKeywords ?? []), arg]); return `🚫 제외어 추가: ${esc(arg)}`;
    case '/include': a.excludeKeywords = (a.excludeKeywords ?? []).filter(k => k !== arg); return `제외어 삭제: ${esc(arg)}`;
    case '/min': { const n = Number(arg); if (!(n >= 0 && n <= 90)) return '0~90 사이 숫자로 보내주세요. 예: /min 15';
      a.minDiscountPct = n; return `✅ 최소 할인율 ${n}%`; }
    case '/maxprice': { const n = Number(String(arg).replace(/[,원]/g, '')); if (!(n > 0)) return '금액을 숫자로 보내주세요. 예: /maxprice 30000';
      a.maxPrice = n; return `✅ 관심 카테고리 최대 가격 ${n.toLocaleString('ko-KR')}원`; }
    default: return null;
  }
}

export async function handleCommands(state, tg) {
  let updates;
  try { updates = await getUpdates(tg, state.tgOffset ?? 0); } catch (e) { console.error('[cmd]', e.message); return; }
  if (!updates.length) return;
  state.tgOffset = updates.at(-1).update_id + 1;

  let s = readS(), changed = false;
  for (const u of updates) {
    const m = u.message;
    if (!m?.text || String(m.chat.id) !== String(tg.chatId)) continue; // 다른 사람 메시지 무시
    const [rawCmd, ...rest] = m.text.trim().split(/\s+/);
    const cmd = rawCmd.split('@')[0].toLowerCase(), arg = rest.join(' ').trim();
    let reply;
    if (cmd === '/start' || cmd === '/help') reply = HELP;
    else if (cmd === '/list') {
      const a = s.alerts;
      reply = `<b>현재 설정</b>\n키워드: ${esc((a.keywords ?? []).join(', ') || '없음')}\n제외어: ${esc((a.excludeKeywords ?? []).join(', ') || '없음')}\n관심 카테고리: ${esc((a.categories ?? []).join(', '))} (≤ ${(a.maxPrice ?? 0).toLocaleString('ko-KR')}원)\n최소 할인율: ${a.minDiscountPct}%\n조회 상위: ${a.hotTopPercent}% · 추천 ≥ ${a.hotRecommend}`;
    } else if (cmd === '/status') {
      const h = state.health ?? {};
      reply = `마지막 정상 수집: ${h.lastOk ? new Date(h.lastOk).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'}\n연속 실패: ${h.fails ?? 0}회\n보관 딜: ${state.deals.length}건`;
    } else {
      reply = apply(cmd, arg, s);
      if (reply?.startsWith('✅') || reply?.startsWith('🗑') || reply?.startsWith('🚫') || reply?.startsWith('제외어')) changed = true;
      reply ??= '모르는 명령이에요. /help';
    }
    try { await send(tg, reply); } catch (e) { console.error('[cmd]', e.message); }
  }
  if (changed) { writeS(s); console.log('[cmd] settings.json 변경'); }
}
