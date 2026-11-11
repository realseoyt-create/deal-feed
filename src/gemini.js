// Gemini 호출: 상품 매칭 판정 + 카테고리 분류
// GEMINI_API_KEY 없으면 null 반환 → 규칙 기반으로 대체
// 별칭 모델: 구버전 단종에도 안 깨짐. 매칭·분류는 무료 한도가 넉넉한 경량 모델, 종합 판정만 상위 모델
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const LITE = process.env.GEMINI_LITE_MODEL || 'gemini-flash-lite-latest';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let last = 0;
let failStreak = 0; // 연속 실패가 쌓이면 이번 실행에서는 AI를 쉬고 규칙으로 대체

export const hasGemini = () => !!process.env.GEMINI_API_KEY && failStreak < 2;
export const CATEGORIES = ['생활용품', '식품', '디지털/가전', '패션/뷰티', '상품권/쿠폰', '여행', '기타'];

export async function askJSON(prompt) { return ask(prompt, MODEL); }

// ── 하루 사용량 관리 (한국 날짜 기준). 한도는 추정치라 환경변수로 조정 가능 ──
const LIMITS = { lite: Number(process.env.GEMINI_LITE_DAILY) || 800, main: Number(process.env.GEMINI_DAILY) || 150 };
const kstDate = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
let usage = { date: kstDate(), lite: 0, main: 0 };
export function setUsage(u) { usage = u?.date === kstDate() ? { lite: 0, main: 0, ...u } : { date: kstDate(), lite: 0, main: 0 }; }
export const getUsage = () => usage;
// priority 'low'(분류·포인트)는 70%까지만, 'high'(매칭·판정)는 100%까지 사용
export function budgetOk(kind = 'lite', priority = 'high') {
  return usage[kind] / LIMITS[kind] < (priority === 'low' ? 0.7 : 1);
}

async function ask(prompt, model = LITE) {
  const kind = model === MODEL ? 'main' : 'lite';
  if (!budgetOk(kind)) throw new Error(`gemini 하루 예산 소진 (${kind} ${usage[kind]}/${LIMITS[kind]})`);
  usage[kind]++;
  // 무료 한도(분당 요청 수) 보호: 호출 간 최소 5초
  const wait = 5000 - (Date.now() - last); if (wait > 0) await sleep(wait);
  last = Date.now();
  const call = () => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
  });
  // 503(혼잡)·429(한도)는 6초 뒤 1번만 재시도, 그래도 실패하면 호출부가 규칙으로 대체
  let r = await call();
  if (r.status === 503 || r.status === 429) { await sleep(6000); r = await call(); }
  if (!r.ok) { failStreak++; throw new Error(`gemini ${r.status} ${(await r.text()).slice(0, 200)}`); }
  failStreak = 0;
  const j = await r.json();
  return JSON.parse(j.candidates[0].content.parts[0].text.replace(/^```json\s*|\s*```$/g, ''));
}

// 다나와 검색어 생성 (여러 건 1회 호출) → [{query, comparable}] 또는 null
// 제목 그대로 검색하면 "당일작업 생물"처럼 잘리거나 묶음 글이 엉망이 되는 문제 해결
export async function genQueries(titles) {
  if (!hasGemini() || !titles.length) return null;
  const out = await ask(`핫딜 게시글 제목마다 가격비교 사이트(다나와) 검색어를 만들어라.
- query: 브랜드 + 핵심 상품명 + 핵심 규격(용량·모델명)만. 쇼핑몰명·할인문구·배송·수식어(당일작업, 특가, 국내산 등) 제거. 2~5단어
- comparable: 다나와에서 같은/비슷한 상품 가격 비교가 의미 있으면 true.
  false인 경우: 여러 상품 묶음 글, 여행·숙박·티켓, 상품권·쿠폰·이벤트, "다양"·"모음" 글

${titles.map((t, i) => `${i}. ${t}`).join('\n')}

JSON 배열만 (길이 ${titles.length}, 입력 순서): [{"query":"...","comparable":true}]`);
  if (!Array.isArray(out) || out.length !== titles.length) return null;
  return out.map(o => ({ query: String(o?.query ?? '').trim().slice(0, 60), comparable: o?.comparable !== false }));
}

