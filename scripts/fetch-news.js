/**
 * SIGNAL fetch-news.js — 完全修正版
 * - Google News RSS日本語のみ
 * - descriptionのHTMLを完全除去
 * - 英語ソース（HackerNews・BBC等）を完全除外
 * - カテゴリ振り分けを確実に
 */
'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');
const { URL } = require('url');

const OUT = path.resolve(__dirname, '../data');

// ─── HTTP取得 ─────────────────────────────────────────
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

// ─── HTMLを完全除去 ───────────────────────────────────
function clean(html = '') {
  return String(html)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') // CDATA展開
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<a[^>]*>[\s\S]*?<\/a>/gi, '')        // aタグ（中身ごと）除去
    .replace(/<[^>]+>/g, ' ')                       // 残りタグ除去
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
    .replace(/&[a-z#0-9]+;/gi,' ')
    .replace(/\s+/g,' ').trim();
}

// 日本語が含まれるか判定
function isJapanese(text = '') {
  return /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/.test(text);
}

// ─── RSS パーサー ─────────────────────────────────────
function parseRSS(xml, defaultSource, category) {
  const items = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>|<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const chunk = m[1] || m[2];

    const txt = tag => {
      // CDATA対応
      const rCdata = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
      const rPlain = new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i');
      const hC = rCdata.exec(chunk);
      if (hC) return hC[1].trim();
      const hP = rPlain.exec(chunk);
      return hP ? hP[1].trim() : '';
    };
    const atr = (tag, a) => {
      const r = new RegExp(`<${tag}[^>]+${a}=["']([^"']+)["']`, 'i');
      const h = r.exec(chunk);
      return h ? h[1] : '';
    };

    const rawTitle = txt('title');
    const title = clean(rawTitle);
    const link = txt('link') || atr('link','href');

    if (!title || !link || title.length < 3) continue;
    // 日本語フィルタ：タイトルに日本語がない記事はスキップ
    if (!isJapanese(title)) continue;

    // Google Newsのsourceタグからメディア名を取得
    const srcMatch = chunk.match(/<source[^>]*>([^<]*)<\/source>/i);
    const source = srcMatch ? clean(srcMatch[1]) : defaultSource;

    // descriptionからHTMLを完全除去
    const rawDesc = txt('description') || txt('summary') || '';
    const desc = clean(rawDesc).slice(0, 120);

    const date = parseDate(txt('pubDate') || txt('published') || txt('updated'));

    items.push({ id: link, title, description: desc, url: link, image: '', date, source, category });
  }
  return items.slice(0, 30);
}

function parseDate(s) {
  if (!s) return new Date().toISOString();
  try { const d = new Date(s); return isNaN(d) ? new Date().toISOString() : d.toISOString(); }
  catch { return new Date().toISOString(); }
}

