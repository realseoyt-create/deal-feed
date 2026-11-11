// 텔레그램 명령·버튼으로 설정 변경 (본인 채팅 ID에서 온 것만 처리)
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getUpdates, send, answerCallback, esc } from './telegram.js';
import { CATEGORIES } from './gemini.js';
import { parseTarget, parseCycle } from './personal.js';

const SETTINGS = join(dirname(fileURLToPath(import.meta.url)), '..', 'settings.json');
const readS = () => JSON.parse(readFileSync(SETTINGS, 'utf8').replace(/^﻿/, ''));
const writeS = s => writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + '\n');

const HELP = `<b>꿀딜 봇 명령어</b>
/watch 단어 — 관심 키워드 추가
/unwatch 단어 — 키워드 삭제
/exclude 단어 — 제외어 추가
/include 단어 — 제외어 삭제
/target 생수 10000 — 목표가 알림 (/untarget 생수 로 삭제)
/cycle 휴지 60 — 재구매 주기 알림 (/bought 휴지 로 초기화)
/cat 식품 — 관심 카테고리 켜기/끄기 (다시 보내면 해제)
/cat — 카테고리 목록과 현재 선택 보기
/min 숫자 — 다나와 대비 최소 할인율(%)
/maxprice 숫자 — 관심 카테고리 최대 가격(원)
/quiet 23 7 — 방해 금지 시간(23시~7시, 아침에 모아서 발송)
/quiet off — 방해 금지 끄기
/list — 현재 설정 보기
/status — 수집 상태
/subs — 구독자 수
(반영은 다음 수집 때, 최대 10~20분)`;

// 반환: { text, changed }
function apply(cmd, arg, s) {
  const a = s.alerts;
  const uniq = arr => [...new Set(arr)];
  const ok = text => ({ text, changed: true });
  const no = text => ({ text, changed: false });
  switch (cmd) {
    case '/watch': if (!arg) return no('단어를 같이 보내주세요. 예: /watch 생수');
      a.keywords = uniq([...(a.keywords ?? []), arg]); return ok(`✅ 키워드 추가: <b>${esc(arg)}</b>`);
    case '/unwatch': a.keywords = (a.keywords ?? []).filter(k => k !== arg); return ok(`🗑 키워드 삭제: ${esc(arg)}`);
    case '/exclude': if (!arg) return no('단어를 같이 보내주세요.');
      a.excludeKeywords = uniq([...(a.excludeKeywords ?? []), arg]); return ok(`🚫 제외어 추가: ${esc(arg)}`);
    case '/include': a.excludeKeywords = (a.excludeKeywords ?? []).filter(k => k !== arg); return ok(`제외어 삭제: ${esc(arg)}`);
    case '/cat': {
      const cur = a.categories ?? [];
      const list = CATEGORIES.map(c => `${cur.includes(c) ? '✅' : '▫️'} ${c}`).join('\n');
      if (!arg) return no(`<b>관심 카테고리</b> (✅ 선택됨)\n${list}\n\n예: /cat 식품`);
      const c = CATEGORIES.find(x => x === arg || x.startsWith(arg) || x.includes(arg));
      if (!c) return no(`없는 카테고리예요.\n${list}`);
      a.categories = cur.includes(c) ? cur.filter(x => x !== c) : [...cur, c];
      return ok(`${a.categories.includes(c) ? '✅ 관심 카테고리 추가' : '🗑 관심 카테고리 해제'}: <b>${esc(c)}</b>\n현재: ${esc(a.categories.join(', ') || '없음')}`);
    }
    case '/min': { const n = Number(arg); if (!(arg !== '' && n >= 0 && n <= 90)) return no('0~90 사이 숫자로 보내주세요. 예: /min 15');
      a.minDiscountPct = n; return ok(`✅ 최소 할인율 ${n}%`); }
    case '/maxprice': { const n = Number(String(arg).replace(/[,원]/g, '')); if (!(n > 0)) return no('금액을 숫자로 보내주세요. 예: /maxprice 30000');
      a.maxPrice = n; return ok(`✅ 관심 카테고리 최대 가격 ${n.toLocaleString('ko-KR')}원`); }
    case '/quiet': {
      if (/^(off|끄기|해제)$/i.test(arg)) { delete s.quietHours; return ok('🔔 방해 금지 해제 — 24시간 바로 알림'); }
      const [st, en] = arg.split(/[\s~\-]+/).map(Number);
      const valid = n => Number.isInteger(n) && n >= 0 && n <= 23;
      if (!valid(st) || !valid(en) || st === en) return no('시작·끝 시각을 0~23으로 보내주세요. 예: /quiet 23 7');
      s.quietHours = { start: st, end: en }; return ok(`🌙 방해 금지 ${st}시~${en}시 (그 사이 딜은 ${en}시 이후 모아서 발송)`);
    }
    default: return null;
  }
}

