/**
 * SIGNAL fetch-news.js
 *
 * Google News RSSのdescriptionはHTMLリンクのみで実質不要なため空にする。
 * titleとsourceのみを使用。日本語記事のみ収集。
 */
'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');
const { URL } = require('url');

const OUT = path.resolve(__dirname, '../data');

function httpGet(rawUrl) {
  return new Promise(resolve => {
    let parsed;
    try { parsed = new URL(rawUrl); } catch { return resolve(null); }
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
        'Accept': 'application/rss+xml,application/xml,text/xml,*/*',
        'Accept-Language': 'ja,en;q=0.5',
        'Accept-Encoding': 'identity',
      },
      timeout: 15000,
    }, res => {
      if ([301,302,307,308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const loc = res.headers.location;
        const next = loc.startsWith('http') ? loc : `${parsed.protocol}//${parsed.hostname}${loc}`;
        return httpGet(next).then(resolve);
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

// テキストのみ抽出（HTML完全除去）
function toText(raw = '') {
  return String(raw)
    // CDATAを展開
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    // タグを全部除去
    .replace(/<[^>]+>/g, ' ')
    // HTMLエンティティ
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
    .replace(/&[a-z#0-9]+;/gi,' ')
    .replace(/\s+/g,' ').trim();
}

// 日本語文字が含まれるか
function isJP(s = '') {
  return /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/.test(s);
}

function parseDate(s) {
  if (!s) return new Date().toISOString();
  try { const d = new Date(s); return isNaN(d) ? new Date().toISOString() : d.toISOString(); }
  catch { return new Date().toISOString(); }
}

function parseRSS(xml, fallbackSource, category) {
  const items = [];
  // itemタグを抽出
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const chunk = m[1];

    // titleを取得（CDATA対応）
    const titleRaw = (() => {
      const c = /<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i.exec(chunk);
      if (c) return c[1];
      const p = /<title[^>]*>([^<]*)<\/title>/i.exec(chunk);
      return p ? p[1] : '';
    })();
    const title = toText(titleRaw);

    // titleが空または日本語なしはスキップ
    if (!title || title.length < 3) continue;
    if (!isJP(title)) continue;

    // linkを取得
    const linkRaw = (() => {
      const p = /<link[^>]*>([^<]*)<\/link>/i.exec(chunk);
      if (p && p[1].trim()) return p[1].trim();
      const a = /<link[^>]+href=["']([^"']+)["']/i.exec(chunk);
      return a ? a[1] : '';
    })();
    if (!linkRaw) continue;

    // Google NewsのsourceタグからメディアN名を取得
    const srcRaw = (() => {
      const s = /<source[^>]*>([\s\S]*?)<\/source>/i.exec(chunk);
      return s ? s[1] : fallbackSource;
    })();
    const source = toText(srcRaw) || fallbackSource;

    // pubDateを取得
    const dateRaw = (() => {
      const d = /<pubDate[^>]*>([^<]*)<\/pubDate>/i.exec(chunk);
      return d ? d[1] : '';
    })();

    // descriptionは意図的に空にする
    // （Google NewsのdescriptionはHTMLリンクのみで実質的な情報がない）
    const description = '';

    items.push({
      id: linkRaw,
      title,
      description,
      url: linkRaw,
      image: '',
      date: parseDate(dateRaw),
      source,
      category,
    });
  }
  return items.slice(0, 30);
}

// 個別RSSはdescriptionをテキスト化して使う
function parseRSSWithDesc(xml, sourceName, category) {
  const items = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const chunk = m[1];
    const get = tag => {
      const c = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i').exec(chunk);
      if (c) return c[1];
      const p = new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i').exec(chunk);
      return p ? p[1] : '';
    };
    const atr = (tag, a) => {
      const r = new RegExp(`<${tag}[^>]+${a}=["']([^"']+)["']`, 'i').exec(chunk);
      return r ? r[1] : '';
    };

    const title = toText(get('title'));
    const link = get('link') || atr('link','href');
    if (!title || !link || title.length < 3) continue;
    if (!isJP(title)) continue;

    // descriptionはHTMLを除去してから使用
    const rawDesc = get('description') || get('summary') || '';
    // aタグを中身ごと削除してからtoText
    const desc = toText(rawDesc.replace(/<a[\s\S]*?<\/a>/gi, '')).slice(0, 120);

    items.push({
      id: link, title, description: desc, url: link, image: '',
      date: parseDate(get('pubDate') || get('published')),
      source: sourceName, category,
    });
  }
  return items.slice(0, 25);
}

// ─── ソース定義 ───────────────────────────────────────
const GN_SOURCES = [
  // 社会
  { url: 'https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja',                                                                         cat: 'society' },
  { url: 'https://news.google.com/rss/topics/CAAqIQgKIhtDQkFTRGdvSUwyMHZNRE5mTTJRU0FtcGhLQUFQAQ?hl=ja&gl=JP&ceid=JP:ja',              cat: 'society' },
  { url: 'https://news.google.com/rss/search?q=NHKニュース+OR+テレ朝+OR+TBS+OR+フジテレビ+OR+日テレ&hl=ja&gl=JP&ceid=JP:ja',           cat: 'society' },
  { url: 'https://news.google.com/rss/search?q=事件+事故+社会&hl=ja&gl=JP&ceid=JP:ja',                                                 cat: 'society' },
  // テクノロジー
  { url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtcGhLQUFQAQ?hl=ja&gl=JP&ceid=JP:ja',              cat: 'tech'    },
  { url: 'https://news.google.com/rss/search?q=AI+人工知能+ChatGPT&hl=ja&gl=JP&ceid=JP:ja',                                            cat: 'tech'    },
  { url: 'https://news.google.com/rss/search?q=スマートフォン+アプリ+IT&hl=ja&gl=JP&ceid=JP:ja',                                       cat: 'tech'    },
  // ビジネス
  { url: 'https://news.google.com/rss/search?q=経済+株価+日経+為替&hl=ja&gl=JP&ceid=JP:ja',                                            cat: 'business'},
  { url: 'https://news.google.com/rss/search?q=企業+決算+ビジネス&hl=ja&gl=JP&ceid=JP:ja',                                             cat: 'business'},
  // エンタメ
  { url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNREpxYW5RU0FtcGhLQUFQAQ?hl=ja&gl=JP&ceid=JP:ja',              cat: 'entertainment' },
  { url: 'https://news.google.com/rss/search?q=ゲーム+任天堂+PlayStation&hl=ja&gl=JP&ceid=JP:ja',                                      cat: 'entertainment' },
  { url: 'https://news.google.com/rss/search?q=アニメ+映画+ドラマ+音楽&hl=ja&gl=JP&ceid=JP:ja',                                       cat: 'entertainment' },
  // 政治
  { url: 'https://news.google.com/rss/search?q=政治+国会+衆議院+参議院&hl=ja&gl=JP&ceid=JP:ja',                                        cat: 'politics'},
  { url: 'https://news.google.com/rss/search?q=首相+内閣+自民党+政府&hl=ja&gl=JP&ceid=JP:ja',                                          cat: 'politics'},
  { url: 'https://news.google.com/rss/search?q=外交+安全保障+防衛&hl=ja&gl=JP&ceid=JP:ja',                                             cat: 'politics'},
];

// 個別RSS（descriptionあり）
const JP_RSS = [
  { url: 'https://gigazine.net/news/rss_2.0/',       cat: 'tech',          name: 'GIGAZINE'      },
  { url: 'https://www.famitsu.com/feed',              cat: 'entertainment', name: 'ファミ通'       },
  { url: 'https://dengekionline.com/rss/all.rss',     cat: 'entertainment', name: '電撃オンライン' },
  { url: 'https://www.oricon.co.jp/rss/news.rdf',     cat: 'entertainment', name: 'ORICON NEWS'   },
  { url: 'https://natalie.mu/music/feed/news',        cat: 'entertainment', name: 'ナタリー'       },
  { url: 'https://jp.ign.com/feed.xml',               cat: 'entertainment', name: 'IGN Japan'     },
];

async function fetchAll(sources, parser) {
  const BATCH = 4;
  const all = [];
  for (let i = 0; i < sources.length; i += BATCH) {
    const batch = sources.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async src => {
      const r = await httpGet(src.url);
      if (!r || r.status !== 200) {
        console.log(`  SKIP [${r?.status||'ERR'}] ${(src.name||'')} ${src.url.slice(30,70)}`);
        return [];
      }
      const items = parser(r.body, src.name || 'Google News', src.cat);
      console.log(`  OK   [${src.cat}] ${(src.name||src.url.slice(40,65))}: ${items.length}件`);
      return items;
    }));
    all.push(...results.flat());
    await new Promise(r => setTimeout(r, 200));
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
  console.log('SIGNAL fetch-news\n');

  console.log('=== Google News RSS ===');
  const gnItems = await fetchAll(GN_SOURCES, parseRSS);

  console.log('\n=== 個別RSS ===');
  const jpItems = await fetchAll(JP_RSS, parseRSSWithDesc);

  const all = [...gnItems, ...jpItems];
  const cats = ['society','tech','business','entertainment','politics'];
  const byCat = {};
  cats.forEach(c => { byCat[c] = dedup(all.filter(a=>a.category===c)); });
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
