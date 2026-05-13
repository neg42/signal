/**
 * SIGNAL fetch-news.js — カテゴリURL版
 *
 * キーワード検索を廃止。Google NewsのカテゴリRSSを直接使用。
 * これにより「政治のニュース全般」「社会のニュース全般」を
 * キーワードに依存せず安定して取得できる。
 *
 * Google News カテゴリRSS (ned=jp形式):
 *   国内: /news/rss/headlines/section/topic/NATION.ja_jp/国内
 *   政治: /news/rss/headlines/section/topic/POLITICS.ja_jp/政治
 *   ビジネス: /news/rss/headlines/section/topic/BUSINESS.ja_jp/ビジネス
 *   エンタメ: /news/rss/headlines/section/topic/ENTERTAINMENT.ja_jp/エンタメ
 *   テクノロジー: /news/rss/headlines/section/topic/SCITECH.ja_jp/テクノロジー
 *   スポーツ: /news/rss/headlines/section/topic/SPORTS.ja_jp/スポーツ
 */
'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');
const { URL } = require('url');

const OUT            = path.resolve(__dirname, '../data');
const FETCH_DESC     = true;
const DESC_CONCURRENCY = 6;
const PER_SOURCE_CAT_LIMIT = 12; // 1カテゴリあたり同一ソース最大件数

// ─── HTTP ─────────────────────────────────────────────
function httpGet(rawUrl, timeout = 12000) {
  return new Promise(resolve => {
    let p; try { p = new URL(rawUrl); } catch { return resolve(null); }
    const mod = p.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: p.hostname,
      path: p.pathname + p.search,
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
      const c = [];
      res.on('data', d => c.push(d));
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

function splitTitle(raw) {
  const text = toText(raw);
  const m = text.match(/^([\s\S]+?)\s+[-−–—]\s+([^-−–—]{2,30})$/);
  if (m) return { title: m[1].trim(), sourceHint: m[2].trim() };
  return { title: text, sourceHint: '' };
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
    const link = (lP && lP[1].trim()) || '';
    if (!link) continue;

    const sEl = /<source[^>]*>([\s\S]*?)<\/source>/i.exec(chunk);
    const source = sEl ? toText(sEl[1]) : sourceHint || 'Google News';
    const dEl = /<pubDate[^>]*>([^<]*)<\/pubDate>/i.exec(chunk);
    const date = parseDate(dEl ? dEl[1] : '');

    items.push({ id: link, title, description: '', url: link, image: '', date, source, category });
  }
  return items.slice(0, 50); // 1URLあたり最大50件
}

// ─── 個別RSS パーサー（descriptionあり） ─────────────
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
    if (!title || !link || title.length < 3 || !isJP(title)) continue;

    let rawDesc = get('description') || get('summary') || '';
    rawDesc = rawDesc.replace(/<img[^>]*>/gi, '').replace(/<a[\s\S]*?<\/a>/gi, '');
    const desc = toText(rawDesc).slice(0, 140);
    const finalDesc = (desc.length >= 20 && !desc.includes('<') && !desc.includes('src=')) ? desc : '';

    items.push({ id: link, title, description: finalDesc, url: link, image: '',
      date: parseDate(get('pubDate') || get('published')), source: sourceName, category });
  }
  return items.slice(0, 15);
}

// ─── ソース定義（カテゴリURL方式）───────────────────
// Google News カテゴリRSS (ned=jp 形式) — キーワード不要
const GN_BASE = 'https://news.google.com/news/rss/headlines/section/topic';
const GN_PARAMS = '?ned=jp&hl=ja&gl=JP';

