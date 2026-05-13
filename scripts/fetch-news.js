/**
 * SIGNAL fetch-news.js
 *
 * 主な機能:
 *  - Google News RSSをカテゴリ別に収集（カテゴリは「日本」「テクノロジー」など公式トピックIDを使用）
 *  - 元記事をfetchして本文冒頭を抽出（OGPまたはmetaから）
 *  - 個別日本語RSSも収集
 */
'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');
const { URL } = require('url');

const OUT = path.resolve(__dirname, '../data');
const FETCH_DESC = true;     // 本文取得を行うか
const DESC_CONCURRENCY = 6;  // 本文取得の並列数

// ─── HTTP ─────────────────────────────────────────────
function httpGet(rawUrl, timeout = 12000) {
  return new Promise(resolve => {
    let p; try { p = new URL(rawUrl); } catch { return resolve(null); }
    const mod = p.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: p.hostname, path: p.pathname + p.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/rss+xml,application/xml,*/*',
        'Accept-Language': 'ja,en;q=0.5',
        'Accept-Encoding': 'identity',
      },
      timeout,
    }, res => {
      if ([301,302,307,308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const loc = res.headers.location;
        return httpGet(loc.startsWith('http') ? loc : `${p.protocol}//${p.hostname}${loc}`, timeout).then(resolve);
      }
      const c = []; res.on('data', d => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString('utf8') }));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

function toText(raw = '') {
  return String(raw)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
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

// titleから「- メディア名」を分離
function splitTitle(rawTitle) {
  const text = toText(rawTitle);
  // 末尾の「 - メディア名」を除去（ハイフンは半角・全角両対応）
  const m = text.match(/^([\s\S]+?)\s+[-−–—]\s+([^-−–—]+)$/);
  if (m) return { title: m[1].trim(), sourceHint: m[2].trim() };
  return { title: text, sourceHint: '' };
}

// 元記事URLから本文冒頭を取得
async function fetchArticleDesc(url) {
  if (!FETCH_DESC) return '';
  try {
    const r = await httpGet(url, 8000);
    if (!r || r.status !== 200) return '';
    const html = r.body;

    // og:description > description > 本文先頭の順で取得
    const ogD = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
             || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
    if (ogD) {
      const t = toText(ogD[1]);
      if (t.length > 15) return t.slice(0, 140);
    }
    const metaD = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
               || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
    if (metaD) {
      const t = toText(metaD[1]);
      if (t.length > 15) return t.slice(0, 140);
    }
    // 最初のpタグの中身
    const p = html.match(/<p[^>]*>([\s\S]{30,400}?)<\/p>/i);
    if (p) {
      const t = toText(p[1]);
      if (t.length > 20) return t.slice(0, 140);
    }
  } catch {}
  return '';
}

// ─── Google News RSS パーサー ─────────────────────────
function parseGN(xml, category) {
  const items = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const chunk = m[1];

    const tC = /<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i.exec(chunk);
    const tP = /<title[^>]*>([^<]*)<\/title>/i.exec(chunk);
    const rawTitle = (tC ? tC[1] : tP ? tP[1] : '').trim();
    const { title, sourceHint } = splitTitle(rawTitle);
    if (!title || title.length < 3 || !isJP(title)) continue;

    const lP = /<link[^>]*>([^<]*)<\/link>/i.exec(chunk);
    const link = lP && lP[1].trim() ? lP[1].trim() : '';
    if (!link) continue;

    const sEl = /<source[^>]*>([\s\S]*?)<\/source>/i.exec(chunk);
    const source = sEl ? toText(sEl[1]) : sourceHint || 'Google News';

    const dEl = /<pubDate[^>]*>([^<]*)<\/pubDate>/i.exec(chunk);
    const date = parseDate(dEl ? dEl[1] : '');

    items.push({ id: link, title, description: '', url: link, image: '', date, source, category });
  }
  return items.slice(0, 30);
}

function parseJp(xml, sourceName, category) {
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
    if (!title || !link || title.length < 3 || !isJP(title)) continue;

    const rawDesc = get('description') || get('summary') || '';
    const desc = toText(rawDesc.replace(/<a[\s\S]*?<\/a>/gi,'')).slice(0, 140);

    items.push({ id: link, title, description: desc, url: link, image: '',
      date: parseDate(get('pubDate') || get('published')), source: sourceName, category });
  }
  return items.slice(0, 25);
}

// ─── ソース定義（公式トピックIDを優先） ──────────────
// Google Newsトピックは安定的に大量取得できる。検索URLは補助に使う。
const GN = [
  // ── 社会・トップ ────────────────────────────────
  // トップニュース（最も安定）
  { url: 'https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja', cat: 'society' },
  // 日本トピック
  { url: 'https://news.google.com/rss/topics/CAAqIQgKIhtDQkFTRGdvSUwyMHZNRE5mTTJRU0FtcGhLQUFQAQ?hl=ja&gl=JP&ceid=JP:ja', cat: 'society' },

  // ── テクノロジー ────────────────────────────────
  // テクノロジートピック
  { url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtcGhLQUFQAQ?hl=ja&gl=JP&ceid=JP:ja', cat: 'tech' },
  // AI検索
  { url: 'https://news.google.com/rss/search?q=AI&hl=ja&gl=JP&ceid=JP:ja', cat: 'tech' },

  // ── ビジネス・経済 ─────────────────────────────
  // ビジネストピック（公式）
  { url: 'https://news.google.com/rss/topics/CAAqKAgKIiJDQkFTRXdvSkwyMHZNRGRtY3pkbkVnSnFZUm9DU2xBb0FBUAE?hl=ja&gl=JP&ceid=JP:ja', cat: 'business' },
  // 株価検索
  { url: 'https://news.google.com/rss/search?q=株価&hl=ja&gl=JP&ceid=JP:ja', cat: 'business' },
  // 経済検索
  { url: 'https://news.google.com/rss/search?q=経済&hl=ja&gl=JP&ceid=JP:ja', cat: 'business' },

  // ── エンタメ ────────────────────────────────────
  // エンタメトピック
  { url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNREpxYW5RU0FtcGhLQUFQAQ?hl=ja&gl=JP&ceid=JP:ja', cat: 'entertainment' },
  // ゲーム検索
  { url: 'https://news.google.com/rss/search?q=ゲーム&hl=ja&gl=JP&ceid=JP:ja', cat: 'entertainment' },
  // アニメ検索
  { url: 'https://news.google.com/rss/search?q=アニメ&hl=ja&gl=JP&ceid=JP:ja', cat: 'entertainment' },

  // ── 政治 ────────────────────────────────────────
  // ※ 政治の公式トピックはGoogleが日本では提供していないため検索に頼る
  { url: 'https://news.google.com/rss/search?q=政治&hl=ja&gl=JP&ceid=JP:ja', cat: 'politics' },
  { url: 'https://news.google.com/rss/search?q=国会&hl=ja&gl=JP&ceid=JP:ja', cat: 'politics' },
  { url: 'https://news.google.com/rss/search?q=首相&hl=ja&gl=JP&ceid=JP:ja', cat: 'politics' },
  { url: 'https://news.google.com/rss/search?q=内閣&hl=ja&gl=JP&ceid=JP:ja', cat: 'politics' },

  // ── 社会（追加） ───────────────────────────────
  { url: 'https://news.google.com/rss/search?q=事件&hl=ja&gl=JP&ceid=JP:ja', cat: 'society' },
  { url: 'https://news.google.com/rss/search?q=ニュース&hl=ja&gl=JP&ceid=JP:ja', cat: 'society' },
];

const JP_RSS = [
  { url: 'https://gigazine.net/news/rss_2.0/',     cat: 'tech',          name: 'GIGAZINE'      },
  { url: 'https://www.famitsu.com/feed',            cat: 'entertainment', name: 'ファミ通'       },
  { url: 'https://dengekionline.com/rss/all.rss',   cat: 'entertainment', name: '電撃オンライン' },
  { url: 'https://www.oricon.co.jp/rss/news.rdf',   cat: 'entertainment', name: 'ORICON NEWS'   },
  { url: 'https://natalie.mu/music/feed/news',      cat: 'entertainment', name: 'ナタリー'       },
  { url: 'https://jp.ign.com/feed.xml',             cat: 'entertainment', name: 'IGN Japan'     },
];

async function fetchBatch(sources, parser) {
  const BATCH = 4;
  const all = [];
  for (let i = 0; i < sources.length; i += BATCH) {
    const batch = sources.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async src => {
      const r = await httpGet(src.url, 12000);
      if (!r || r.status !== 200) {
        console.log(`  SKIP [${r?.status||'ERR'}] ${src.url.slice(40,80)}`);
        return [];
      }
      const items = parser(r.body, src.name || 'Google News', src.cat);
      console.log(`  OK [${src.cat}] ${(src.name||src.url.slice(40,80))}: ${items.length}件`);
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

// 本文取得を並列で実施
async function enrichDescriptions(articles) {
  // descriptionが空の記事だけ対象
  const targets = articles.filter(a => !a.description);
  console.log(`\n本文取得: ${targets.length}件`);

  let done = 0;
  for (let i = 0; i < targets.length; i += DESC_CONCURRENCY) {
    const batch = targets.slice(i, i + DESC_CONCURRENCY);
    await Promise.all(batch.map(async a => {
      const desc = await fetchArticleDesc(a.url);
      if (desc) a.description = desc;
      done++;
    }));
    if (done % 20 === 0 || done === targets.length) {
      console.log(`  ${done}/${targets.length}件処理`);
    }
  }
  return articles;
}

async function main() {
  console.log('SIGNAL fetch-news\n');

  console.log('=== Google News ===');
  const gnItems = await fetchBatch(GN, parseGN);

  console.log('\n=== 個別RSS ===');
  const jpItems = await fetchBatch(JP_RSS, parseJp);

  let all = [...gnItems, ...jpItems];

  // 重複除去（タイトルベース）
  const seen = new Set();
  all = all.filter(a => {
    const k = a.title.replace(/\s+/g,'').slice(0,40);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  // 本文取得（Google News由来の記事のみ対象）
  await enrichDescriptions(all);

  // 媒体一覧を作成
  const sources = {};
  all.forEach(a => { sources[a.source] = (sources[a.source]||0) + 1; });
  const sortedSources = Object.entries(sources).sort((a,b)=>b[1]-a[1]);

  const cats = ['society','tech','business','entertainment','politics'];
  const byCat = {};
  cats.forEach(c => { byCat[c] = dedup(all.filter(a=>a.category===c)); });
  byCat.custom = [];
  byCat.all = dedup(all, 120);

  // 救済: カテゴリが空の場合、トップニュースから関連キーワードで埋める
  const fallbackKeywords = {
    politics: /政治|国会|首相|内閣|選挙|政府|外交|防衛|与党|野党|参議院|衆議院|議員|大臣/,
    business: /経済|株価|日経|為替|円安|円高|決算|企業|ビジネス|景気|GDP|金利|インフレ/,
    society:  /事件|事故|社会|裁判|警察|地震|台風|気象|大雨|火災/,
  };
  for (const [cat, kw] of Object.entries(fallbackKeywords)) {
    if (byCat[cat].length < 5) {
      const supplement = byCat.all.filter(a => kw.test(a.title) && a.category !== cat).slice(0, 30);
      console.log(`  救済[${cat}]: ${supplement.length}件追加 (元${byCat[cat].length}件)`);
      const merged = [...byCat[cat], ...supplement.map(a => ({...a, category: cat}))];
      byCat[cat] = dedup(merged);
    }
  }

  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT,'news.json'), JSON.stringify(byCat, null, 2));
  fs.writeFileSync(path.join(OUT,'meta.json'), JSON.stringify({
    updatedAt: new Date().toISOString(),
    counts: Object.fromEntries(Object.entries(byCat).map(([k,v])=>[k,v.length])),
    sources: sortedSources,
  }, null, 2));

  console.log('\n=== カテゴリ別 ===');
  Object.entries(byCat).forEach(([k,v]) => console.log(`  ${k}: ${v.length}件`));
  console.log('\n=== 媒体一覧（上位20）===');
  sortedSources.slice(0,20).forEach(([n,c]) => console.log(`  ${c.toString().padStart(3)} ${n}`));
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
