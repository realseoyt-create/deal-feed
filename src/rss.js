import { parseTitle, categorize } from './parse.js';
import { parseShipping, parseQty, effectivePrice } from './qty.js';

export const FEEDS = [
  { source: 'ppomppu', url: 'https://www.ppomppu.co.kr/rss.php?id=ppomppu' },
];

const decode = s => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&amp;/g, '&')
  .replace(/<[^>]+>/g, '').trim();

const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return m ? decode(m[1]) : null; };

export async function fetchFeed({ source, url }) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (personal deal-feed)' } });
  if (!res.ok) throw new Error(`${source} HTTP ${res.status}`);
  const xml = await res.text();
  return xml.split('<item>').slice(1).map(s => s.split('</item>')[0]).map(it => {
    const title = tag(it, 'title') ?? '';
    const link = (tag(it, 'link') ?? '').replace('http://', 'https://');
    const no = Number((link.match(/no=(\d+)/) || [])[1]) || null;
    const summary = tag(it, 'description') ?? '';
    const parsed = parseTitle(title); // 재수집 때마다 최신 파싱 규칙으로 갱신됨
    const pub = tag(it, 'pubDate');
    const posted = pub ? new Date(pub) : new Date();
    // 뽐뿌 RSS hits: [추천|조회|?|?] (관찰 기반 추정)
    const [recommend = 0, views = 0, react2 = 0] = (tag(it, 'hits')?.match(/\[([^\]]*)\]/)?.[1] ?? '').split('|').map(Number);
    const ageMin = Math.max(5, (Date.now() - posted) / 60000);
    // 배송비·용량 해석 (애매하면 null) → 실구매가
    const ship = parseShipping(parsed.shipping, parsed.price);
    const qty = parseQty(title);
    const eff = effectivePrice({ price: parsed.price, ship });
    return {
      ship, qty: qty ?? undefined, eff,
      id: `${source}:${no ?? link}`, source, no, title, ...parsed,
      category: categorize(parsed.product, summary),
      // 공개 저장소: 본문 원문은 파일에 저장하지 않음 (_로 시작 → 저장 직전 제거)
      // 이번 실행 안에서만 AI 포인트 추출·텔레그램(비공개) 발송에 사용
      _body: summary.replace(/\s+/g, ' ').trim().slice(0, 400) || undefined,
      excluded_hint: /종료|품절|마감/.test(summary) || undefined,
      url: link,
      recommend: recommend || 0, views: views || 0, react2: react2 || 0, // react2: 의미 미확인(관찰용)
      views_per_min: Math.round((views || 0) / ageMin * 10) / 10,
      posted_at: posted.toISOString(),
    };
  });
}