const WELCOME = `👋 <b>꿀딜 알림 구독 완료!</b>
뽐뿌에서 다나와보다 확실히 싸거나 AI가 강력추천한 딜이 올라오면 여기로 알려드려요.

<b>나만의 알림도 설정할 수 있어요</b>
/watch 기저귀 — 제목에 '기저귀'가 있으면 알림
/target 생수 10000 — '생수'가 1만원 이하로 뜨면 알림
/mylist — 내 설정 보기
/stop — 구독 해지

🌐 전체 목록: https://realseoyt-create.github.io/deal-feed/`;

const SUB_HELP = `<b>내 알림 명령어</b>
/watch 단어 — 내 키워드 추가 (최대 20개)
/unwatch 단어 — 키워드 삭제
/target 단어 가격 — 목표가 알림 (예: /target 휴지 15000)
/untarget 단어 — 목표가 삭제
/cycle 휴지 60 — 재구매 주기 알림 (60일마다)
/bought 휴지 — 샀어요 (주기 다시 시작)
/mylist — 내 설정 보기
/stop — 구독 해지`;

// 사람별 키워드·목표가 편집 (관리자·구독자 공용). p = { keywords, targets }
function applyPersonal(cmd, arg, p) {
  p.keywords ??= []; p.targets ??= [];
  switch (cmd) {
    case '/target': {
      const t = parseTarget(arg);
      if (!t) return { text: '이렇게 보내주세요: /target 생수 10000 (단어 + 가격)', changed: false };
      if (p.targets.length >= 20 && !p.targets.some(x => x.kw === t.kw)) return { text: '목표가는 20개까지예요.', changed: false };
      p.targets = [...p.targets.filter(x => x.kw !== t.kw), t];
      return { text: `🎯 목표가 등록: <b>${esc(t.kw)}</b> ${t.max.toLocaleString('ko-KR')}원 이하로 뜨면 알려드려요`, changed: true };
    }
    case '/untarget':
      p.targets = p.targets.filter(x => x.kw !== arg);
      return { text: `🗑 목표가 삭제: ${esc(arg)}`, changed: true };
    case '/cycle': {
      const c = parseCycle(arg);
      if (!c) return { text: '이렇게 보내주세요: /cycle 휴지 60 (단어 + 7~365일)', changed: false };
      p.cycles ??= [];
      if (p.cycles.length >= 10 && !p.cycles.some(x => x.kw === c.kw)) return { text: '재구매 주기는 10개까지예요.', changed: false };
      p.cycles = [...p.cycles.filter(x => x.kw !== c.kw), { ...c, last: new Date().toISOString() }];
      return { text: `🔁 재구매 주기 등록: <b>${esc(c.kw)}</b> ${c.days}일마다 그동안 올라온 싼 딜과 함께 알려드려요\n샀으면 /bought ${esc(c.kw)}`, changed: true };
    }
    case '/bought': {
      const c = (p.cycles ?? []).find(x => x.kw === arg);
      if (!c) return { text: `"${esc(arg)}" 주기가 없어요. /mylist 로 확인`, changed: false };
      c.last = new Date().toISOString();
      return { text: `✅ ${esc(arg)} 구매 기록! ${c.days}일 뒤에 다시 알려드릴게요`, changed: true };
    }
    case '/uncycle':
      p.cycles = (p.cycles ?? []).filter(x => x.kw !== arg);
      return { text: `🗑 재구매 주기 삭제: ${esc(arg)}`, changed: true };
    case '/mylist':
      return {
        text: `<b>내 알림 설정</b>\n키워드: ${esc(p.keywords.join(', ') || '없음')}\n목표가: ${p.targets.map(t => `${esc(t.kw)} ≤ ${t.max.toLocaleString('ko-KR')}원`).join(', ') || '없음'}\n재구매 주기: ${(p.cycles ?? []).map(c => `${esc(c.kw)} ${c.days}일`).join(', ') || '없음'}`,
        changed: false,
      };
    default: return null;
  }
}

