// AI 종합 판정: 다나와 대비·뽐뿌 역대가·반응 추이를 함께 보고 "강력추천" 여부와 이유를 만든다
// 실행당 Gemini 1회 호출(최대 8건 묶음) → 무료 한도 부담 최소화
import { askJSON, hasGemini } from './gemini.js';

const VERDICTS = ['강력추천', '추천', '보통', '비추천'];
const HOUR = 3600e3;

// 판정할 만한 근거가 있는 딜만 (근거 없는 딜에 AI 의견을 붙이지 않음)
const hasEvidence = d => d.price > 0 && (d.danawa || d.hist || d.recommend >= 1 || (d.momentum?.vpm ?? 0) >= 10);

// 입력이 바뀌면(다나와 결과·역대가·추천 변화) 다시 판정
const fingerprint = d => [d.price, d.danawa?.diffPct, d.hist?.prevMin, Math.min(d.recommend, 5), d.momentum && d.momentum.vpm >= 10, !!d.tips].join('|');

function facts(d) {
  const f = [`가격 ${d.price.toLocaleString('ko-KR')}원`, `쇼핑몰 ${d.mall ?? '?'}`, `배송 ${d.shipping ?? '?'}`, `카테고리 ${d.category}`];
  if (d.danawa) f.push(`다나와 최저가(같은 구성 환산) ${d.danawa.price.toLocaleString('ko-KR')}원 → ${d.danawa.diffPct <= 0 ? -d.danawa.diffPct + '% 쌈' : d.danawa.diffPct + '% 비쌈'} (비교상품: ${d.danawa.name})`);
  else f.push('다나와 비교 없음');
  if (d.hist) f.push(`뽐뿌 이전 최저 ${d.hist.prevMin.toLocaleString('ko-KR')}원 (${d.hist.count}회 등장)${d.hist.lowest ? ' → 이번이 역대 최저' : ''}`);
  f.push(`게시 ${Math.round((Date.now() - new Date(d.posted_at)) / 60000)}분 경과, 조회 ${d.views}, 추천 ${d.recommend}`);
  if (d.tips?.points?.length || d.tips?.unit) f.push(`본문 구매 포인트: ${[...(d.tips.points ?? []), d.tips.unit].filter(Boolean).join(', ')}`);
  if (d.tips?.caution) f.push(`주의 조건: ${d.tips.caution}`);
  if (d.momentum) f.push(`최근 조회 속도 ${d.momentum.vpm}/분, 추천 증가 +${d.momentum.recGain}`);
  return f.join(' / ');
}

export async function aiVerdicts(deals, max = 8) {
  // 상위 모델은 하루 한도가 작아 20분에 1번만 판정 (나머지 실행은 건너뜀)
  if (new Date().getUTCMinutes() % 20 >= 10) return;
  if (!hasGemini()) return;
  const targets = deals
    .filter(d => Date.now() - new Date(d.posted_at) < 24 * HOUR && hasEvidence(d) && d.ai?.fp !== fingerprint(d))
    .sort((a, b) => (a.danawa?.diffPct ?? 0) - (b.danawa?.diffPct ?? 0))
    .slice(0, max);
  if (!targets.length) return;

  const prompt = `너는 한국 핫딜 커뮤니티의 노련한 구매 조언자다. 각 딜을 판정하라.
판정 기준:
- 강력추천: 같은 구성 기준 시세보다 확실히 싸고(대략 20% 이상) 근거가 2개 이상 겹침(다나와 대비·뽐뿌 역대 최저·빠른 반응). 생필품·소모품은 단가가 확실히 싸면 가산.
- 추천: 시세보다 싸거나 반응이 좋음
- 보통: 시세 수준이거나 근거 부족
- 비추천: 시세보다 비싸거나 구성이 애매함
주의: 다나와 비교상품이 딜과 다른 상품으로 보이면 그 근거는 무시하고 낮게 판정. 근거에 없는 사실을 지어내지 마라.
다나와 비교도 뽐뿌 이전가도 없으면 "시세 비교 근거 없음"을 밝히고 최대 '추천'까지만.

딜 목록:
${targets.map((d, i) => `${i}. "${d.title}" — ${facts(d)}`).join('\n')}

JSON 배열만 (길이 ${targets.length}, 입력 순서):
[{"verdict":"강력추천|추천|보통|비추천","score":0~100,"reason":"근거 위주 35자 이내 한 문장"}]`;

  try {
    const out = await askJSON(prompt);
    if (!Array.isArray(out) || out.length !== targets.length) return;
    targets.forEach((d, i) => {
      const o = out[i];
      if (!o || !VERDICTS.includes(o.verdict)) return;
      // 가격 근거(다나와 20%↓ 또는 뽐뿌 역대 최저) 없이는 강력추천 불가 → 추천으로 낮춤
      const priceProof = (d.danawa && d.danawa.diffPct <= -20) || d.hist?.lowest;
      if (o.verdict === '강력추천' && !priceProof) { o.verdict = '추천'; o.score = Math.min(Number(o.score) || 0, 79); }
      d.ai = { verdict: o.verdict, score: Math.max(0, Math.min(100, Number(o.score) || 0)), reason: String(o.reason ?? '').slice(0, 60), fp: fingerprint(d) };
    });
    console.log(`[verdict] AI 판정 ${targets.length}건: ${targets.map(d => d.ai?.verdict).join(', ')}`);
  } catch (e) { console.error('[verdict]', e.message); }
}
