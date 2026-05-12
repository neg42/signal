/**
 * SIGNAL fetch-news.js — 決定版
 *
 * Google News RSSの問題:
 *   - descriptionは全てHTMLリンク（情報なし）→ 除去して空に
 *   - 代わりにtitleから「— メディア名」の部分を除去してcleanTitleを生成
 *   - Google Newsのtitleは「記事タイトル - メディア名」形式
 *
 * カテゴリ別に確実にデータが入るよう収集URLを整理。
 */
'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');
const { URL } = require('url');

const OUT = path.resolve(__dirname, '../data');

// ─── HTTP ─────────────────────────────────────────────
function httpGet(rawUrl) {
  return new Promise(resolve => {
    let p; try { p = new URL(rawUrl); } catch { return resolve(null); }
    const mod = p.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: p.hostname, path: p.pathname + p.search,
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
        return httpGet(loc.startsWith('http') ? loc : `${p.protocol}//${p.hostname}${loc}`).then(resolve);
      }
      const c = []; res.on('data', d => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString('utf8') }));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ─── テキスト化 ───────────────────────────────────────
function toText(raw = '') {
  return String(raw)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
    .replace(/&[a-z#0-9]+;/gi,' ')
    .replace(/\s+/g,' ').trim();
}

function isJP(s = '') {
  return /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/.test(s);
}

function parseDate(s) {
  if (!s) return new Date().toISOString();
  try { const d = new Date(s); return isNaN(d) ? new Date().toISOString() : d.toISOString(); }
  catch { return new Date().toISOString(); }
}

// titleから「- メディア名」末尾を除去してcleanTitleを生成
// Google News形式: "記事タイトル - メディア名"
function splitTitle(rawTitle) {
  const text = toText(rawTitle);
  // 末尾の「 - メディア名」を除去
  const m = text.match(/^([\s\S]+?)\s+-\s+([^-]+)$/);
  if (m) {
    return { title: m[1].trim(), sourceHint: m[2].trim() };
  }
  return { title: text, sourceHint: '' };
}

// ─── Google News RSS パーサー ─────────────────────────
function parseGoogleNewsRSS(xml, category) {
  const items = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const chunk = m[1];

    // title（CDATA対応）
    const tC = /<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i.exec(chunk);
    const tP = /<title[^>]*>([^<]*)<\/title>/i.exec(chunk);
    const rawTitle = (tC ? tC[1] : tP ? tP[1] : '').trim();

    const { title, sourceHint } = splitTitle(rawTitle);
    if (!title || title.length < 3 || !isJP(title)) continue;

    // link
    const lP = /<link[^>]*>([^<]*)<\/link>/i.exec(chunk);
    const lA = /<link[^>]+href=["']([^"']+)["']/i.exec(chunk);
    const link = (lP && lP[1].trim()) || (lA && lA[1]) || '';
    if (!link) continue;

    // source要素（Google Newsが提供するメディア名）
    const sEl = /<source[^>]*>([\s\S]*?)<\/source>/i.exec(chunk);
    const source = sEl ? toText(sEl[1]) : sourceHint || 'Google News';

    // pubDate
    const dEl = /<pubDate[^>]*>([^<]*)<\/pubDate>/i.exec(chunk);
    const date = parseDate(dEl ? dEl[1] : '');

    // descriptionは意図的に空（Google NewsはHTMLリンクのみ）
    items.push({ id: link, title, description: '', url: link, image: '', date, source, category });
  }
  return items.slice(0, 30);
}

// ─── 個別RSS パーサー（descriptionあり）──────────────
function parseJpRSS(xml, sourceName, category) {
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
    const link  = get('link') || atr('link','href');
    if (!title || !link || title.length < 3) continue;
    if (!isJP(title)) continue;

    // descriptionのaタグを中身ごと除去してからテキスト化
    const rawDesc = get('description') || get('summary') || '';
    const desc = toText(rawDesc.replace(/<a[\s\S]*?<\/a>/gi,'')).slice(0, 120);

    items.push({
      id: link, title, description: desc, url: link, image: '',
      date: parseDate(get('pubDate') || get('published')),
      source: sourceName, category,
    });
  }
  return items.slice(0, 25);
}