// "딜 상품 = 다나와 후보 중 몇 번?" + 수량 비율 + 일치 수준(exact/similar)
export async function judgeMatch(dealTitle, dealPrice, candidates) {
  if (!hasGemini() || !candidates.length) return null;
  const out = await ask(`쇼핑 핫딜 게시글 제목과 가격비교 사이트 검색 결과가 있다. 가격 비교 기준으로 쓸 후보를 골라라.

딜: "${dealTitle}" / ${dealPrice}원
후보:
${candidates.map((c, i) => `${i}. "${c.name}" / ${c.price}원`).join('\n')}

판단 기준:
- exact: 같은 브랜드·같은 모델(전자제품·의류·화장품·가공식품은 이것만 인정)
- similar: 신선식품·농수산물·생필품 원물(연어, 새우, 쌀, 과일, 계란, 휴지 원단 등)처럼 브랜드보다 "품목·규격·등급"이 가격을 결정하는 상품이면 브랜드가 달라도 같은 품목·비슷한 규격이면 인정
- 종류가 다르면(재킷↔조끼, 고등어↔갓 페스토, 김치도시락↔일반도시락) 불인정
- 옷·가전에서 딜 제목에 모델명이 없으면 같은 라인업 중 가장 가까운 것을 similar로 고르되 confidence 0.6 이하
- ratio = 딜 총량 ÷ 후보 총량 (예: 딜 1kg 2팩·후보 1kg → 2, 딜 24개·후보 1개 → 24, 1+1은 2개). 후보 이름에 수량이 없고 가격으로 보아 묶음 판매로 보이면 판단해서 반영. 모르면 1
- 맞는 후보가 없으면 match = -1
JSON만: {"match": 정수, "type": "exact|similar", "ratio": 숫자, "confidence": 0~1, "reason": "20자 이내"}`);
  if (!Number.isInteger(out.match) || out.match < -1 || out.match >= candidates.length) return { match: -1 };
  return {
    match: out.match, type: out.type === 'similar' ? 'similar' : 'exact',
    ratio: Number(out.ratio) > 0 ? Number(out.ratio) : 1, confidence: Number(out.confidence) || 0, reason: out.reason,
  };
}

// 본문 앞부분에서 "왜 싼지" 구매 포인트 추출 (여러 건 1회 호출) → [{points:[..], unit:".."}] 또는 null
export async function extractPoints(items) {
  if (!hasGemini() || !items.length) return null;
  const out = await ask(`핫딜 게시글의 제목과 본문 앞부분이다. 구매자가 알아야 할 "싸게 사는 포인트"만 뽑아라.
- 쿠폰 받는 법, 결제수단 추가할인(토스페이·카드 등), 멤버십 조건, 옵션 선택 팁, 개당/장당 단가, 최저가 조건, 주의사항
- 각 포인트는 18자 이내 명사형, 최대 3개. 본문에 없는 내용은 절대 만들지 마라. 없으면 빈 배열
- 가격·할인과 무관한 상품 설명(용량, 등급, 원산지, 구성 소개)은 포인트가 아니다 → 넣지 마라
- unit: 본문·제목에 단가 정보가 있으면 "1매 10원꼴"처럼 15자 이내, 없으면 ""
- caution: 함정·조건(예: "첫구매만", "카드 실적 필요")이 있으면 15자 이내, 없으면 ""

${items.map((d, i) => `${i}. 제목: ${d.title}\n   본문: ${d._body}`).join('\n')}

JSON 배열만 (길이 ${items.length}, 입력 순서): [{"points":["..."],"unit":"","caution":""}]`);
  if (!Array.isArray(out) || out.length !== items.length) return null;
  return out;
}

// 제목 여러 개를 한 번에 분류 → 입력 순서대로 카테고리 배열 (실패 시 null)
export async function categorizeBatch(titles) {
  if (!hasGemini() || !titles.length) return null;
  const out = await ask(`쇼핑 핫딜 게시글 제목을 카테고리로 분류하라.
카테고리: ${CATEGORIES.join(', ')}
- 생활용품: 휴지·세제·주방·욕실·청소·침구·수납·문구 등 생활 소모품/잡화
- 식품: 먹고 마시는 것, 건강기능식품 포함
- 디지털/가전: 전자제품·PC·휴대폰·가전·주변기기
- 패션/뷰티: 의류·신발·가방·화장품
- 상품권/쿠폰: 상품권·기프티콘·쿠폰·적립 이벤트 (특정 상품이 아닌 것)
- 여행: 항공·숙박·패키지·티켓

제목:
${titles.map((t, i) => `${i}. ${t}`).join('\n')}

JSON 배열만 (길이 ${titles.length}, 입력 순서): ["식품", ...]`);
  if (!Array.isArray(out) || out.length !== titles.length) return null;
  return out.map(c => (CATEGORIES.includes(c) ? c : null));
}
