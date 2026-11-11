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
  writeFileSync(FILE, JSON.stringify(state, null, 0));
}

// 새로 읽은 RSS 항목을 병합. 반환: 신규 건수
export function merge(state, items) {
  const byId = new Map(state.deals.map(d => [d.id, d]));
  const now = new Date().toISOString();
  let added = 0;
  for (const it of items) {
    const old = byId.get(it.id);
    if (old) Object.assign(old, it, { first_seen: old.first_seen, notified: old.notified, danawa: old.danawa, last_seen: now });
    else { byId.set(it.id, { ...it, first_seen: now, last_seen: now, notified: 0 }); added++; }
  }
  state.deals = [...byId.values()];
  return added;
}
