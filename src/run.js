// 1회 실행: 수집 → 알림 → docs/deals.json 저장 (GitHub Actions cron이 호출)
import { load, save, merge } from './store.js';
import { FEEDS, fetchFeed } from './rss.js';
import { notifyPending, enrichDanawa } from './notify.js';
import { loadConfig } from './config.js';

const state = load();
let ok = 0;
for (const f of FEEDS) {
  try {
    const items = await fetchFeed(f);
    console.log(`${f.source}: ${items.length}건 읽음, 신규 ${merge(state, items)}건`);
    ok++;
  } catch (e) {
    console.error(`[collect] ${f.source} 실패:`, e.message);
  }
}
await notifyPending(state.deals, loadConfig());
await enrichDanawa(state.deals);
save(state);
if (!ok) process.exitCode = 1; // 전부 실패하면 Actions에 빨간불
