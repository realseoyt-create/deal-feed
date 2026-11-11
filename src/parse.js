// 뽐뿌 제목 예: "[11번가] 아임팩트 쿠킹 탄산수 100g 3개 (3,660원/2만이상무료)"
export function parseTitle(title) {
  const t = title.trim();
  const mallM = t.match(/^\[([^\]]+)\]\s*/);
  const mall = mallM ? normalizeMall(mallM[1]) : null;
  let rest = mallM ? t.slice(mallM[0].length) : t;

  // 마지막 괄호 덩어리를 가격/배송 정보로 간주
  const tailM = rest.match(/\(([^()]*)\)\s*$/);
  let price = null, shipping = null;
  if (tailM) {
    const parts = tailM[1].split(/\s*\/\s*|,\s+/).map(s => s.trim());
    price = parsePrice(parts[0]);
    shipping = parts.slice(1).join('/') || null;
    if (price !== null || shipping) rest = rest.slice(0, tailM.index).trim();
  }
  if (price === null) price = parsePrice(rest);
  // 100원 미만(0 제외)은 모델번호·수량 오인식일 가능성이 높음 → 가격 미상
  if (price !== null && price > 0 && price < 100) price = null;
  return { mall, product: rest, price, shipping };
}

const MALL_ALIAS = { '지마켓': 'G마켓', 'gmarket': 'G마켓', '11st': '11번가', '네이버쇼핑': '네이버', '스마트스토어': '네이버', '카카오톡 선물하기': '카카오', '쿠팡로켓': '쿠팡' };
function normalizeMall(s) {
  const k = s.trim();
  return MALL_ALIAS[k] ?? MALL_ALIAS[k.toLowerCase()] ?? k;
}

function parsePrice(s) {
  if (!s) return null;
  if (/무료|0원/.test(s) && !/\d{2,}/.test(s)) return 0;
  const man = s.match(/([\d.]+)\s*만\s*(\d{1,4})?/);           // 3만9천 등은 단순 처리
  const m = s.match(/(\d[\d,]*)\s*원/) || s.match(/(\d{1,3}(?:,\d{3})+|\d+)/);
  if (m) {
    const n = Number(m[1].replace(/,/g, ''));
    if (man && s.indexOf(man[0]) <= s.indexOf(m[0]) && n < 10000) return Math.round(Number(man[1]) * 10000);
    return n;
  }
  return null;
}

const RULES = [
  ['생활용품', /휴지|화장지|물티슈|키친타월|세제|섬유유연|샴푸|린스|바디워시|치약|칫솔|면도|생리대|기저귀|마스크|비누|핸드워시|건전지|쓰레기봉투|랩|호일|지퍼백|수세미|방향제|탈취|청소|행주|고무장갑|세탁/],
  ['식품', /국내산|햇|밤\b|\d+kg|로스팜|통조림|\d+캔|계란|유정란|달걀|새우|오징어|연어|고등어|햄|소시지|케이크|케익|쿠키|빵|떡|찌개|두부|오레오|생수|탄산수|커피|라면|햇반|즉석밥|김치|고기|돼지|소고기|한우|닭|계란|우유|두유|과자|아이스크림|음료|콜라|사이다|맥주|쌀|견과|과일|사과|귤|만두|치킨|피자|참치|스팸|김\b|소스|젤리|초콜릿|커피|차\b|단백질|프로틴|영양제|비타민|유산균/],
  ['디지털/가전', /노트북|모니터|SSD|HDD|램|그래픽|CPU|키보드|마우스|이어폰|헤드폰|버즈|에어팟|갤럭시|아이폰|아이패드|태블릿|충전기|케이블|보조배터리|TV|청소기|에어컨|냉장고|세탁기|건조기|공기청정|가습기|제습기|전자레인지|밥솥|선풍기|스피커|카메라|공유기|USB|스마트워치/i],
  ['패션/뷰티', /티셔츠|셔츠|바지|청바지|자켓|패딩|코트|운동화|신발|양말|속옷|가방|모자|크림|로션|선크림|스킨|토너|세럼|마스크팩|향수|립|쿠션|파운데이션|올리브영/],
  ['상품권/쿠폰', /상품권|기프티콘|쿠폰|포인트|적립|페이백|캐시백|멤버십|구독/],
];

// 상품명 우선. 요약은 "쿠폰 적용" 같은 말이 많아 상품권 규칙은 빼고 보조로만 사용
export function categorize(product, summary = '') {
  for (const [cat, re] of RULES) if (re.test(product)) return cat;
  for (const [cat, re] of RULES) if (cat !== '상품권/쿠폰' && re.test(summary)) return cat;
  return '기타';
}
