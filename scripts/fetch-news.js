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

// 除外する定型文・無効な値のパターン
const BAD_DESC_PATTERNS = [
  /Google ?ニュース/,
  /世界中のニュース提供元/,
  /集約した広範囲/,
  /comprehensive up-to-date/i,
  /Get the latest news/i,
  /news\.google\.com/,
  /^https?:\/\//,
  /^[\s\S]{0,10}$/,    // 短すぎる
];

function isValidDesc(text) {
  if (!text || text.length < 20) return false;
  return !BAD_DESC_PATTERNS.some(p => p.test(text));
}

// 元記事URLから本文冒頭を取得
async function fetchArticleDesc(url) {
  if (!FETCH_DESC) return '';

  // Google NewsのリダイレクトURLの場合は実際の記事URLを解決
  let targetUrl = url;
  if (url.includes('news.google.com/rss/articles/')) {
    try {
      // Google Newsのリダイレクトを追跡
      const r = await httpGet(url, 8000);
      if (!r) return '';
      // リダイレクト後のURLがレスポンスのcanonical等から取れることがある
      const canonical = r.body.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
      if (canonical && !canonical[1].includes('news.google.com')) {
        targetUrl = canonical[1];
        // 実際の記事を再取得
        const r2 = await httpGet(targetUrl, 8000);
        if (r2 && r2.status === 200) return extractDesc(r2.body);
      }
      // canonicalが取れなくてもbodyから抽出を試みる
      return extractDesc(r.body);
    } catch { return ''; }
  }

  try {
    const r = await httpGet(targetUrl, 8000);
    if (!r || r.status !== 200) return '';
    return extractDesc(r.body);
  } catch {}
  return '';
}

function extractDesc(html) {
  // 1. og:description（最優先）
  const ogD = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
           || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
  if (ogD) {
    const t = toText(ogD[1]);
    if (isValidDesc(t)) return t.slice(0, 140);
  }

  // 2. meta description
  const metaD = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
             || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  if (metaD) {
    const t = toText(metaD[1]);
    if (isValidDesc(t)) return t.slice(0, 140);
  }

  // 3. twitter:description
  const twD = html.match(/<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i);
  if (twD) {
    const t = toText(twD[1]);
    if (isValidDesc(t)) return t.slice(0, 140);
  }

  // 4. <article>タグ内の最初のp
  const article = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (article) {
    const p = article[1].match(/<p[^>]*>([\s\S]{30,500}?)<\/p>/i);
    if (p) {
      const t = toText(p[1]);
      if (isValidDesc(t)) return t.slice(0, 140);
    }
  }

  // 5. 最初のpタグ
  const p = html.match(/<p[^>]*>([\s\S]{30,500}?)<\/p>/i);
  if (p) {
    const t = toText(p[1]);
    if (isValidDesc(t)) return t.slice(0, 140);
  }
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

    let rawDesc = get('description') || get('summary') || '';
    // imgタグ、aタグを中身ごと除去（残骸が残らないように）
    rawDesc = rawDesc.replace(/<img[^>]*>/gi, '');
    rawDesc = rawDesc.replace(/<a[\s\S]*?<\/a>/gi, '');
    rawDesc = rawDesc.replace(/<[^>]+>/g, ' ');
    const desc = toText(rawDesc).slice(0, 140);
    // 短すぎる/HTMLっぽいdescriptionは破棄
    const finalDesc = (desc.length >= 20 && !desc.includes('<') && !desc.includes('src=')) ? desc : '';

    items.push({ id: link, title, description: finalDesc, url: link, image: '',
      date: parseDate(get('pubDate') || get('published')), source: sourceName, category });
  }
  return items.slice(0, 10);
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
  { url: 'https://news.google.com/rss/search?q=テクノロジー&hl=ja&gl=JP&ceid=JP:ja', cat: 'tech' },
  // AI検索
  { url: 'https://news.google.com/rss/search?q=AI&hl=ja&gl=JP&ceid=JP:ja', cat: 'tech' },

  // ── ビジネス・経済 ─────────────────────────────
  // ビジネストピック（公式）
  { url: 'https://news.google.com/rss/search?q=ビジネス&hl=ja&gl=JP&ceid=JP:ja', cat: 'business' },
  // 株価検索
  { url: 'https://news.google.com/rss/search?q=株価&hl=ja&gl=JP&ceid=JP:ja', cat: 'business' },
  // 経済検索
  { url: 'https://news.google.com/rss/search?q=経済&hl=ja&gl=JP&ceid=JP:ja', cat: 'business' },

  // ── エンタメ ────────────────────────────────────
  // エンタメトピック
  { url: 'https://news.google.com/rss/search?q=エンタメ&hl=ja&gl=JP&ceid=JP:ja', cat: 'entertainment' },
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
  { url: 'https://gigazine.net/news/rss_2.0/',     cat: 'tech',          name: 'GIGAZINE'   },
  { url: 'https://jp.ign.com/feed.xml',             cat: 'entertainment', name: 'IGN Japan'  },
  { url: 'https://natalie.mu/music/feed/news',      cat: 'entertainment', name: 'ナタリー'    },
  { url: 'https://natalie.mu/comic/feed/news',      cat: 'entertainment', name: 'コミックナタリー' },
  { url: 'https://www.itmedia.co.jp/rss/2.0/news_bursts.xml', cat: 'tech', name: 'ITmedia' },
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
  const unique = arts.filter(a => {
    if (!a?.title || a.title.length < 4) return false;
    const k = a.title.replace(/\s+/g,'').slice(0,40);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).sort((a,b) => new Date(b.date)-new Date(a.date));

  return interleaveSources(unique, limit);
}

