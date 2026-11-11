import { parseTitle, categorize } from './parse.js';

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
    const parsed = parseTitle(title);
    const pub = tag(it, 'pubDate');
    const posted = pub ? new Date(pub) : new Date();
    // 뽐뿌 RSS hits: [추천|조회|?|?] (관찰 기반 추정)
    const [recommend = 0, views = 0] = (tag(it, 'hits')?.match(/\[([^\]]*)\]/)?.[1] ?? '').split('|').map(Number);
    const ageMin = Math.max(5, (Date.now() - posted) / 60000);
    return {
      id: `${source}:${no ?? link}`, source, no, title, ...parsed,
      category: categorize(parsed.product, summary),
      // 공개 저장소: 본문 요약은 저장하지 않음 (판정용 키워드만 사용)
      excluded_hint: /종료|품절|마감/.test(summary) || undefined,
      url: link,
      recommend: recommend || 0, views: views || 0,
      views_per_min: Math.round((views || 0) / ageMin * 10) / 10,
      posted_at: posted.toISOString(),
    };
  });
}
