/**
 * SIGNAL v4 — ニュース収集スクリプト
 * =====================================================
 * 外部サービスへのユーザー登録一切不要。
 * GitHub Actions の標準機能と公開APIのみ使用。
 *
 * 収集方法:
 *  [A] OGPスクレイピング  — RSS非対応のテレビ局ニュースサイト
 *  [B] RSS直接取得        — 新聞社・ネットメディア（標準技術）
 *  [C] 公開API（登録不要）— Hacker News Firebase API
 *                          Wikipedia "今日のニュース" (任意)
 *
 * 依存パッケージ: なし（Node.js 標準モジュールのみ）
 */

'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');
const { URL } = require('url');

// ─── 設定 ───────────────────────────────────────────
const OUT_DIR     = path.resolve(__dirname, '../data');
const CONCURRENCY = 4;   // 同時リクエスト数
const HN_COUNT    = 25;  // Hacker News 取得件数
const RSS_LIMIT   = 20;  // 各RSSソースの最大件数
const SCRAPE_LIMIT = 20; // 各サイトの最大記事数

// ─── HTTP クライアント（標準モジュールのみ）──────────
function httpGet(rawUrl, opts = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(rawUrl); }
    catch (e) { return reject(new Error('Invalid URL: ' + rawUrl)); }

    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      port: parsed.port || undefined,
      headers: {
        // 一般的なブラウザと同じUAを送る（多くのニュースサイトがUA確認する）
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
        ...opts.headers,
      },
      timeout: opts.timeout || 14000,
    }, res => {
      // リダイレクト追従（最大3回）
      const redirectCount = (opts._redirects || 0);
      if ([301,302,307,308].includes(res.statusCode) && res.headers.location && redirectCount < 3) {
        res.resume();
        let next = res.headers.location;
        if (!next.startsWith('http')) next = `${parsed.protocol}//${parsed.hostname}${next}`;
        return httpGet(next, { ...opts, _redirects: redirectCount + 1 }).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
        json() { return JSON.parse(this.body); },
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout: ' + rawUrl)); });
    req.end();
  });
}

// ─── ユーティリティ ──────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function stripHTML(html = '') {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
    .replace(/\s+/g,' ').trim();
}

function parseDate(str) {
  if (!str) return new Date().toISOString();
  try { const d = new Date(str); return isNaN(d) ? new Date().toISOString() : d.toISOString(); }
  catch { return new Date().toISOString(); }
}

function toAbsUrl(base, href = '') {
  if (!href || href.startsWith('#')) return '';
  if (href.startsWith('http')) return href;
  try { return new URL(href, base).href; } catch { return ''; }
}

// ─── OGP 抽出 ────────────────────────────────────────
function extractOGP(html, baseUrl) {
  const get = prop => {
    const patterns = [
      new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`, 'i'),
      new RegExp(`<meta[^>]+name=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'),
    ];
    for (const pat of patterns) {
      const m = html.match(pat);
      if (m) return m[1].trim();
    }
    return '';
  };
  // 記事の日付を複数パターンで探す
  const datePatterns = [
    /<time[^>]+datetime=["']([^"']+)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /"publishedAt"\s*:\s*"([^"]+)"/i,
    /<meta[^>]+name=["']pubdate["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,
  ];
  let dateStr = '';
  for (const pat of datePatterns) {
    const m = html.match(pat);
    if (m) { dateStr = m[1]; break; }
  }
  return {
    title: get('title'),
    description: get('description'),
    image: get('image'),
    url: get('url') || baseUrl,
    date: parseDate(dateStr),
  };
}

// ─── リンク抽出 ──────────────────────────────────────
function extractLinks(html, baseUrl, pattern) {
  const re = new RegExp('href=["\']([^"\'#?]*' + pattern + '[^"\'#?]*)["\']', 'gi');
  const links = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = toAbsUrl(baseUrl, m[1]);
    if (url && url.length < 300) links.add(url);
  }
  return [...links];
}

// ─── 記事バッチ取得（OGP） ───────────────────────────
async function fetchArticlesBatch(urls, sourceName, category, limit = SCRAPE_LIMIT) {
  const targets = [...new Set(urls)].slice(0, limit);
  const results = [];
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const fetched = await Promise.all(batch.map(async url => {
      try {
        const res = await httpGet(url, { timeout: 12000 });
        if (res.status !== 200) return null;
        const ogp = extractOGP(res.body, url);
        if (!ogp.title || ogp.title.length < 5) return null;
        return {
          id: url,
          title: ogp.title,
          description: (ogp.description || '').slice(0, 250),
          url,
          image: ogp.image || '',
          date: ogp.date,
          source: sourceName,
          category,
        };
      } catch { return null; }
    }));
    results.push(...fetched.filter(Boolean));
    if (i + CONCURRENCY < targets.length) await sleep(400);
  }
  return results;
}