// subs: 구독자 배열(수정됨). 반환: 구독자 목록이 바뀌었는지
export async function handleCommands(state, tg, subs = []) {
  let updates;
  try { updates = await getUpdates(tg, state.tgOffset ?? 0); } catch (e) { console.error('[cmd]', e.message); return false; }
  if (!updates.length) return false;
  state.tgOffset = updates.at(-1).update_id + 1;

  const s = readS();
  let changed = false, subsChanged = false;
  const reply = async (text) => { try { await send(tg, text); } catch (e) { console.error('[cmd]', e.message); } };
  const replyTo = async (chatId, text) => { try { await send({ ...tg, chatId }, text); } catch (e) { console.error('[cmd]', e.message); } };

  for (const u of updates) {
    // 알림의 "비교가 틀렸어요" 버튼 (관리자만)
    const cb = u.callback_query;
    if (cb) {
      if (String(cb.from.id) !== String(tg.chatId)) { await answerCallback(tg, cb.id, '관리자만 쓸 수 있어요'); continue; }
      const m = /^wrong:(.+)$/.exec(cb.data ?? '');
      const d = m && state.deals.find(x => x.id === m[1]);
      await answerCallback(tg, cb.id, '반영했어요');
      if (d?.danawa) {
        state.feedback = [...(state.feedback ?? []), { deal: d.product, matched: d.danawa.name, at: new Date().toISOString() }].slice(-50);
        delete d.danawa; d.danawa_wrong = true; d.danawa_checked = true;
        await reply(`🗑 다나와 비교를 지웠어요\n${esc(d.product || d.title)}`);
      } else await reply('이미 지워졌거나 3일이 지난 딜이에요.');
      continue;
    }

    const msg = u.message;
    if (!msg?.text || msg.chat.type !== 'private') continue;
    const [rawCmd, ...rest] = msg.text.trim().split(/\s+/);
    const cmd = rawCmd.split('@')[0].toLowerCase(), arg = rest.join(' ').trim();
    const chatId = String(msg.chat.id);

    // 관리자 외 사용자: 구독/해지만 가능
    if (chatId !== String(tg.chatId)) {
      const i = subs.findIndex(x => String(x.id) === chatId);
      if (cmd === '/start') {
        if (i < 0) { subs.push({ id: chatId, at: new Date().toISOString() }); subsChanged = true; }
        await replyTo(chatId, WELCOME);
      } else if (cmd === '/stop') {
        if (i >= 0) { subs.splice(i, 1); subsChanged = true; }
        await replyTo(chatId, '🔕 구독을 해지했어요. 다시 받으려면 /start');
      } else if (i < 0) {
        await replyTo(chatId, '알림을 받으려면 먼저 /start 를 눌러주세요.');
      } else if (cmd === '/help') {
        await replyTo(chatId, SUB_HELP);
      } else if (cmd === '/watch' || cmd === '/unwatch') {
        const sub = subs[i]; sub.keywords ??= [];
        if (!arg) { await replyTo(chatId, '단어를 같이 보내주세요. 예: /watch 기저귀'); continue; }
        if (cmd === '/watch') {
          if (sub.keywords.length >= 20) { await replyTo(chatId, '키워드는 20개까지예요.'); continue; }
          sub.keywords = [...new Set([...sub.keywords, arg.slice(0, 30)])];
          await replyTo(chatId, `✅ 내 키워드 추가: <b>${esc(arg)}</b>`);
        } else {
          sub.keywords = sub.keywords.filter(k => k !== arg);
          await replyTo(chatId, `🗑 내 키워드 삭제: ${esc(arg)}`);
        }
        subsChanged = true;
      } else {
        const r = applyPersonal(cmd, arg, subs[i]);
        if (r?.changed) subsChanged = true;
        await replyTo(chatId, r?.text ?? `모르는 명령이에요.\n\n${SUB_HELP}`);
      }
      continue;
    }

    if (cmd === '/start' || cmd === '/help') await reply(HELP);
    else if (cmd === '/subs') await reply(`📲 구독자 ${subs.length}명 (관리자 제외)`);
    else if (cmd === '/list') {
      const a = s.alerts, q = s.quietHours;
      await reply(`<b>현재 설정</b>\n키워드: ${esc((a.keywords ?? []).join(', ') || '없음')}\n제외어: ${esc((a.excludeKeywords ?? []).join(', ') || '없음')}\n관심 카테고리: ${esc((a.categories ?? []).join(', '))} (≤ ${(a.maxPrice ?? 0).toLocaleString('ko-KR')}원)\n최소 할인율: ${a.minDiscountPct}%\n조회 상위: ${a.hotTopPercent}% · 추천 ≥ ${a.hotRecommend}\n방해 금지: ${q ? `${q.start}시~${q.end}시` : '꺼짐'}`);
    } else if (cmd === '/status') {
      const h = state.health ?? {};
      await reply(`마지막 정상 수집: ${h.lastOk ? new Date(h.lastOk).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'}\n연속 실패: ${h.fails ?? 0}회\n보관 딜: ${state.deals.length}건`);
    } else if (['/target', '/untarget', '/mylist', '/cycle', '/bought', '/uncycle'].includes(cmd)) {
      // 관리자의 목표가·재구매 주기는 settings.json 에 저장
      const p = { keywords: s.alerts.keywords ?? [], targets: s.targets ?? [], cycles: s.cycles ?? [] };
      const r = applyPersonal(cmd, arg, p);
      if (r.changed) { s.targets = p.targets; s.cycles = p.cycles; changed = true; }
      await reply(r.text);
    } else {
      const r = apply(cmd, arg, s);
      if (r?.changed) changed = true;
      await reply(r?.text ?? '모르는 명령이에요. /help');
    }
  }
  if (changed) { writeS(s); console.log('[cmd] settings.json 변경'); }
  if (subsChanged) console.log(`[cmd] 구독자 ${subs.length}명`);
  return subsChanged;
}