// ─── Google News RSSソース定義 ────────────────────────
// 全て日本語（hl=ja&gl=JP&ceid=JP:ja）
// jpOnlyフィルタをRSSパーサー側で実施
const SOURCES = [
  // ── 社会 ──────────────────────────────────────────
  { url: 'https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja',                                                                    cat: 'society' },
  { url: 'https://news.google.com/rss/topics/CAAqIQgKIhtDQkFTRGdvSUwyMHZNRE5mTTJRU0FtcGhLQUFQAQ?hl=ja&gl=JP&ceid=JP:ja',         cat: 'society' },
  { url: 'https://news.google.com/rss/search?q=NHKニュース+OR+テレ朝+OR+TBS+OR+フジテレビ+OR+日テレ&hl=ja&gl=JP&ceid=JP:ja',      cat: 'society' },
  { url: 'https://news.google.com/rss/search?q=事件+事故+社会+日本&hl=ja&gl=JP&ceid=JP:ja',                                       cat: 'society' },
  // ── テクノロジー・AI ───────────────────────────────
  { url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtcGhLQUFQAQ?hl=ja&gl=JP&ceid=JP:ja',         cat: 'tech'    },
  { url: 'https://news.google.com/rss/search?q=AI+人工知能+ChatGPT+テクノロジー&hl=ja&gl=JP&ceid=JP:ja',                          cat: 'tech'    },
  { url: 'https://news.google.com/rss/search?q=スマートフォン+アプリ+IT+ソフトウェア&hl=ja&gl=JP&ceid=JP:ja',                     cat: 'tech'    },
  // ── ビジネス・経済 ─────────────────────────────────
  { url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtcGhLQUFQAQ?hl=ja&gl=JP&ceid=JP:ja&topic=b', cat: 'business'},
  { url: 'https://news.google.com/rss/search?q=経済+株価+日経+為替&hl=ja&gl=JP&ceid=JP:ja',                                       cat: 'business'},
  { url: 'https://news.google.com/rss/search?q=企業+決算+ビジネス+産業&hl=ja&gl=JP&ceid=JP:ja',                                   cat: 'business'},
  // ── エンタメ・ゲーム ───────────────────────────────
  { url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNREpxYW5RU0FtcGhLQUFQAQ?hl=ja&gl=JP&ceid=JP:ja',         cat: 'entertainment' },
  { url: 'https://news.google.com/rss/search?q=ゲーム+任天堂+PlayStation+Switch&hl=ja&gl=JP&ceid=JP:ja',                          cat: 'entertainment' },
  { url: 'https://news.google.com/rss/search?q=アニメ+映画+ドラマ+音楽+芸能&hl=ja&gl=JP&ceid=JP:ja',                              cat: 'entertainment' },
  // ── 政治 ───────────────────────────────────────────
  { url: 'https://news.google.com/rss/search?q=政治+国会+衆議院+参議院&hl=ja&gl=JP&ceid=JP:ja',                                   cat: 'politics'},
  { url: 'https://news.google.com/rss/search?q=首相+内閣+自民党+政府+与党+野党&hl=ja&gl=JP&ceid=JP:ja',                           cat: 'politics'},
  { url: 'https://news.google.com/rss/search?q=外交+安全保障+防衛+条約&hl=ja&gl=JP&ceid=JP:ja',                                   cat: 'politics'},
];

// ─── 個別RSS（日本語メディアのみ）───────────────────
const JP_RSS = [
  { url: 'https://gigazine.net/news/rss_2.0/',        cat: 'tech',          name: 'GIGAZINE'      },
  { url: 'https://www.famitsu.com/feed',               cat: 'entertainment', name: 'ファミ通'       },
  { url: 'https://dengekionline.com/rss/all.rss',      cat: 'entertainment', name: '電撃オンライン' },
  { url: 'https://www.oricon.co.jp/rss/news.rdf',      cat: 'entertainment', name: 'ORICON NEWS'   },
  { url: 'https://natalie.mu/music/feed/news',         cat: 'entertainment', name: 'ナタリー'       },
  { url: 'https://jp.ign.com/feed.xml',                cat: 'entertainment', name: 'IGN Japan'     },
];

// ─── まとめて取得 ─────────────────────────────────────
async function fetchBatch(sources, useSourceField) {
  const BATCH = 4;
  const all = [];
  for (let i = 0; i < sources.length; i += BATCH) {
    const batch = sources.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async src => {
      const r = await httpGet(src.url);
      if (!r || r.status !== 200) {
        console.log(`  SKIP [${r?.status||'ERR'}] ${src.url.slice(40,80)}`);
        return [];
      }
      const sourceName = useSourceField ? undefined : src.name;
      const items = parseRSS(r.body, sourceName || 'Google News', src.cat);
      console.log(`  OK   [${src.cat}] ${src.url.slice(40,70)}: ${items.length}件`);
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
  console.log('SIGNAL fetch-news — 日本語統一版\n');

  console.log('=== Google News RSS ===');
  const gnItems = await fetchBatch(SOURCES, true);

  console.log('\n=== 個別RSS（日本語）===');
  const jpItems = await fetchBatch(JP_RSS, false);

  const all = [...gnItems, ...jpItems];

  const cats = ['society','tech','business','entertainment','politics'];
  const byCat = {};
  cats.forEach(c => { byCat[c] = dedup(all.filter(a => a.category === c)); });
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