// ══════════════════════════════════════════════════════
//  [A] テレビ局スクレイパー（RSS非対応）
// ══════════════════════════════════════════════════════

async function scrapeANN() {
  // テレビ朝日系 ANNニュース
  const BASE = 'https://news.tv-asahi.co.jp';
  try {
    const res = await httpGet(BASE);
    const raw = extractLinks(res.body, BASE, '/articles/');
    const links = raw.filter(u => /\/articles\/\d+/.test(u));
    const arts = await fetchArticlesBatch(links, 'ANN テレ朝', 'society');
    console.log(`  ✓ ANN テレ朝: ${arts.length}件`);
    return arts;
  } catch(e) { console.log(`  ✗ ANN: ${e.message}`); return []; }
}

async function scrapeTBSNews() {
  // TBS NEWS DIG
  const BASE = 'https://newsdig.tbs.co.jp';
  try {
    const res = await httpGet(`${BASE}/articles`);
    const links = extractLinks(res.body, BASE, '/articles/-/').filter(u => /\/articles\/-\/\d+/.test(u));
    const arts = await fetchArticlesBatch(links, 'TBS NEWS DIG', 'society');
    console.log(`  ✓ TBS NEWS DIG: ${arts.length}件`);
    return arts;
  } catch(e) { console.log(`  ✗ TBS: ${e.message}`); return []; }
}

async function scrapeFNN() {
  // フジテレビ系 FNNプライムオンライン
  const BASE = 'https://www.fnn.jp';
  try {
    const res = await httpGet(`${BASE}/articles`);
    const links = extractLinks(res.body, BASE, '/articles/@').filter(u => u.includes('/articles/@'));
    const arts = await fetchArticlesBatch(links, 'FNN プライムオンライン', 'society');
    console.log(`  ✓ FNN: ${arts.length}件`);
    return arts;
  } catch(e) { console.log(`  ✗ FNN: ${e.message}`); return []; }
}

async function scrapeNTV() {
  // 日本テレビ NEWS
  const BASE = 'https://news.ntv.co.jp';
  try {
    const res = await httpGet(BASE);
    const links = extractLinks(res.body, BASE, '/articles/').filter(u => /\/articles\/[\w-]+$/.test(u));
    const arts = await fetchArticlesBatch(links, '日テレ NEWS', 'society');
    console.log(`  ✓ 日テレ: ${arts.length}件`);
    return arts;
  } catch(e) { console.log(`  ✗ 日テレ: ${e.message}`); return []; }
}

async function scrapeTVTokyo() {
  // テレビ東京 BIZ（経済ニュース）
  const BASE = 'https://txbiz.tv-tokyo.co.jp';
  try {
    const res = await httpGet(`${BASE}/news`);
    const links = extractLinks(res.body, BASE, '/news/articles/').filter(u => u.includes('/news/articles/'));
    const arts = await fetchArticlesBatch(links, 'テレ東BIZ', 'business', 15);
    console.log(`  ✓ テレ東BIZ: ${arts.length}件`);
    return arts;
  } catch(e) { console.log(`  ✗ テレ東: ${e.message}`); return []; }
}

async function scrapeMBS() {
  // MBS NEWS（毎日放送）
  const BASE = 'https://www.mbs.jp';
  try {
    const res = await httpGet(`${BASE}/news/articles`);
    const links = extractLinks(res.body, BASE, '/news/articles/').filter(u => /\/news\/articles\/[A-Z0-9]+/.test(u));
    const arts = await fetchArticlesBatch(links, 'MBS NEWS', 'society', 15);
    console.log(`  ✓ MBS: ${arts.length}件`);
    return arts;
  } catch(e) { console.log(`  ✗ MBS: ${e.message}`); return []; }
}

// ══════════════════════════════════════════════════════
//  [B] RSS 直接取得（登録不要・標準技術）
// ══════════════════════════════════════════════════════

