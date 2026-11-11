// 데이터 정합성 점검: npm run audit
// 수집·비교·판정·알림 결과가 서로 맞는지 확인하고 의심 항목을 출력 (데이터는 수정하지 않음)
import { load } from './store.js';

const { deals } = load();
const off = d => (d.danawa ? -d.danawa.diffPct : null);
const short = (s, n = 48) => String(s ?? '').slice(0, n);
let issues = 0;
function section(title, rows) {
  console.log(`\n[${title}] ${rows.length ? rows.length + '건' : '이상 없음'}`);
  for (const r of rows) console.log('  ' + r);
  issues += rows.length;
}

console.log(`총 ${deals.length}건 · 다나와 비교 ${deals.filter(d => d.danawa).length}건 · AI 판정 ${deals.filter(d => d.ai).length}건`);

// 1) 가격: 제목에 적힌 "N원" 금액 중 하나와 저장 가격이 일치해야 함
section('가격 ≠ 제목 금액', deals.flatMap(d => {
  const nums = [...d.title.matchAll(/(\d{1,3}(?:,\d{3})+|\d{3,})\s*원/g)].map(m => +m[1].replace(/,/g, ''));
  return d.price > 0 && nums.length && !nums.includes(d.price) ? [`${d.price} | 제목 금액 ${nums.join(',')} | ${short(d.title, 60)}`] : [];
}));

// 2) 다나와 비교: 숫자 정합성 (ref = 단가 × 비율, diff 계산)
section('다나와 계산 불일치', deals.filter(d => d.danawa).flatMap(d => {
  const { price, unitPrice, ratio, diffPct } = d.danawa;
  const ref = unitPrice ? Math.round(unitPrice * (ratio ?? 1)) : price;
  const diff = Math.round(((d.eff ?? d.price) - price) / price * 100); // 실구매가 기준
  const bad = [];
  if (ref !== price) bad.push(`환산가 ${price} ≠ 단가${unitPrice}×${ratio}`);
  if (diff !== diffPct) bad.push(`할인율 ${diffPct} ≠ 계산 ${diff}`);
  return bad.length ? [`${bad.join(', ')} | ${short(d.title)}`] : [];
}));

// 2-1) 실구매가 = 가격 + 확정 배송비
section('실구매가 계산 불일치', deals.flatMap(d => {
  if (d.price == null || d.eff == null) return [];
  const want = d.price + (d.ship?.cost ?? 0);
  return d.eff !== want ? [`eff ${d.eff} ≠ ${d.price}+${d.ship?.cost ?? 0} | ${short(d.title)}`] : [];
}));

// 2-2) 단위가격: 해석한 용량이 제목에 실제로 있는 숫자로 만들어졌는지 (확인용 목록)
section('단위가격 해석 — 확인용', deals.filter(d => d.qty).map(d => {
  const per = d.qty.amount / d.qty.per;
  return `${d.qty.amount}${d.qty.unit} → ${d.qty.perLabel}당 ${Math.round((d.eff ?? d.price) / per).toLocaleString('ko-KR')}원 | ${short(d.title, 56)}`;
}));

// 3) 다나와 비교: 사람이 확인할 목록 (큰 할인일수록 오매칭 위험)
section('다나와 비교 — 15% 이상 차이 (오매칭 의심 확인용)', deals.filter(d => d.danawa && Math.abs(d.danawa.diffPct) >= 15).map(d =>
  `${String(-d.danawa.diffPct + '%').padStart(5)} ${d.danawa.type ?? '-'} ×${d.danawa.ratio} | ${short(d.title, 40)}\n         ↔ ${short(d.danawa.name, 50)}`));

// 4) AI 판정이 근거와 모순
section('AI 판정 ↔ 근거 모순', deals.filter(d => d.ai).flatMap(d => {
  const o = off(d), why = [];
  if (d.ai.verdict === '강력추천' && !(o >= 20 || d.hist?.lowest)) why.push('가격 근거 없이 강력추천');
  if (d.ai.verdict === '비추천' && o >= 20) why.push('20%↑ 싼데 비추천');
  if (['추천', '강력추천'].includes(d.ai.verdict) && o != null && o < -5) why.push('다나와보다 비싼데 추천');
  if (/다나와.*(\d+)%/.test(d.ai.reason) && !d.danawa) why.push('비교 없는데 이유에 다나와 언급');
  return why.length ? [`${d.ai.verdict} (다나와 ${o ?? '-'}%) ${why.join(', ')} | ${short(d.title, 36)} | ${d.ai.reason}`] : [];
}));

// 5) 알림: 보낸 딜이 보낼 만했는지
section('알림 발송 — 근거 약함', deals.filter(d => d.notified === 1).flatMap(d => {
  const o = off(d), why = [];
  if (o != null && o < 0 && !String(d.alert).startsWith('키워드')) why.push(`다나와보다 ${-o}% 비쌈`);
  if (d.ai?.verdict === '비추천') why.push('AI 비추천');
  if (d.ended) why.push('종료된 딜');
  return why.length ? [`${why.join(', ')} | ${d.alert} | ${short(d.title, 40)}`] : [];
}));

// 6) 상태 값
section('상태 이상', deals.flatMap(d => {
  const why = [];
  if (d.danawa && !d.danawa_checked) why.push('비교 있는데 checked=false');
  if (d.notified === 4 && Date.now() - new Date(d.first_seen) > 12 * 3600e3) why.push('방해금지 대기 12시간 초과');
  if (d.price != null && d.price < 0) why.push('음수 가격');
  if (!/^https:\/\/www\.ppomppu\.co\.kr\//.test(d.url)) why.push('링크 형식');
  return why.length ? [`${why.join(', ')} | ${short(d.title)}`] : [];
}));

console.log(`\n의심 항목 합계 ${issues}건 ("확인용" 목록은 오류가 아닐 수 있음 — 사람이 훑어보는 용도)`);
