// 실구매가·단위가격·할인 조건 해석
// 원칙: 애매하면 계산하지 않는다 (null) — 틀린 숫자보다 빈칸이 낫다

// ── 배송비 ───────────────────────────────────────────────
// 반환: { cost: 숫자|null, cond: '조건부 무료' 등|null }
//  - cost 0: 무료 확정, 숫자: 유료 확정, null: 알 수 없음/조건부
export function parseShipping(ship, price) {
  const s = String(ship ?? '').replace(/\s+/g, '');
  if (!s) return { cost: null, cond: null };
  // "2만이상무료", "3만원 이상 무료" — 가격이 기준 이상이면 무료 확정
  const th = s.match(/([\d.,]+)(만)?원?이상(무료|무배)/);
  if (th) {
    const n = Number(th[1].replace(/,/g, '')) * (th[2] ? 10000 : 1);
    if (price != null && price >= n) return { cost: 0, cond: null };
    return { cost: null, cond: `${n.toLocaleString('ko-KR')}원 이상 무료` };
  }
  // 멤버십·카드 조건부 무료 (네멤무료, 와우무료, 스마일무배 등)
  if (/(네멤|멤버십|와우|스마일|티멤|유니버스|클럽|조건부|회원).*(무료|무배)|(무료|무배).*(조건|회원)/.test(s)) return { cost: null, cond: '조건부 무료배송' };
  if (/^(무료|무배|무료배송|배송비무료|택배비무료|무료\/?)$/.test(s) || /^무료/.test(s) && !/\d/.test(s)) return { cost: 0, cond: null };
  const n = s.match(/(\d{1,3}(?:,\d{3})+|\d{3,5})원?/);
  if (n) return { cost: Number(n[1].replace(/,/g, '')), cond: null };
  return { cost: null, cond: null };
}

// 실구매가: 가격 + 확정 배송비 (배송비를 모르면 가격만, 대신 shipKnown=false)
export function effectivePrice(d) {
  if (d.price == null) return null;
  const c = d.ship?.cost;
  return c != null ? d.price + c : d.price;
}

// ── 용량·수량 → 단위가격 ───────────────────────────────────
const PACK = '(팩|개입|개|입|봉|병|캔|박스|세트|펫|통|포|봉지|EA|ea)';
const COUNT_UNIT = '(매|롤|구|알|정|스틱|캡슐|포|개입|개|입|팩|봉|병|캔|펫|박스|세트|통)';

