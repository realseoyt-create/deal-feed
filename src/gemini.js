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

async function ask(prompt, model = LITE) {
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

// "딜 상품 = 다나와 후보 중 몇 번?" + 수량 비율
export async function judgeMatch(dealTitle, dealPrice, candidates) {
  if (!hasGemini() || !candidates.length) return null;
  const out = await ask(`쇼핑 핫딜 게시글 제목과 가격비교 사이트 검색 결과가 있다.
딜과 "같은 상품"(같은 브랜드·모델·종류. 옷이면 재킷/조끼 구분, 식품이면 품목·등급·크기 동일)인 후보를 고르고,
딜 구성과 후보 구성의 수량 비율을 계산하라.

딜: "${dealTitle}" / ${dealPrice}원
후보:
${candidates.map((c, i) => `${i}. "${c.name}" / ${c.price}원`).join('\n')}

규칙:
- 같은 상품이 없으면 match = -1
- ratio = 딜 총량 ÷ 후보 총량 (예: 딜 1kg 2팩, 후보 1kg → 2. 1+1은 2개로 계산). 모르면 1
- 확신이 낮으면 confidence를 낮게
JSON만: {"match": 정수, "ratio": 숫자, "confidence": 0~1, "reason": "20자 이내"}`);
  if (!Number.isInteger(out.match) || out.match < -1 || out.match >= candidates.length) return { match: -1 };
  return { match: out.match, ratio: Number(out.ratio) > 0 ? Number(out.ratio) : 1, confidence: Number(out.confidence) || 0, reason: out.reason };
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