// 同じソースが連続しないように記事を並び替える
// 各ソースの記事を時系列順に保ちつつ、ラウンドロビン方式で取り出す
function interleaveSources(articles, limit) {
  // ソース別にグループ化（時系列順）
  const bySource = {};
  for (const a of articles) {
    if (!bySource[a.source]) bySource[a.source] = [];
    bySource[a.source].push(a);
  }
  const sources = Object.keys(bySource);
  if (sources.length <= 1) return articles.slice(0, limit);

  // 各ソース最新順にポインタ
  const pointers = {};
  sources.forEach(s => pointers[s] = 0);

  const result = [];
  // 各ソースを順番に1記事ずつ取り出す（ラウンドロビン）
  while (result.length < limit) {
    let added = false;
    // 各ソースから順番に1記事
    for (const s of sources) {
      if (pointers[s] < bySource[s].length) {
        result.push(bySource[s][pointers[s]]);
        pointers[s]++;
        added = true;
        if (result.length >= limit) break;
      }
    }
    if (!added) break; // 全ソースから取り尽くした
  }
  // 結果を日付順に並び替え直す（連続させないように軽くシャッフル）
  // 厳密な日付順ではなく、ソース多様性を保ちつつ概ね新しい順
  return shuffleNearby(result);
}

// 近接する3記事内で同一ソースが連続しないように調整
function shuffleNearby(arts) {
  const result = [...arts];
  for (let i = 1; i < result.length - 1; i++) {
    if (result[i].source === result[i-1].source) {
      // 後ろの記事と入れ替えを試みる
      for (let j = i+1; j < Math.min(i+4, result.length); j++) {
        if (result[j].source !== result[i-1].source &&
            (i+1 >= result.length || result[j].source !== result[i+1]?.source)) {
          [result[i], result[j]] = [result[j], result[i]];
          break;
        }
      }
    }
  }
  return result;
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

  // ソース別の上限を設定（1ソース最大15件まで・カテゴリごと）
  // テクノロジーやエンタメで特定ソースが偏らないようにする
  const PER_SOURCE_LIMIT = 12;
  const sourceCounters = {};
  all = all.filter(a => {
    const key = `${a.category}:${a.source}`;
    sourceCounters[key] = (sourceCounters[key] || 0) + 1;
    return sourceCounters[key] <= PER_SOURCE_LIMIT;
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
