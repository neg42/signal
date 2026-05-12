/**
 * SIGNAL fetch-news.js v7
 *
 * 設計方針:
 * ① Google News RSS（登録不要）をメイン収集源に採用
 *    - 日本語: https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja
 *    - カテゴリ別トピックIDも使用
 * ② 個別サイトRSSは補完として使用（Google Botで取得）
 * ③ Hacker News API（完全無料・CORS不要）
 * ④ 取得失敗してもスキップして続行
 */
'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');
const { URL } = require('url');

const OUT = path.resolve(__dirname, '../data');

// ─── HTTP取得 ─────────────────────────────────────────
function httpGet(rawUrl, ua) {
  return new Promise(resolve => {
    let parsed;
    try { parsed = new URL(rawUrl); } catch { return resolve(null); }
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': ua || 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'application/rss+xml,application/xml,text/xml,*/*',
        'Accept-Language': 'ja,en;q=0.9',
        'Accept-Encoding': 'identity',
      },
      timeout: 15000,
    }, res => {
      if ([301,302,307,308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const loc = res.headers.location;
        const next = loc.startsWith('http') ? loc : `${parsed.protocol}//${parsed.hostname}${loc}`;
        return httpGet(next, ua).then(resolve);
      }
      const c = [];
      res.on('data', d => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString('utf8') }));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ─── RSS パーサー ─────────────────────────────────────
function parseDate(s) {
  if (!s) return new Date().toISOString();
  try { const d = new Date(s); return isNaN(d) ? new Date().toISOString() : d.toISOString(); }
  catch { return new Date().toISOString(); }
}
function clean(h = '') {
  return h.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
}
function firstImg(html = '') {
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : '';
}

function parseRSS(xml, defaultSource, category) {
  const items = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>|<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const chunk = m[1] || m[2];
    const txt = tag => {
      const r = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i');
      const h = r.exec(chunk);
      return h ? (h[1] || h[2] || '').trim() : '';
    };
    const atr = (tag, a) => {
      const r = new RegExp(`<${tag}[^>]+${a}=["']([^"']+)["']`, 'i');
      const h = r.exec(chunk);
      return h ? h[1] : '';
    };

    const title = clean(txt('title'));
    const link  = txt('link') || atr('link','href');
    if (!title || !link || title.length < 3) continue;

    // Google Newsのsource要素からソース名を取得
    const sourceEl = chunk.match(/<source[^>]*>([^<]*)<\/source>/i);
    const source = sourceEl ? sourceEl[1].trim() : defaultSource;

    const desc  = clean(txt('description') || txt('summary') || txt('content')).slice(0, 280);
    const date  = parseDate(txt('pubDate') || txt('published') || txt('updated'));
    const image = atr('media:thumbnail','url') || atr('media:content','url') ||
      (atr('enclosure','type').startsWith('image') ? atr('enclosure','url') : '') ||
      atr('enclosure','url') ||
      firstImg(txt('content') || txt('description') || chunk);

    items.push({ id: link, title, description: desc, url: link, image, date, source, category });
  }
  return items.slice(0, 30);
}

// ─── Google News RSS ──────────────────────────────────
// 登録不要・APIキー不要・公式RSS
// カテゴリトピックIDはURLから確認できる固定値
const GOOGLE_NEWS_SOURCES = [
  // トップニュース（日本語）
  {
    name: 'Google News トップ',
    url: 'https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja',
    category: 'society',
  },
  // 日本のニュース
  {
    name: 'Google News 日本',
    url: 'https://news.google.com/rss/topics/CAAqIQgKIhtDQkFTRGdvSUwyMHZNRE5mTTJRU0FtcGhLQUFQAQ?hl=ja&gl=JP&ceid=JP:ja',
    category: 'society',
  },
  // テクノロジー
  {
    name: 'Google News テクノロジー',
    url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtcGhLQUFQAQ?hl=ja&gl=JP&ceid=JP:ja',
    category: 'tech',
  },
  // ビジネス
  {
    name: 'Google News ビジネス',
    url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtcGhLQUFQAQ?hl=ja&gl=JP&ceid=JP:ja&topic=b',
    category: 'business',
  },
  // エンタメ
  {
    name: 'Google News エンタメ',
    url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNREpxYW5RU0FtcGhLQUFQAQ?hl=ja&gl=JP&ceid=JP:ja',
    category: 'entertainment',
  },
  // スポーツ（エンタメに含める）
  {
    name: 'Google News スポーツ',
    url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp1ZEdvU0FtcGhLQUFQAQ?hl=ja&gl=JP&ceid=JP:ja',
    category: 'entertainment',
  },
  // 科学技術（techへ）
  {
    name: 'Google News サイエンス',
    url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp0Y1RjU0FtcGhLQUFQAQ?hl=ja&gl=JP&ceid=JP:ja',
    category: 'tech',
  },
  // 検索: AI
  {
    name: 'Google News AI',
    url: 'https://news.google.com/rss/search?q=AI+人工知能&hl=ja&gl=JP&ceid=JP:ja',
    category: 'tech',
  },
  // 検索: 政治
  {
    name: 'Google News 政治',
    url: 'https://news.google.com/rss/search?q=政治+国会&hl=ja&gl=JP&ceid=JP:ja',
    category: 'politics',
  },
  // 検索: 経済
  {
    name: 'Google News 経済',
    url: 'https://news.google.com/rss/search?q=経済+株価&hl=ja&gl=JP&ceid=JP:ja',
    category: 'business',
  },
  // 検索: ゲーム
  {
    name: 'Google News ゲーム',
    url: 'https://news.google.com/rss/search?q=ゲーム+Nintendo+PlayStation&hl=ja&gl=JP&ceid=JP:ja',
    category: 'entertainment',
  },
];

// ─── 補完RSS（個別サイト）────────────────────────────
const SUPPLEMENT_SOURCES = [
  { name: 'Hacker News (via RSS)', url: 'https://news.ycombinator.com/rss', category: 'tech' },
  { name: 'TechCrunch',  url: 'https://techcrunch.com/feed/',                     category: 'tech'     },
  { name: 'Ars Technica',url: 'https://feeds.arstechnica.com/arstechnica/index',  category: 'tech'     },
  { name: 'BBC World',   url: 'https://feeds.bbci.co.uk/news/world/rss.xml',      category: 'politics' },
  { name: 'Reuters',     url: 'https://feeds.reuters.com/reuters/businessNews',    category: 'business' },
  { name: 'IGN Japan',   url: 'https://jp.ign.com/feed.xml',                      category: 'entertainment' },
  { name: 'GIGAZINE',    url: 'https://gigazine.net/news/rss_2.0/',               category: 'tech'     },
];

// ─── Hacker News API ─────────────────────────────────
async function fetchHN() {
  try {
    const r = await httpGet('https://hacker-news.firebaseio.com/topstories.json');
    if (!r || r.status !== 200) return [];
    const ids = JSON.parse(r.body).slice(0, 15);
    const stories = await Promise.all(ids.map(id =>
      httpGet(`https://hacker-news.firebaseio.com/item/${id}.json`)
        .then(r => r ? JSON.parse(r.body) : null).catch(() => null)
    ));
    return stories.filter(s => s?.title && s?.url).map(s => ({
      id: `hn-${s.id}`, title: s.title,
      description: `▲ ${s.score} points · ${s.descendants||0} comments · by ${s.by}`,
      url: s.url, image: '',
      date: new Date(s.time * 1000).toISOString(),
      source: 'Hacker News', category: 'tech',
    }));
  } catch { return []; }
}

// ─── まとめて取得 ─────────────────────────────────────
async function fetchAll(sources, ua) {
  const BATCH = 4;
  const all = [];
  for (let i = 0; i < sources.length; i += BATCH) {
    const batch = sources.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async src => {
      const r = await httpGet(src.url, ua);
      if (!r || r.status !== 200 || !r.body) {
        console.log(`  SKIP [${r?.status||'ERR'}] ${src.name}`);
        return [];
      }
      const items = parseRSS(r.body, src.name, src.category);
      const withImg = items.filter(a => a.image).length;
      console.log(`  OK   ${src.name}: ${items.length}件 (img:${withImg})`);
      return items;
    }));
    all.push(...results.flat());
    await new Promise(r => setTimeout(r, 300));
  }
  return all;
}

function dedup(arts, limit = 80) {
  const seen = new Set();
  return arts.filter(a => {
    if (!a?.title || a.title.length < 4) return false;
    const k = a.title.replace(/\s+/g,'').slice(0,40);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).sort((a,b) => new Date(b.date)-new Date(a.date)).slice(0, limit);
}

// ─── メイン ───────────────────────────────────────────
async function main() {
  console.log('SIGNAL v7 — Google News RSS + 補完ソース\n');

  // Google Newsはブラウザ風UAで
  const browserUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const botUA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

  console.log('=== Google News RSS ===');
  const gnItems = await fetchAll(GOOGLE_NEWS_SOURCES, browserUA);

  console.log('\n=== 補完RSS ===');
  const suppItems = await fetchAll(SUPPLEMENT_SOURCES, botUA);

  console.log('\n=== Hacker News API ===');
  const hn = await fetchHN();
  console.log(`  OK   Hacker News API: ${hn.length}件`);

  const all = [...gnItems, ...suppItems, ...hn];

  const cats = ['society','tech','business','entertainment','politics'];
  const byCat = Object.fromEntries(cats.map(c => [c, dedup(all.filter(a=>a.category===c))]));
  byCat.custom = [];
  byCat.all = dedup(all, 120);

  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT,'news.json'), JSON.stringify(byCat, null, 2));
  fs.writeFileSync(path.join(OUT,'meta.json'), JSON.stringify({
    updatedAt: new Date().toISOString(),
    counts: Object.fromEntries(Object.entries(byCat).map(([k,v])=>[k,v.length])),
  }, null, 2));

  console.log('\n=== 結果 ===');
  Object.entries(byCat).forEach(([k,v]) => console.log(`  ${k}: ${v.length}件`));
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