const GN_SOURCES = [
  // ── 社会（国内ニュース全般）─────────────────────
  { url: `${GN_BASE}/NATION.ja_jp/国内${GN_PARAMS}`,        cat: 'society' },
  // トップニュースも社会に含める（緊急性の高いニュースが多い）
  { url: 'https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja', cat: 'society' },

  // ── 政治 ────────────────────────────────────────
  { url: `${GN_BASE}/POLITICS.ja_jp/政治${GN_PARAMS}`,      cat: 'politics' },
  // 国際ニュースも政治に含める
  { url: `${GN_BASE}/WORLD.ja_jp/国際${GN_PARAMS}`,         cat: 'politics' },

  // ── ビジネス・経済 ────────────────────────────
  { url: `${GN_BASE}/BUSINESS.ja_jp/ビジネス${GN_PARAMS}`,  cat: 'business' },

  // ── エンタメ・ゲーム ──────────────────────────
  { url: `${GN_BASE}/ENTERTAINMENT.ja_jp/エンタメ${GN_PARAMS}`, cat: 'entertainment' },
  { url: `${GN_BASE}/SPORTS.ja_jp/スポーツ${GN_PARAMS}`,    cat: 'entertainment' },

  // ── テクノロジー ──────────────────────────────
  { url: `${GN_BASE}/SCITECH.ja_jp/テクノロジー${GN_PARAMS}`, cat: 'tech' },
];

// 個別RSS（日本語メディア）
const JP_RSS = [
  { url: 'https://gigazine.net/news/rss_2.0/',                         cat: 'tech',          name: 'GIGAZINE'        },
  { url: 'https://www.itmedia.co.jp/rss/2.0/news/subtop/aiplus.xml',   cat: 'tech',          name: 'ITmedia AI+'     },
  { url: 'https://jp.ign.com/feed.xml',                                 cat: 'entertainment', name: 'IGN Japan'       },
  { url: 'https://natalie.mu/music/feed/news',                          cat: 'entertainment', name: 'ナタリー音楽'    },
  { url: 'https://natalie.mu/eiga/feed/news',                           cat: 'entertainment', name: 'ナタリー映画'    },
  { url: 'https://natalie.mu/comic/feed/news',                          cat: 'entertainment', name: 'コミックナタリー' },
  { url: 'https://natalie.mu/game/feed/news',                           cat: 'entertainment', name: 'ナタリーゲーム'  },
  { url: 'https://www.cinematoday.jp/rss',                              cat: 'entertainment', name: 'シネマトゥデイ'  },
];

async function fetchBatch(sources, parser) {
  const BATCH = 4;
  const all = [];
  for (let i = 0; i < sources.length; i += BATCH) {
    const batch = sources.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async src => {
      const r = await httpGet(src.url, 14000);
      if (!r || r.status !== 200) {
        console.log(`  SKIP [${r?.status||'ERR'}] ${(src.name||src.url.slice(40,80))}`);
        return [];
      }
      const items = parser(r.body, src.name || 'Google News', src.cat);
      console.log(`  OK [${src.cat}] ${(src.name||src.url.slice(40,75))}: ${items.length}件`);
      return items;
    }));
    all.push(...results.flat());
    await new Promise(r => setTimeout(r, 200));
  }
  return all;
}

// ─── 本文取得 ─────────────────────────────────────────
const BAD_DESC_PATTERNS = [
  /Google ?ニュース/, /世界中のニュース提供元/, /集約した広範囲/,
  /news\.google\.com/, /^https?:\/\//, /comprehensive up-to-date/i,
];
function isValidDesc(text) {
  if (!text || text.length < 20) return false;
  return !BAD_DESC_PATTERNS.some(p => p.test(text));
}

function extractDesc(html) {
  const patterns = [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{20,}?)["']/i,
    /<meta[^>]+content=["']([^"']{20,}?)["'][^>]+property=["']og:description["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{20,}?)["']/i,
    /<meta[^>]+content=["']([^"']{20,}?)["'][^>]+name=["']description["']/i,
    /<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']{20,}?)["']/i,
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m) { const t = toText(m[1]); if (isValidDesc(t)) return t.slice(0, 140); }
  }
  const articleP = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const src = articleP ? articleP[1] : html;
  const p = src.match(/<p[^>]*>([\s\S]{30,500}?)<\/p>/i);
  if (p) { const t = toText(p[1]); if (isValidDesc(t)) return t.slice(0, 140); }
  return '';
}

async function fetchArticleDesc(url) {
  if (!FETCH_DESC) return '';
  try {
    const r = await httpGet(url, 8000);
    if (!r || r.status !== 200) return '';
    return extractDesc(r.body);
  } catch { return ''; }
}

