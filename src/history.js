// 나만의 '뽐뿌 역대가': 수집한 딜을 상품 키로 묶어 이전 최저가·단위가격 기록 (크롤링 없음)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DOCS } from './store.js';
import { cleanQuery } from './danawa.js';
import { effectivePrice, unitPrice } from './qty.js';

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

// 각 딜에 이전 기록(d.hist)과 가격 추이(d.series)를 붙이고, 기록을 갱신
// 가격은 실구매가(배송비 확정분 포함) 기준. 단위가격은 같은 기준 단위(예: 1L)끼리만 비교
export function applyHistory(deals, hist) {
  for (const d of deals) {
    const eff = effectivePrice(d);
    if (!eff) continue;
    const key = productKey(d.product || d.title);
    if (!key) continue;
    const prev = hist[key]?.entries.filter(e => e.id !== d.id) ?? []; // 자기 자신 제외
    const up = unitPrice(d);
    if (prev.length) {
      const min = prev.reduce((a, b) => (b.price < a.price ? b : a));
      d.hist = { prevMin: min.price, prevAt: min.at, count: prev.length, lowest: eff < min.price };
      const sameUnit = up ? prev.filter(e => e.unit?.label === up.label) : [];
      if (sameUnit.length) {
        const um = Math.min(...sameUnit.map(e => e.unit.value));
        d.hist.unitPrev = um;
        d.hist.unitLowest = up.value < um;
      }
    } else delete d.hist;
    const entry = { id: d.id, price: eff, at: d.posted_at, ...(up ? { unit: up } : {}) };
    const entries = [...prev, entry].sort((a, b) => a.at.localeCompare(b.at));
    hist[key] = { entries };
    // 가격 추이 (2회 이상 등장한 상품만): [시각, 실구매가]
    if (entries.length >= 2) d.series = entries.slice(-10).map(e => [e.at, e.price]); else delete d.series;
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
