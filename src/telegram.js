const API = t => `https://api.telegram.org/bot${t}`;

export const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export async function send({ botToken, chatId }, html) {
  if (!botToken || !chatId) return false;
  const r = await fetch(`${API(botToken)}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!r.ok) throw new Error(`telegram ${r.status} ${await r.text()}`);
  return true;
}

// 봇에게 온 새 메시지 (offset 이후)
export async function getUpdates({ botToken }, offset = 0) {
  if (!botToken) return [];
  const r = await fetch(`${API(botToken)}/getUpdates?offset=${offset}&timeout=0&allowed_updates=["message"]`);
  if (!r.ok) throw new Error(`telegram getUpdates ${r.status}`);
  return (await r.json()).result ?? [];
}