async function enrichDescriptions(articles) {
  const directTargets = articles.filter(a => !a.description && !a.url.includes('news.google.com'));
  const gnTargets     = articles.filter(a => !a.description &&  a.url.includes('news.google.com'));
  const targets = [...directTargets, ...gnTargets.slice(0, 60)];
  console.log(`\n本文取得: ${targets.length}件 (直リンク${directTargets.length} + GN${Math.min(gnTargets.length,60)})`);
  let done = 0;
  for (let i = 0; i < targets.length; i += DESC_CONCURRENCY) {
    const batch = targets.slice(i, i + DESC_CONCURRENCY);
    await Promise.all(batch.map(async a => {
      a.description = await fetchArticleDesc(a.url);
      done++;
    }));
    if (done % 30 === 0 || done === targets.length) console.log(`  ${done}/${targets.length}件`);
    if (i + DESC_CONCURRENCY < targets.length) await new Promise(r => setTimeout(r, 120));
  }
}

// ─── 多様性確保：ラウンドロビン ──────────────────────
function interleaveSources(articles, limit) {
  const bySource = {};
  for (const a of articles) {
    (bySource[a.source] = bySource[a.source] || []).push(a);
  }
  const sources = Object.keys(bySource);
  if (sources.length <= 1) return articles.slice(0, limit);
  const ptrs = {};
  sources.forEach(s => ptrs[s] = 0);
  const result = [];
  while (result.length < limit) {
    let added = false;
    for (const s of sources) {
      if (ptrs[s] < bySource[s].length) {
        result.push(bySource[s][ptrs[s]++]);
        added = true;
        if (result.length >= limit) break;
      }
    }
    if (!added) break;
  }
  return result;
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

// ─── メイン ───────────────────────────────────────────
async function main() {
  console.log('SIGNAL fetch-news — カテゴリURL版\n');

  console.log('=== Google News（カテゴリRSS）===');
  const gnItems = await fetchBatch(GN_SOURCES, parseGN);

  console.log('\n=== 個別RSS ===');
  const jpItems = await fetchBatch(JP_RSS, parseJpRSS);

  let all = [...gnItems, ...jpItems];

  // 重複除去
  const seen = new Set();
  all = all.filter(a => {
    const k = a.title.replace(/\s+/g,'').slice(0,40);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  // 1カテゴリあたり同一ソースの上限
  const srcCatCount = {};
  all = all.filter(a => {
    const key = `${a.category}:${a.source}`;
    srcCatCount[key] = (srcCatCount[key]||0) + 1;
    return srcCatCount[key] <= PER_SOURCE_CAT_LIMIT;
  });

  // 本文取得
  await enrichDescriptions(all);

  // カテゴリ別振り分け
  const cats = ['society','tech','business','entertainment','politics'];
  const byCat = {};
  cats.forEach(c => { byCat[c] = dedup(all.filter(a=>a.category===c)); });
  byCat.custom = [];
  byCat.all = dedup(all, 120);

  // 媒体一覧
  const srcCount = {};
  all.forEach(a => { srcCount[a.source] = (srcCount[a.source]||0)+1; });
  const sortedSources = Object.entries(srcCount).sort((a,b)=>b[1]-a[1]);

  // 書き込み（0件の場合はスキップ）
  if (byCat.all.length === 0) {
    console.error('\n⚠️ 全カテゴリ0件 — 既存データを保持してスキップ');
    process.exit(0);
  }

  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  // バックアップ
  const newsPath = path.join(OUT,'news.json');
  if (fs.existsSync(newsPath)) fs.copyFileSync(newsPath, path.join(OUT,'news.backup.json'));

  fs.writeFileSync(newsPath, JSON.stringify(byCat, null, 2));
  fs.writeFileSync(path.join(OUT,'meta.json'), JSON.stringify({
    updatedAt: new Date().toISOString(),
    counts: Object.fromEntries(Object.entries(byCat).map(([k,v])=>[k,v.length])),
    sources: sortedSources,
  }, null, 2));

  console.log('\n=== カテゴリ別 ===');
  Object.entries(byCat).forEach(([k,v]) => console.log(`  ${k}: ${v.length}件`));
  console.log('\n=== 媒体一覧（上位20）===');
  sortedSources.slice(0,20).forEach(([n,c]) => console.log(`  ${String(c).padStart(3)} ${n}`));
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