const RSS_SOURCES = [
  // ── 社会 ──────────────────────────────────────────
  { name: 'NHK ニュース',       url: 'https://www3.nhk.or.jp/rss/news/cat0.xml',            category: 'society'       },
  { name: 'NHK 社会',          url: 'https://www3.nhk.or.jp/rss/news/cat1.xml',             category: 'society'       },
  { name: '朝日新聞',           url: 'https://www.asahi.com/rss/asahi/newsheadlines.rdf',    category: 'society'       },
  { name: '毎日新聞',           url: 'https://mainichi.jp/rss/etc/mainichi-flash.rss',        category: 'society'       },
  { name: '読売新聞',           url: 'https://www.yomiuri.co.jp/feed/top/',                   category: 'society'       },
  // ── テクノロジー・AI ────────────────────────────
  { name: 'TechCrunch',        url: 'https://techcrunch.com/feed/',                          category: 'tech'          },
  { name: 'Ars Technica',      url: 'https://feeds.arstechnica.com/arstechnica/index',       category: 'tech'          },
  { name: 'WIRED Japan',       url: 'https://wired.jp/rss/',                                 category: 'tech'          },
  { name: 'GIGAZINE',          url: 'https://gigazine.net/news/rss_2.0/',                    category: 'tech'          },
  { name: 'Engadget Japan',    url: 'https://japanese.engadget.com/rss.xml',                 category: 'tech'          },
  { name: 'Gizmodo Japan',     url: 'https://www.gizmodo.jp/index.xml',                      category: 'tech'          },
  // ── ビジネス・経済 ──────────────────────────────
  { name: 'NHK 経済',          url: 'https://www3.nhk.or.jp/rss/news/cat5.xml',             category: 'business'      },
  { name: '東洋経済オンライン',  url: 'https://toyokeizai.net/list/feed/rss',                 category: 'business'      },
  { name: 'Reuters Business',  url: 'https://feeds.reuters.com/reuters/businessNews',        category: 'business'      },
  { name: 'ダイヤモンド・オンライン', url: 'https://diamond.jp/list/feed/rss',              category: 'business'      },
  // ── エンタメ・ゲーム ────────────────────────────
  { name: 'ファミ通',           url: 'https://www.famitsu.com/feed',                          category: 'entertainment' },
  { name: '電撃オンライン',      url: 'https://dengekionline.com/rss/all.rss',                 category: 'entertainment' },
  { name: 'ORICON NEWS',       url: 'https://www.oricon.co.jp/rss/news.rdf',                 category: 'entertainment' },
  { name: 'ナタリー 音楽',      url: 'https://natalie.mu/music/feed/news',                    category: 'entertainment' },
  { name: 'ナタリー コミック',   url: 'https://natalie.mu/comic/feed/news',                   category: 'entertainment' },
  { name: 'IGN Japan',         url: 'https://jp.ign.com/feed.xml',                           category: 'entertainment' },
  // ── 政治 ────────────────────────────────────────
  { name: 'NHK 政治',          url: 'https://www3.nhk.or.jp/rss/news/cat4.xml',             category: 'politics'      },
  { name: 'NHK 国際',          url: 'https://www3.nhk.or.jp/rss/news/cat6.xml',             category: 'politics'      },
  { name: 'BBC World',         url: 'http://feeds.bbci.co.uk/news/world/rss.xml',            category: 'politics'      },
  { name: 'Reuters Politics',  url: 'https://feeds.reuters.com/Reuters/PoliticsNews',        category: 'politics'      },
];

function parseRSS(xml, sourceName, category) {
  const items = [];
  const itemRx = /<item[^>]*>([\s\S]*?)<\/item>|<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = itemRx.exec(xml)) !== null) {
    const chunk = m[1] || m[2];
    const getText = tag => {
      const r = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i');
      const h = r.exec(chunk);
      return h ? (h[1] || h[2] || '').trim() : '';
    };
    const getAttr = (tag, attr) => {
      const r = new RegExp(`<${tag}[^>]+${attr}=["']([^"']+)["']`, 'i');
      const h = r.exec(chunk);
      return h ? h[1] : '';
    };
    const title = stripHTML(getText('title'));
    const link  = getText('link') || getAttr('link', 'href') || getAttr('enclosure', 'url');
    const desc  = stripHTML(getText('description') || getText('summary') || getText('content')).slice(0, 280);
    const date  = parseDate(getText('pubDate') || getText('published') || getText('updated'));
    const image = getAttr('enclosure', 'url') || getAttr('media:thumbnail', 'url') || (() => {
      const im = chunk.match(/<img[^>]+src=["']([^"']+)["']/i); return im ? im[1] : '';
    })();
    if (title && link && title.length > 4) {
      items.push({ id: link, title, description: desc, url: link, image, date, source: sourceName, category });
    }
  }
  return items.slice(0, RSS_LIMIT);
}