// ─── ソース定義 ───────────────────────────────────────
const GN = [
  // 社会（複数ソースで確実に取得）
  { url: 'https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja',                                                              cat: 'society' },
  { url: 'https://news.google.com/rss/topics/CAAqIQgKIhtDQkFTRGdvSUwyMHZNRE5mTTJRU0FtcGhLQUFQAQ?hl=ja&gl=JP&ceid=JP:ja',  cat: 'society' },
  { url: 'https://news.google.com/rss/search?q=NHK+テレ朝+TBS+フジテレビ+日テレ&hl=ja&gl=JP&ceid=JP:ja',                   cat: 'society' },
  { url: 'https://news.google.com/rss/search?q=日本+ニュース+速報&hl=ja&gl=JP&ceid=JP:ja',                                  cat: 'society' },

  // テクノロジー
  { url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtcGhLQUFQAQ?hl=ja&gl=JP&ceid=JP:ja',  cat: 'tech'    },
  { url: 'https://news.google.com/rss/search?q=AI+人工知能+ChatGPT&hl=ja&gl=JP&ceid=JP:ja',                                cat: 'tech'    },
  { url: 'https://news.google.com/rss/search?q=スマートフォン+IT+テクノロジー&hl=ja&gl=JP&ceid=JP:ja',                     cat: 'tech'    },

  // ビジネス
  { url: 'https://news.google.com/rss/search?q=株価+経済+日経平均&hl=ja&gl=JP&ceid=JP:ja',                                  cat: 'business'},
  { url: 'https://news.google.com/rss/search?q=企業+決算+ビジネス+経営&hl=ja&gl=JP&ceid=JP:ja',                             cat: 'business'},
  { url: 'https://news.google.com/rss/search?q=為替+円安+インフレ+金利&hl=ja&gl=JP&ceid=JP:ja',                             cat: 'business'},

  // エンタメ
  { url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNREpxYW5RU0FtcGhLQUFQAQ?hl=ja&gl=JP&ceid=JP:ja',  cat: 'entertainment' },
  { url: 'https://news.google.com/rss/search?q=ゲーム+任天堂+PlayStation+Switch&hl=ja&gl=JP&ceid=JP:ja',                   cat: 'entertainment' },
  { url: 'https://news.google.com/rss/search?q=アニメ+映画+ドラマ+芸能&hl=ja&gl=JP&ceid=JP:ja',                            cat: 'entertainment' },

  // 政治（確実に取得できるURLを優先）
  { url: 'https://news.google.com/rss/search?q=国会+衆議院+参議院+政治&hl=ja&gl=JP&ceid=JP:ja',                             cat: 'politics'},
  { url: 'https://news.google.com/rss/search?q=首相+内閣+自民党+立憲民主党&hl=ja&gl=JP&ceid=JP:ja',                         cat: 'politics'},
  { url: 'https://news.google.com/rss/search?q=外交+防衛+安全保障+日米&hl=ja&gl=JP&ceid=JP:ja',                             cat: 'politics'},
  { url: 'https://news.google.com/rss/search?q=選挙+政党+政策+法案&hl=ja&gl=JP&ceid=JP:ja',                                cat: 'politics'},
];

const JP_RSS = [
  { url: 'https://gigazine.net/news/rss_2.0/',      cat: 'tech',          name: 'GIGAZINE'      },
  { url: 'https://www.famitsu.com/feed',             cat: 'entertainment', name: 'ファミ通'       },
  { url: 'https://dengekionline.com/rss/all.rss',    cat: 'entertainment', name: '電撃オンライン' },
  { url: 'https://www.oricon.co.jp/rss/news.rdf',    cat: 'entertainment', name: 'ORICON NEWS'   },
  { url: 'https://natalie.mu/music/feed/news',       cat: 'entertainment', name: 'ナタリー'       },
  { url: 'https://jp.ign.com/feed.xml',              cat: 'entertainment', name: 'IGN Japan'     },
];

async function fetchBatch(sources, parser) {
  const BATCH = 4;
  const all = [];
  for (let i = 0; i < sources.length; i += BATCH) {
    const batch = sources.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async src => {
      const r = await httpGet(src.url);
      if (!r || r.status !== 200) {
        console.log(`  SKIP [${r?.status||'ERR'}] ${src.url.slice(40,75)}`);
        return [];
      }
      const items = parser(r.body, src.name || 'Google News', src.cat);
      console.log(`  OK [${src.cat}] ${(src.name||src.url.slice(47,72))}: ${items.length}件`);
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
  }).sort((a,b) => new Date(b.date)-new Date(a.date)).slice(0,limit);
}

async function main() {
  console.log('SIGNAL fetch-news\n');

  console.log('=== Google News ===');
  const gnItems = await fetchBatch(GN, parseGoogleNewsRSS);

  console.log('\n=== 個別RSS ===');
  const jpItems = await fetchBatch(JP_RSS, parseJpRSS);

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