// 반환: { amount, unit: 'g'|'ml'|'매'|'롤'|..., perLabel, per } 또는 null
export function parseQty(title) {
  let t = String(title).replace(/\([^)]*원[^)]*\)\s*$/, ' ')   // 끝의 (가격/배송) 제거
    .replace(/[×*xX]\s*(?=\d)/g, ' x ').replace(/,(?=\d{3})/g, '');
  // 1+1, 2+1 → 배수 (용량끼리 더하는 "1kg+1kg" 와 구분)
  let mult = 1;
  const plus = t.match(/(?<![\d.])(\d)\s*\+\s*(\d)(?![\d.]*\s*(kg|g|ml|l)\b)/i);
  if (plus) { mult = Number(plus[1]) + Number(plus[2]); t = t.replace(plus[0], ' '); }

  // 무게·부피
  const ws = [...t.matchAll(/(\d+(?:\.\d+)?)\s*(kg|g|ml|l)(?![a-z])/gi)].map(m => {
    const v = Number(m[1]), u = m[2].toLowerCase();
    return { v: u === 'kg' ? v * 1000 : u === 'l' ? v * 1000 : v, base: u === 'kg' || u === 'g' ? 'g' : 'ml', raw: m[0], idx: m.index };
  });
  // 용량 단위가 섞이면(g와 ml) 판단 불가
  if (ws.length && new Set(ws.map(w => w.base)).size > 1) return null;

  // 팩/개 배수 (용량 뒤에 오는 묶음 수) — 예: 500g 4팩, 2.5L x 4개, 15g 40개
  const packs = [...t.matchAll(new RegExp(`(?:x\\s*)?(\\d+)\\s*${PACK}(?![가-힣])`, 'g'))].map(m => ({ n: Number(m[1]), idx: m.index }));

  if (ws.length) {
    let total;
    if (ws.length === 1) {
      const after = packs.filter(p => p.idx > ws[0].idx);
      if (after.length > 1) return null;                         // 묶음 표기가 여러 개면 애매
      total = ws[0].v * (after[0]?.n ?? 1);
    } else if (/\d\s*(kg|g|ml|l)\s*\+\s*\d/i.test(t) && ws.length === 2) {
      total = ws[0].v + ws[1].v;                                   // 1kg+1kg
    } else return null;                                            // 용량이 여러 개 → 옵션 나열일 수 있음
    total *= mult;
    if (!(total > 0)) return null;
    const base = ws[0].base;
    const per = base === 'g' ? (total >= 1000 ? 1000 : 100) : (total >= 1000 ? 1000 : 100);
    const perLabel = base === 'g' ? (per === 1000 ? '1kg' : '100g') : (per === 1000 ? '1L' : '100ml');
    return { amount: total, unit: base, per, perLabel };
  }

  // 개수 기반 (휴지 30롤 x 3팩, 물티슈 100매 10팩, 계란 20구, 도시락 24개)
  const cs = [...t.matchAll(new RegExp(`(\\d+)\\s*${COUNT_UNIT}(?![가-힣])`, 'g'))].map(m => ({ n: Number(m[1]), u: m[2], idx: m.index }));
  if (!cs.length) return null;
  // 묶음 단위 (개입·입은 "낱개 N개 들어있음"이라 기본 단위로 취급)
  const isPack = u => /^(팩|봉|병|캔|펫|박스|세트|통)$/.test(u);
  const inner = cs.filter(c => !isPack(c.u) || cs.length === 1);   // 기본 단위(매·롤·구·개…)
  const outer = cs.filter(c => isPack(c.u) && cs.length > 1);      // 묶음 수
  if (inner.length !== 1 || outer.length > 1) return null;
  // 기본 단위가 "팩·봉·병" 같은 묶음뿐이면 묶음 크기를 몰라 딜끼리 비교 불가 (예: 물티슈 20팩)
  if (isPack(inner[0].u)) return null;
  let total = inner[0].n * (outer[0]?.n ?? 1) * mult;
  const u = inner[0].u === '개입' || inner[0].u === '입' ? '개' : inner[0].u;
  if (!(total > 1)) return null;
  return { amount: total, unit: u, per: 1, perLabel: `1${u}` };
}

// 단위가격: 실구매가 ÷ (총량/기준량)
export function unitPrice(d) {
  const q = d.qty, p = effectivePrice(d);
  if (!q || !(p > 0)) return null;
  const v = p / (q.amount / q.per);
  return { value: v >= 100 ? Math.round(v) : Math.round(v * 10) / 10, label: q.perLabel };
}

// ── 할인 조건 (누구나 이 가격인가?) ───────────────────────────
const COND_RULES = [
  ['첫구매', /첫\s*구매|첫\s*주문|신규\s*(가입|회원|고객)|웰컴|첫결제/],
  ['멤버십', /멤버십|와우|티멤|T멤|네멤|스마일클럽|유니버스|로켓와우|클럽\s*회원|회원\s*전용|플러스\s*멤버/i],
  ['특정 카드·결제', /(\S+카드)\s*(결제|할인|청구)|카드\s*(실적|할인|청구할인)|[가-힣A-Za-z]+페이\s*(결제|할인|추가)|토스페이|카카오페이|네이버페이|페이코|스마일페이/],
  ['앱·라이브 전용', /앱\s*전용|앱에서만|라이브\s*(전용|한정|특가)|방송\s*중/],
];
export function detectConds(...texts) {
  const s = texts.filter(Boolean).join(' ');
  return COND_RULES.filter(([, re]) => re.test(s)).map(([k]) => k);
}
