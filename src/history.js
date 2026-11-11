// 나만의 '뽐뿌 역대가': 수집한 딜을 상품 키로 묶어 이전 최저가 기록 (크롤링 없음)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DOCS } from './store.js';
import { cleanQuery } from './danawa.js';

const FILE = join(DOCS, 'history.json');
const KEEP_DAYS = 180;

// 상품 키: 정제된 상품명 단어를 소문자·정렬 (쇼핑몰·순서 차이 무시)
export function productKey(product) {
  const toks = cleanQuery(product).toLowerCase().split(' ').filter(t => t.length >= 2);
  return toks.length >= 2 ? [...new Set(toks)].sort().join(' ') : null;
}

export function loadHistory() {
  return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8').replace(/^﻿/, '')) : {};
}

// 각 딜에 이전 기록을 붙이고(d.hist), 기록을 갱신
export function applyHistory(deals, hist) {
  for (const d of deals) {
    if (!d.price) continue;
    const key = productKey(d.product || d.title);
    if (!key) continue;
    const h = hist[key];
    // 자기 자신(같은 글) 기록은 제외하고 비교
    const prev = h?.entries.filter(e => e.id !== d.id) ?? [];
    if (prev.length) {
      const min = prev.reduce((a, b) => (b.price < a.price ? b : a));
      d.hist = { prevMin: min.price, prevAt: min.at, count: prev.length, lowest: d.price < min.price };
    } else delete d.hist;
    const entry = { id: d.id, price: d.price, at: d.posted_at };
    hist[key] = { entries: [...prev, entry] };
  }
  const cutoff = Date.now() - KEEP_DAYS * 86400e3;
  for (const k of Object.keys(hist)) {
    hist[k].entries = hist[k].entries.filter(e => new Date(e.at).getTime() >= cutoff).slice(-20);
    if (!hist[k].entries.length) delete hist[k];
  }
}

export function saveHistory(hist) {
  writeFileSync(FILE, JSON.stringify(hist));
}
