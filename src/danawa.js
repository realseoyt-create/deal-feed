// 다나와 검색 1회 조회 (사용자가 버튼을 누를 때만 호출 — 대량 수집 금지)
const cache = new Map(); // query -> { at, data }
const TTL = 60 * 60 * 1000;

const strip = s => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

export function cleanQuery(product) {
  return product
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\s\/\s.*$/, ' ')   // " / 최대 45% 할인" 같은 꼬리 설명 제거
    .replace(/\//g, ' ')         // "밴딩형/지퍼형" → 단어로 분리
    .replace(/\d+\s*\+\s*\d+|최대\s*\d+%|\d+%\s*할인|할인|특가|한정|라이브|무료배송|무배|증정|모음/g, ' ')
    .replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
}

// 딜 상품명과 다나와 상품명이 같은 물건인지 대략 판정
// - 검색어 단어 절반 이상 포함
// - 모델명처럼 보이는 토큰(영문+숫자 섞임, 예: 210H, GY50R)이 있으면 그중 하나 이상 포함
const norm = s => s.toLowerCase().replace(/[\s\-_/]/g, '');
export function sameProduct(query, name) {
  const n = norm(name);
  const toks = query.split(' ').filter(t => t.length >= 2);
  if (!toks.length) return false;
  const hit = toks.filter(t => n.includes(norm(t))).length;
  const models = toks.filter(t => /[a-z]/i.test(t) && /\d/.test(t) && !/^\d+(gb|tb|g|kg|ml|l|mm|cm|m|w|구|개|팩|매|롤)$/i.test(t));
  if (models.length && !models.some(t => n.includes(norm(t)))) return false;
  if (!sizesCompatible(query, name)) return false;
  // 단어 2개 이상이면 최소 2개 & 60% 이상 일치 (한 단어만 겹치는 오매칭 방지)
  return toks.length === 1 ? hit === 1 : hit >= Math.max(2, Math.ceil(toks.length * 0.6));
}

// 용량(g/kg/ml/L)·수량(개/팩/캔/롤…)이 양쪽에 모두 적혀 있는데 다르면 다른 상품
function sizes(s) {
  const w = [...s.matchAll(/(\d+(?:\.\d+)?)\s*(kg|g|ml|l)(?![a-z])/gi)].map(m => {
    const v = Number(m[1]), u = m[2].toLowerCase();
    return u === 'kg' ? v * 1000 : u === 'l' ? v * 1000 : v;
  });
  const c = [...s.matchAll(/(\d+)\s*(개입|개|팩|캔|롤|매|구|병|봉|입|펫|박스)/g)].map(m => Number(m[1]));
  return { w, c };
}
function sizesCompatible(a, b) {
  const A = sizes(a), B = sizes(b);
  if (A.w.length && B.w.length && !A.w.some(x => B.w.includes(x))) return false;
  if (A.c.length && B.c.length && !A.c.some(x => B.c.includes(x))) return false;
  // 딜은 묶음(2개 이상)인데 다나와 쪽 수량이 불명 → 단품과 비교될 위험
  if (A.c.some(x => x > 1) && !B.c.length) return false;
  return true;
}

// 결과가 없으면 검색어를 줄여서 최대 2번 더 시도
export async function danawaLookup(product) {
  const words = cleanQuery(product).split(' ');
  let r;
  for (const n of [words.length, 4, 2]) {
    if (n > words.length || (r && n === words.length)) continue;
    r = await searchOnce(words.slice(0, n).join(' '));
    if (r.items.length) return r;
  }
  return r;
}

async function searchOnce(query) {
  const hit = cache.get(query);
  if (hit && Date.now() - hit.at < TTL) return hit.data;

  const url = 'https://search.danawa.com/dsearch.php?query=' + encodeURIComponent(query);
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (personal deal-feed)' } });
  if (!res.ok) throw new Error(`danawa HTTP ${res.status}`);
  const html = await res.text();

  const items = [];
  for (const chunk of html.split('data-product-seq="').slice(1)) {
    const pcode = chunk.match(/^(\d+)/)?.[1];
    if (!pcode || items.some(i => i.pcode === pcode)) continue;
    const body = chunk.split(/<li\s/)[0];
    const nameM = body.match(/<p class="mb-2 text-px16[^"]*"><a [^>]*>([\s\S]*?)<\/a>/);
    const text = strip(body);
    const afterCat = text.split('상품분류')[1] ?? text;
    // "1개 723원/10g 16,340원 128 몰" 형태: 단위가격(원/xx) 은 건너뛰고 실제 가격을 잡는다
    const withMalls = afterCat.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*원\s*(\d+)\s*몰/);
    const priceM = withMalls ?? afterCat.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*원(?!\s*\/)/);
    const mallsM = withMalls ? [null, withMalls[2]] : null;
    const unitM = afterCat.match(/(\d{1,3}(?:,\d{3})*|\d+)\s*원\s*\/\s*([\d.]+\s*[a-zA-Z가-힣]+)/);
    if (!nameM || !priceM) continue;
    items.push({
      pcode,
      name: strip(nameM[1]),
      price: Number(priceM[1].replace(/,/g, '')),
      malls: mallsM ? Number(mallsM[1]) : null,
      unit: unitM ? `${unitM[1]}원/${unitM[2]}` : null,
      url: `https://prod.danawa.com/info/?pcode=${pcode}`,
    });
    if (items.length >= 5) break;
  }
  const data = { query, searchUrl: url, items };
  cache.set(query, { at: Date.now(), data });
  return data;
}
