const API = t => `https://api.telegram.org/bot${t}`;

export const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// buttons: [[{ text, url } | { text, callback_data }], ...] (inline keyboard 행 배열)
// 여러 채팅에 같은 메시지 발송. 차단·탈퇴한 채팅(403)은 목록으로 돌려줌
export async function broadcast({ botToken }, chatIds, html, buttons) {
  const gone = [];
  let ok = 0;
  for (const id of chatIds) {
    try { await send({ botToken, chatId: id }, html, buttons); ok++; }
    catch (e) { if (/telegram 403/.test(e.message)) gone.push(id); else console.error('[broadcast]', id, e.message.slice(0, 120)); }
  }
  if (!ok && chatIds.length) throw new Error('모든 채팅 발송 실패');
  return gone;
}

export async function send({ botToken, chatId }, html, buttons) {
  if (!botToken || !chatId) return false;
  const r = await fetch(`${API(botToken)}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true,
      ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
    }),
  });
  if (!r.ok) throw new Error(`telegram ${r.status} ${await r.text()}`);
  return true;
}

// 봇에게 온 새 메시지·버튼 클릭 (offset 이후)
export async function getUpdates({ botToken }, offset = 0) {
  if (!botToken) return [];
  const allowed = encodeURIComponent('["message","callback_query"]');
  const r = await fetch(`${API(botToken)}/getUpdates?offset=${offset}&timeout=0&allowed_updates=${allowed}`);
  if (!r.ok) throw new Error(`telegram getUpdates ${r.status}`);
  return (await r.json()).result ?? [];
}

// 버튼 클릭 응답 (수집 주기 때문에 늦으면 텔레그램이 거절할 수 있음 → 무시)
export async function answerCallback({ botToken }, id, text) {
  await fetch(`${API(botToken)}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: id, text }),
  }).catch(() => {});
}
