// JSON 파일 저장소 (GitHub Pages가 그대로 서빙)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DOCS = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const FILE = join(DOCS, 'deals.json');
const KEEP_DAYS = 3; // 공개 저장소이므로 최근 3일치만 보관

export function load() {
  if (!existsSync(FILE)) return { updatedAt: null, deals: [] };
  return JSON.parse(readFileSync(FILE, 'utf8').replace(/^﻿/, ''));
}

export function save(state) {
  const cutoff = Date.now() - KEEP_DAYS * 86400e3;
  state.deals = state.deals
    .filter(d => new Date(d.posted_at).getTime() >= cutoff)
    .sort((a, b) => b.posted_at.localeCompare(a.posted_at));
  state.updatedAt = new Date().toISOString();
  mkdirSync(DOCS, { recursive: true });
  // _로 시작하는 필드(본문 원문 등 실행 중 임시값)는 공개 파일에 쓰지 않음
  writeFileSync(FILE, JSON.stringify(state, (k, v) => (k.startsWith('_') ? undefined : v), 0));
}

// 새로 읽은 RSS 항목을 병합. 반환: 신규 건수
export function merge(state, items) {
  const byId = new Map(state.deals.map(d => [d.id, d]));
  const now = new Date().toISOString();
  let added = 0;
  for (const it of items) {
    const old = byId.get(it.id);
    // AI가 분류한 카테고리는 규칙 분류로 덮어쓰지 않음
    if (old?.cat_by === 'ai') it.category = old.category;
    if (old) Object.assign(old, it, {
      first_seen: old.first_seen, notified: old.notified, alert: old.alert,
      danawa: old.danawa, danawa_checked: old.danawa_checked, hist: old.hist, ai: old.ai, snaps: old.snaps, tips: old.tips, last_seen: now,
    });
    else { byId.set(it.id, { ...it, first_seen: now, last_seen: now, notified: 0 }); added++; }
  }
  state.deals = [...byId.values()];
  // 반응 추이: 이번에 RSS에서 본 딜마다 (시각, 조회, 추천) 스냅샷 누적 (최대 8개)
  const seen = new Set(items.map(i => i.id));
  for (const d of state.deals) {
    if (!seen.has(d.id)) continue;
    d.snaps = [...(d.snaps ?? []), [Date.now(), d.views, d.recommend]].slice(-8);
    d.momentum = momentum(d.snaps);
  }
  return added;
}

// 최근 구간 조회 속도(분당)와 추천 증가. 글이 오래돼도 조회가 계속 빨리 늘면 '식지 않은 딜'
function momentum(snaps) {
  if (snaps.length < 2) return null;
  const [t0, v0, r0] = snaps.at(-2), [t1, v1, r1] = snaps.at(-1);
  const min = Math.max(1, (t1 - t0) / 60000);
  return { vpm: Math.round((v1 - v0) / min * 10) / 10, recGain: r1 - snaps[0][2] };
}
