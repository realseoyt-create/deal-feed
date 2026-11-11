// 해석 규칙 회귀 테스트: npm test
// 실제 뽐뿌 제목에서 나온 사례. 규칙을 고칠 때 기존 사례가 깨지지 않는지 확인
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQty, parseShipping, effectivePrice, unitPrice, detectConds } from '../src/qty.js';
import { parseTitle } from '../src/parse.js';
import { parseTarget, parseCycle } from '../src/personal.js';

const qty = t => { const q = parseQty(t); return q ? q.amount + q.unit : null; };

test('용량·수량 해석 (애매하면 null)', () => {
  const cases = [
    ['[지마켓] 동국제약 굿잠 스팀안대10매 3박스 (17,400원/무료)', '30매'],
    ['[쿠팡] 깨끗한나라 화장지 30롤 x 3팩 (25,900원/무료)', '90롤'],
    ['[오늘의집] 슈퍼대디 물티슈 모음 70평량 20팩 (19,755원/무배)', null],      // 팩당 매수 모름
    ['[네이버] 난각번호1번 유정란20구 (9,260원/무료)', '20구'],
    ['[11번가] 팔도 도시락 24개 (19,700원/무료)', '24개'],
    ['[G마켓] 팔도 왕뚜껑 오리지널+김치 10+10 / 20개 (17,300원/무료)', '20개'],
    ['[종근당건강] 락토핏 코어 60포 6통+코어30포 (44,190원/무료)', null],       // 구성 복합
    ['[11번가] 통땅콩 와플땅콩빵 200개입 (13,190원/무료배송)', '200개'],
    ['[쿠팡] 핫팩 30개입 x 2박스 (9,900원)', '60개'],
    ['[지마켓] 와이 액체세제 2.5L x 4개 (6,810원/무배)', '10000ml'],
    ['[롯데온] 덴마크 라떼 3종 250ml 12개 (14,220원/무료)', '3000ml'],
    ['[G마켓] 생수 2L 12병 (5,990원/3,000원)', '24000ml'],
    ['[네이버] 오레오 치즈케익 210g 1+1 (18,900원/무료)', '420g'],
    ['[지마켓] 국내산 볶음김치 1kg+1kg (9,920원/무료)', '2000g'],
    ['[G마켓] 펩시제로 300ml 20펫+칠성사이다 300ml 20펫(22,900원/무배)', null], // 두 상품 묶음
    ['[옥션] 쌍계명차 말차/쑥차 투고 10스틱 x 2개 (17,900원/무료)', null],      // 스틱·개 혼재
  ];
  for (const [title, want] of cases) assert.equal(qty(title), want, title);
});

test('배송비 해석', () => {
  assert.deepEqual(parseShipping('무료', 1000), { cost: 0, cond: null });
  assert.deepEqual(parseShipping('무배', 1000), { cost: 0, cond: null });
  assert.deepEqual(parseShipping('3,000원', 1000), { cost: 3000, cond: null });
  assert.deepEqual(parseShipping('2만이상무료', 25000), { cost: 0, cond: null });
  assert.equal(parseShipping('2만이상무료', 15000).cost, null);
  assert.equal(parseShipping('네멤무료', 1000).cost, null);
  assert.equal(parseShipping('네멤무료', 1000).cond, '조건부 무료배송');
  assert.equal(parseShipping('다양', 1000).cost, null);
});

test('실구매가·단위가격', () => {
  const d = { price: 5990, ship: { cost: 3000 }, qty: parseQty('[G마켓] 생수 2L 12병 (5,990원/3,000원)') };
  assert.equal(effectivePrice(d), 8990);
  assert.deepEqual(unitPrice(d), { value: 375, label: '1L' });
  assert.equal(effectivePrice({ price: 9900, ship: { cost: null } }), 9900); // 배송비 모르면 가격만
});

test('할인 조건 검출', () => {
  assert.deepEqual(detectConds('첫구매 쿠폰 적용', '토스페이 결제시 추가할인'), ['첫구매', '특정 카드·결제']);
  assert.deepEqual(detectConds('T멤버십 할인'), ['멤버십']);
  assert.deepEqual(detectConds('그냥 싸요 무료배송'), []);
});

test('제목 가격 파싱', () => {
  assert.equal(parseTitle('[카카오톡딜] 명장 김치찌개 250g 2+2 (115,40원, 무배)').price, 11540);
  assert.equal(parseTitle('[11번가] 스테비아 대추방울토마토 500g 4팩 (7,980원) (무료)').price, 7980);
  assert.equal(parseTitle('[네이버] 갤럭시탭 S12 울트라 (모델 별 상이/무료)').price, null);
});

test('목표가·주기 명령 해석', () => {
  assert.deepEqual(parseTarget('생수 1만'), { kw: '생수', max: 10000 });
  assert.deepEqual(parseTarget('휴지 9,900원'), { kw: '휴지', max: 9900 });
  assert.equal(parseTarget('생수'), null);
  assert.deepEqual(parseCycle('휴지 60일'), { kw: '휴지', days: 60 });
  assert.equal(parseCycle('휴지 3'), null); // 7일 미만 거부
});
