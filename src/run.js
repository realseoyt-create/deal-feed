// 1회 실행 (GitHub Actions cron이 호출)
// 텔레그램 명령 처리 → 수집 → 역대가 → 알림 → 표시용 다나와 비교 → 저장 → 고장 감시
import { load, save, merge } from './store.js';
import { FEEDS, fetchFeed } from './rss.js';
import { notifyPending, enrichDanawa, aiCategorize } from './notify.js';
import { loadConfig } from './config.js';
import { handleCommands } from './commands.js';
import { loadHistory, applyHistory, saveHistory } from './history.js';
import { send } from './telegram.js';
import { aiVerdicts } from './verdict.js';

const FAIL_ALERT = 3; // 연속 실패 N회면 텔레그램 경고

const state = load();
state.health ??= { fails: 0, lastOk: null, alerted: false };
const tg0 = loadConfig().telegram;

await handleCommands(state, tg0);
const cfg = loadConfig(); // 명령으로 바뀐 설정 반영

let ok = 0, errors = [];
for (const f of FEEDS) {
  try {
    const items = await fetchFeed(f);
    if (!items.length) throw new Error('RSS 항목 0건');
    console.log(`${f.source}: ${items.length}건 읽음, 신규 ${merge(state, items)}건`);
    ok++;
  } catch (e) {
    errors.push(`${f.source}: ${e.message}`);
    console.error(`[collect] ${f.source} 실패:`, e.message);
  }
}

await aiCategorize(state.deals);
// 웹 화면에 현재 알림 조건을 보여주기 위해 함께 저장 (비밀값 없음)
state.settings = { alerts: cfg.alerts, quietHours: cfg.quietHours ?? null };

const hist = loadHistory();
applyHistory(state.deals, hist);
// 다나와 비교 → AI 종합 판정 → 알림 (판정 결과가 알림에 반영되도록 이 순서)
await enrichDanawa(state.deals);
await aiVerdicts(state.deals);
await notifyPending(state.deals, cfg);

// ⑩ 고장 감시: 연속 실패 시 1회 경고, 복구되면 1회 알림
const h = state.health;
if (ok) {
  if (h.alerted) await send(cfg.telegram, `✅ 수집 복구됨 (${h.fails}회 실패 후)`).catch(() => {});
  Object.assign(h, { fails: 0, lastOk: new Date().toISOString(), alerted: false });
} else {
  h.fails++;
  if (h.fails >= FAIL_ALERT && !h.alerted) {
    await send(cfg.telegram, `⚠️ <b>꿀딜 수집 ${h.fails}회 연속 실패</b>\n${errors.join('\n')}\n마지막 정상: ${h.lastOk ?? '-'}\nhttps://github.com/realseoyt-create/deal-feed/actions`).catch(e => console.error(e.message));
    h.alerted = true;
  }
}

save(state);
saveHistory(hist);
if (!ok) process.exitCode = 1;