async function fetchAllRSS() {
  const results = [];
  for (let i = 0; i < RSS_SOURCES.length; i += CONCURRENCY) {
    const batch = RSS_SOURCES.slice(i, i + CONCURRENCY);
    const res = await Promise.all(batch.map(async src => {
      try {
        const r = await httpGet(src.url, { timeout: 12000 });
        const items = parseRSS(r.body, src.name, src.category);
        console.log(`  ✓ RSS ${src.name}: ${items.length}件`);
        return items;
      } catch(e) {
        console.log(`  ✗ RSS ${src.name}: ${e.message}`);
        return [];
      }
    }));
    results.push(...res.flat());
    await sleep(150);
  }
  return results;
}

// ══════════════════════════════════════════════════════
//  [C] 公開API（登録不要）
// ══════════════════════════════════════════════════════

async function fetchHackerNews() {
  // Firebase Realtime Database API — 完全無料・登録不要・無制限
  try {
    const topRes = await httpGet('https://hacker-news.firebaseio.com/topstories.json');
    const ids = topRes.json().slice(0, HN_COUNT);
    const stories = await Promise.all(
      ids.map(id =>
        httpGet(`https://hacker-news.firebaseio.com/item/${id}.json`)
          .then(r => r.json()).catch(() => null)
      )
    );
    const items = stories.filter(s => s && s.title && s.url).map(s => ({
      id: `hn-${s.id}`,
      title: s.title,
      description: `▲ ${s.score} points · ${s.descendants || 0} comments · by ${s.by}`,
      url: s.url,
      image: '',
      date: new Date(s.time * 1000).toISOString(),
      source: 'Hacker News',
      category: 'tech',
    }));
    console.log(`  ✓ Hacker News: ${items.length}件`);
    return items;
  } catch(e) { console.log(`  ✗ Hacker News: ${e.message}`); return []; }
}

// ─── 重複除去 & ソート ───────────────────────────────
function dedupSort(articles, limit = 80) {
  const seen = new Set();
  return articles
    .filter(a => {
      if (!a?.title || a.title.length < 5) return false;
      const k = a.title.replace(/\s+/g, '').slice(0, 40);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit);
}

// ─── メイン ──────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  console.log('\n📡 SIGNAL v4 ニュース収集開始\n');
  console.log('━━━ [A] テレビ局スクレイピング（登録不要）━━━━━━');

  const [ann, tbs, fnn, ntv, tvtokyo, mbs] = await Promise.all([
    scrapeANN(), scrapeTBSNews(), scrapeFNN(),
    scrapeNTV(), scrapeTVTokyo(), scrapeMBS(),
  ]);

  console.log('\n━━━ [B] RSS フィード（登録不要）━━━━━━━━━━━━━━━━');
  const rssAll = await fetchAllRSS();

  console.log('\n━━━ [C] 公開API（登録不要）━━━━━━━━━━━━━━━━━━━━');
  const hn = await fetchHackerNews();

  // ─── カテゴリ別に振り分け ─────────────────────────
  console.log('\n━━━ 振り分け & 重複除去 ━━━━━━━━━━━━━━━━━━━━━━━');

  const cat = cat => rssAll.filter(a => a.category === cat);

  const byCategory = {
    society:       dedupSort([...ann, ...tbs, ...fnn, ...ntv, ...mbs, ...cat('society')]),
    tech:          dedupSort([...hn, ...cat('tech')]),
    business:      dedupSort([...tvtokyo, ...cat('business')]),
    entertainment: dedupSort([...cat('entertainment')]),
    politics:      dedupSort([...cat('politics')]),
    custom:        [],
  };
  byCategory.all = dedupSort(Object.values(byCategory).flat(), 120);

  // ─── 書き出し ──────────────────────────────────────
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const meta = {
    updatedAt: new Date().toISOString(),
    elapsedSeconds: parseFloat(elapsed),
    counts: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, v.length])),
    requires_registration: false,
    external_services: 'none — GitHub Actions only',
    sources: {
      scraped_tv: ['ANN テレ朝', 'TBS NEWS DIG', 'FNN', '日テレ NEWS', 'テレ東BIZ', 'MBS NEWS'],
      rss: RSS_SOURCES.map(s => s.name),
      api_no_key: ['Hacker News Firebase API'],
    },
  };

  fs.writeFileSync(path.join(OUT_DIR, 'news.json'), JSON.stringify(byCategory, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2));

  console.log('\n✅ 完了 (' + elapsed + 's):');
  Object.entries(meta.counts).forEach(([k, v]) => console.log(`   ${(k + ':').padEnd(16)} ${v}件`));
  console.log('\n外部サービス登録: 不要');
}

main().catch(e => { console.error('\n💥 Fatal:', e); process.exit(1); });
