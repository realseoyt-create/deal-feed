// Gemini로 "딜 상품 = 다나와 후보 중 몇 번?" + 수량 비교 판정
// GEMINI_API_KEY 없으면 null 반환 → 규칙 기반 매칭으로 대체
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let last = 0;

export const hasGemini = () => !!process.env.GEMINI_API_KEY;

export async function judgeMatch(dealTitle, dealPrice, candidates) {
  if (!hasGemini() || !candidates.length) return null;
  // 무료 한도(분당 요청 수) 보호: 호출 간 최소 5초
  const wait = 5000 - (Date.now() - last); if (wait > 0) await sleep(wait);
  last = Date.now();

  const prompt = `쇼핑 핫딜 게시글 제목과 가격비교 사이트 검색 결과가 있다.
딜과 "같은 상품"(같은 브랜드·모델·종류. 옷이면 재킷/조끼 구분, 식품이면 품목 동일)인 후보를 고르고,
딜 구성과 후보 구성의 수량 비율을 계산하라.

딜: "${dealTitle}" / ${dealPrice}원
후보:
${candidates.map((c, i) => `${i}. "${c.name}" / ${c.price}원`).join('\n')}

규칙:
- 같은 상품이 없으면 match = -1
- ratio = 딜 총량 ÷ 후보 총량 (예: 딜 1kg 2팩, 후보 1kg → 2. 1+1은 2개로 계산). 모르면 1
- 확신이 낮으면 confidence를 낮게
JSON만: {"match": 정수, "ratio": 숫자, "confidence": 0~1, "reason": "20자 이내"}`;

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
  });
  if (!r.ok) throw new Error(`gemini ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const out = JSON.parse(j.candidates[0].content.parts[0].text.replace(/^```json\s*|\s*```$/g, ''));
  if (!Number.isInteger(out.match) || out.match < -1 || out.match >= candidates.length) return { match: -1 };
  return { match: out.match, ratio: Number(out.ratio) > 0 ? Number(out.ratio) : 1, confidence: Number(out.confidence) || 0, reason: out.reason };
}
