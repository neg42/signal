/**
 * SIGNAL fetch-news.js — 日本語ソース統一版
 * 英語のみのソース（BBC World等）を除外
 * Google News RSS（日本語）をメイン収集源に
 */
'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');
const { URL } = require('url');

const OUT = path.resolve(__dirname, '../data');

function httpGet(rawUrl, ua) {
  return new Promise(resolve => {
    let parsed;
    try { parsed = new URL(rawUrl); } catch { return resolve(null); }
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': ua || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
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

// HTMLを完全除去（font/a/spanタグ含む）
function stripHTML(html = '') {
  return String(html)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
    .replace(/&[a-z]+;/g,' ')  // その他HTMLエンティティ
    .replace(/\s+/g,' ').trim();
}

function parseDate(s) {
  if (!s) return new Date().toISOString();
  try { const d = new Date(s); return isNaN(d) ? new Date().toISOString() : d.toISOString(); }
  catch { return new Date().toISOString(); }
}

// 日本語テキストかどうか判定（記事フィルタ用）
function hasJapanese(text = '') {
  return /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/.test(text);
}

function parseRSS(xml, defaultSource, category, jpOnly = false) {
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

    const rawTitle = txt('title');
    const title = stripHTML(rawTitle);
    const link  = txt('link') || atr('link','href');
    if (!title || !link || title.length < 3) continue;

    // 日本語フィルタ
    if (jpOnly && !hasJapanese(title)) continue;

    // Google NewsのsourceタグからメディアN名を取得
    const srcMatch = chunk.match(/<source[^>]*>([^<]*)<\/source>/i);
    const source = srcMatch ? stripHTML(srcMatch[1]) : defaultSource;

    const rawDesc = txt('description') || txt('summary') || txt('content') || '';
    const desc = stripHTML(rawDesc).slice(0, 200);
    const date = parseDate(txt('pubDate') || txt('published') || txt('updated'));

    items.push({ id: link, title, description: desc, url: link, image: '', date, source, category });
  }
  return items.slice(0, 30);
}

// ─── ソース定義（日本語のみ）────────────────────────
const GOOGLE_NEWS = [
  // トップ・日本（日本語フィルタあり）
  { name: 'Google News', url: 'https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja',                                                                                      category: 'society',       jpOnly: true },
  { name: 'Google News', url: 'https://news.google.com/rss/topics/CAAqIQgKIhtDQkFTRGdvSUwyMHZNRE5mTTJRU0FtcGhLQUFQAQ?hl=ja&gl=JP&ceid=JP:ja',                           category: 'society',       jpOnly: true },
  // テクノロジー
  { name: 'Google News', url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtcGhLQUFQAQ?hl=ja&gl=JP&ceid=JP:ja',                           category: 'tech',          jpOnly: true },
  { name: 'Google News', url: 'https://news.google.com/rss/search?q=AI+人工知能+テクノロジー&hl=ja&gl=JP&ceid=JP:ja',                                                      category: 'tech',          jpOnly: true },
  // ビジネス
  { name: 'Google News', url: 'https://news.google.com/rss/search?q=経済+株価+ビジネス&hl=ja&gl=JP&ceid=JP:ja',                                                           category: 'business',      jpOnly: true },
  // エンタメ・ゲーム
  { name: 'Google News', url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNREpxYW5RU0FtcGhLQUFQAQ?hl=ja&gl=JP&ceid=JP:ja',                           category: 'entertainment', jpOnly: true },
  { name: 'Google News', url: 'https://news.google.com/rss/search?q=ゲーム+アニメ+エンタメ&hl=ja&gl=JP&ceid=JP:ja',                                                       category: 'entertainment', jpOnly: true },
  // 政治（日本語のみ）
  { name: 'Google News', url: 'https://news.google.com/rss/search?q=政治+国会+選挙&hl=ja&gl=JP&ceid=JP:ja',                                                               category: 'politics',      jpOnly: true },
  { name: 'Google News', url: 'https://news.google.com/rss/search?q=内閣+首相+外交&hl=ja&gl=JP&ceid=JP:ja',                                                               category: 'politics',      jpOnly: true },
  // テレビ局ニュースを明示的にキーワード検索
  { name: 'Google News', url: 'https://news.google.com/rss/search?q=NHK+OR+テレ朝+OR+TBS+OR+フジ+OR+日テレ+ニュース&hl=ja&gl=JP&ceid=JP:ja',                               category: 'society',       jpOnly: true },
];

const RSS_JP = [
  // 日本語RSSのみ（英語ソースを完全除外）
  { name: 'GIGAZINE',          url: 'https://gigazine.net/news/rss_2.0/',            category: 'tech',          jpOnly: false },
  { name: 'ファミ通',           url: 'https://www.famitsu.com/feed',                  category: 'entertainment', jpOnly: false },
  { name: '電撃オンライン',      url: 'https://dengekionline.com/rss/all.rss',         category: 'entertainment', jpOnly: false },
  { name: 'ORICON NEWS',       url: 'https://www.oricon.co.jp/rss/news.rdf',         category: 'entertainment', jpOnly: false },
  { name: 'ナタリー',           url: 'https://natalie.mu/music/feed/news',            category: 'entertainment', jpOnly: false },
  { name: 'IGN Japan',         url: 'https://jp.ign.com/feed.xml',                   category: 'entertainment', jpOnly: false },
  { name: 'Hacker News',       url: 'https://news.ycombinator.com/rss',              category: 'tech',          jpOnly: false }, // 英語だがtech専門
];

async function fetchAll(sources) {
  const BATCH = 4;
  const all = [];
  for (let i = 0; i < sources.length; i += BATCH) {
    const batch = sources.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async src => {
      const r = await httpGet(src.url);
      if (!r || r.status !== 200 || !r.body) {
        console.log(`  SKIP [${r?.status||'ERR'}] ${src.name} ${src.url.slice(0,60)}`);
        return [];
      }
      const items = parseRSS(r.body, src.name, src.category, src.jpOnly || false);
      console.log(`  OK   ${src.name}(${src.category}): ${items.length}件`);
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

async function main() {
  console.log('SIGNAL fetch-news — 日本語ソース統一版\n');

  console.log('=== Google News RSS ===');
  const gnItems = await fetchAll(GOOGLE_NEWS);

  console.log('\n=== 個別RSS ===');
  const rssItems = await fetchAll(RSS_JP);

  const all = [...gnItems, ...rssItems];

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
