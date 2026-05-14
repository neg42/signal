/**
 * SIGNAL fetch-news.js
 *
 * 修正点:
 *  - カテゴリ0件バグ修正（interleaveSources内のカテゴリ引継ぎ問題）
 *  - ナタリーRSS URL修正
 *  - YouTubeチャンネルRSS追加（ANN・FNN・TBS NEWS DIG）
 *  - Google Newsカテゴリ別URL方式を維持
 */
'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');
const { URL } = require('url');

const OUT              = path.resolve(__dirname, '../data');
const FETCH_DESC       = true;
const DESC_CONCURRENCY = 6;
const PER_SOURCE_LIMIT = 12;

// ─── HTTP ─────────────────────────────────────────────
function httpGet(rawUrl, timeout = 13000) {
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
      const c = [];
      res.on('data', d => c.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(c);
        const ct  = res.headers['content-type'] || '';
        // XMLの宣言からエンコーディングを取得
        const head = buf.slice(0, 200).toString('latin1');
        const xmlDecl = head.match(/encoding=["']([^"']+)["']/i)?.[1] || '';
        const body = decodeBody(buf, ct, xmlDecl);
        resolve({ status: res.statusCode, body, contentType: ct });
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// EUC-JPをUTF-8に変換（iconv-liteが使えない場合のフォールバック付き）
let iconv = null;
try { iconv = require('iconv-lite'); } catch {}

function decodeBody(buf, contentType = '', xmlDecl = '') {
  // エンコーディング判定
  const ct = (contentType + xmlDecl).toLowerCase();
  if (ct.includes('euc-jp') || ct.includes('euc_jp')) {
    if (iconv) return iconv.decode(buf, 'EUC-JP');
    // フォールバック: Bufferをlatin1で読んでからNode.jsの変換を試みる
    // （不完全だが文字化けよりまし）
    return buf.toString('utf8');
  }
  if (ct.includes('shift_jis') || ct.includes('sjis') || ct.includes('shift-jis')) {
    if (iconv) return iconv.decode(buf, 'Shift_JIS');
    return buf.toString('utf8');
  }
  return buf.toString('utf8');
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

function splitTitle(raw) {
  const text = toText(raw);
  const m = text.match(/^([\s\S]+?)\s+[-−–—]\s+([^-−–—]{2,30})$/);
  if (m) return { title: m[1].trim(), sourceHint: m[2].trim() };
  return { title: text, sourceHint: '' };
}

// ─── Google News RSS パーサー ─────────────────────────
function parseGN(xml, _name, category) {
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

    items.push({
      id: link, title, description: '',
      url: link, image: '', source, category,
      date: parseDate(dEl ? dEl[1] : ''),
    });
  }
  return items.slice(0, 50);
}

// ─── 個別RSS パーサー ─────────────────────────────────
function parseJpRSS(xml, sourceName, category) {
  const items = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>|<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const chunk = m[1] || m[2];
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

    // description: imgタグ・aタグを中身ごと除去
    let rawDesc = get('description') || get('summary') || get('content') || '';
    rawDesc = rawDesc.replace(/<img[^>]*\/?>|<img[^>]*>[\s\S]*?<\/img>/gi, '');
    rawDesc = rawDesc.replace(/<a[\s\S]*?<\/a>/gi, '');
    const desc = toText(rawDesc).slice(0, 140);
    const finalDesc = (desc.length >= 20 && !/<|src=/.test(desc)) ? desc : '';

    items.push({
      id: link, title, description: finalDesc,
      url: link, image: '',
      date: parseDate(get('pubDate') || get('published') || get('updated')),
      source: sourceName, category,
    });
  }
  return items.slice(0, 15);
}

// ─── YouTube RSS パーサー ─────────────────────────────
// YouTubeはAtom形式: <entry>タグ
function parseYouTubeRSS(xml, channelName, category) {
  const items = [];
  const entryRe = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const chunk = m[1];
    const title  = toText(chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
    const link   = chunk.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || '';
    const date   = chunk.match(/<published[^>]*>([\s\S]*?)<\/published>/i)?.[1] || '';
    const desc   = toText(chunk.match(/<media:description[^>]*>([\s\S]*?)<\/media:description>/i)?.[1] || '').slice(0, 140);
    const thumb  = chunk.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i)?.[1] || '';

    if (!title || !link || !isJP(title)) continue;

    items.push({
      id: link, title, description: desc,
      url: link, image: thumb,
      date: parseDate(date),
      source: channelName, category,
    });
  }
  return items.slice(0, 15);
}

// ─── ソース定義 ───────────────────────────────────────
const GN_BASE   = 'https://news.google.com/news/rss/headlines/section/topic';
const GN_PARAMS = '?ned=jp&hl=ja&gl=JP';

const GN_SOURCES = [
  { url: `${GN_BASE}/NATION.ja_jp/国内${GN_PARAMS}`,            cat: 'society'       },
  { url: 'https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja',  cat: 'society'       },
  { url: `${GN_BASE}/POLITICS.ja_jp/政治${GN_PARAMS}`,          cat: 'politics'      },
  { url: `${GN_BASE}/WORLD.ja_jp/国際${GN_PARAMS}`,             cat: 'politics'      },
  { url: `${GN_BASE}/BUSINESS.ja_jp/ビジネス${GN_PARAMS}`,      cat: 'business'      },
  { url: `${GN_BASE}/ENTERTAINMENT.ja_jp/エンタメ${GN_PARAMS}`, cat: 'entertainment' },
  { url: `${GN_BASE}/SPORTS.ja_jp/スポーツ${GN_PARAMS}`,        cat: 'sports'        },
  { url: `${GN_BASE}/SCITECH.ja_jp/テクノロジー${GN_PARAMS}`,   cat: 'tech'          },
];

// YouTubeチャンネルRSS（登録不要・公式API不要）
const YT_BASE = 'https://www.youtube.com/feeds/videos.xml?channel_id=';
const YT_SOURCES = [
  { url: `${YT_BASE}UCGCZAYq5Xxojl_tSXcVJhiQ`, cat: 'society', name: 'ANN テレ朝（YouTube）' },
  { url: `${YT_BASE}UCoQBJMzcwmXrRSHBFAlTsIw`,  cat: 'society', name: 'FNN プライムオンライン（YouTube）' },
  { url: `${YT_BASE}UC6AG81pAkf6Lbi_1VC5NmPA`,  cat: 'society', name: 'TBS NEWS DIG（YouTube）' },
];

// 個別RSS
const JP_RSS = [
  // テクノロジー
  { url: 'https://gigazine.net/news/rss_2.0/',            cat: 'tech',          name: 'GIGAZINE'          },

  // エンタメ・ゲーム
  { url: 'https://jp.ign.com/feed.xml',                    cat: 'entertainment', name: 'IGN Japan'         },
  { url: 'https://natalie.mu/music/feed',                  cat: 'entertainment', name: 'ナタリー音楽'       },
  { url: 'https://natalie.mu/comic/feed',                  cat: 'entertainment', name: 'コミックナタリー'   },
  { url: 'https://natalie.mu/eiga/feed',                   cat: 'entertainment', name: 'ナタリー映画'       },
  { url: 'https://natalie.mu/game/feed',                   cat: 'entertainment', name: 'ナタリーゲーム'     },
  { url: 'https://www.4gamer.net/rss/index.xml',           cat: 'entertainment', name: '4Gamer'            },
  { url: 'https://automaton-media.com/feed/',               cat: 'entertainment', name: 'AUTOMATON'         },

  // ライブドアニュース（カテゴリ別RSS）
  { url: 'http://news.livedoor.com/topics/rss/top.xml',   cat: 'society',       name: 'ライブドアニュース' },
  { url: 'http://news.livedoor.com/topics/rss/dom.xml',   cat: 'society',       name: 'ライブドア国内'    },
  { url: 'http://news.livedoor.com/topics/rss/int.xml',   cat: 'politics',      name: 'ライブドア国際'    },
  { url: 'http://news.livedoor.com/topics/rss/eco.xml',   cat: 'business',      name: 'ライブドア経済'    },
  { url: 'http://news.livedoor.com/topics/rss/ent.xml',   cat: 'entertainment', name: 'ライブドアエンタメ' },
  { url: 'http://news.livedoor.com/topics/rss/spo.xml',   cat: 'sports',        name: 'ライブドアスポーツ' },
  { url: 'http://news.livedoor.com/topics/rss/sci.xml',   cat: 'tech',          name: 'ライブドア科学'    },
];

async function fetchBatch(sources, parser) {
  const BATCH = 4;
  const all = [];
  for (let i = 0; i < sources.length; i += BATCH) {
    const batch = sources.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async src => {
      const r = await httpGet(src.url, 14000);
      if (!r || r.status !== 200) {
        console.log(`  SKIP [${r?.status||'ERR'}] ${src.name||src.url.slice(40,75)}`);
        return [];
      }
      const items = parser(r.body, src.name || 'Google News', src.cat);
      console.log(`  OK [${src.cat}] ${src.name||src.url.slice(40,70)}: ${items.length}件`);
      return items;
    }));
    all.push(...results.flat());
    await new Promise(r => setTimeout(r, 200));
  }
  return all;
}

// ─── 本文取得 ─────────────────────────────────────────
const BAD_DESC = [
  /Google ?ニュース/, /世界中のニュース提供元/, /集約した広範囲/,
  /news\.google\.com/, /^https?:\/\//, /comprehensive up-to-date/i,
];
const isValidDesc = t => t && t.length >= 20 && !BAD_DESC.some(p => p.test(t));

function extractDesc(html) {
  const pats = [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{20,}?)["']/i,
    /<meta[^>]+content=["']([^"']{20,}?)["'][^>]+property=["']og:description["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{20,}?)["']/i,
    /<meta[^>]+content=["']([^"']{20,}?)["'][^>]+name=["']description["']/i,
    /<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']{20,}?)["']/i,
  ];
  for (const p of pats) {
    const m = html.match(p);
    if (m) { const t = toText(m[1]); if (isValidDesc(t)) return t.slice(0, 140); }
  }
  const artM = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const src = artM ? artM[1] : html;
  const pM = src.match(/<p[^>]*>([\s\S]{30,500}?)<\/p>/i);
  if (pM) { const t = toText(pM[1]); if (isValidDesc(t)) return t.slice(0, 140); }
  return '';
}

async function enrichDescriptions(articles) {
  const direct = articles.filter(a => !a.description && !a.url.includes('news.google.com'));
  const gn     = articles.filter(a => !a.description &&  a.url.includes('news.google.com'));
  const targets = [...direct, ...gn.slice(0, 60)];
  console.log(`\n本文取得: ${targets.length}件 (直${direct.length} + GN${Math.min(gn.length,60)})`);
  let done = 0;
  for (let i = 0; i < targets.length; i += DESC_CONCURRENCY) {
    const batch = targets.slice(i, i + DESC_CONCURRENCY);
    await Promise.all(batch.map(async a => {
      try {
        const r = await httpGet(a.url, 8000);
        if (r?.status === 200) a.description = extractDesc(r.body);
      } catch {}
      done++;
    }));
    if (done % 30 === 0 || done === targets.length) console.log(`  ${done}/${targets.length}件`);
    if (i + DESC_CONCURRENCY < targets.length) await new Promise(r => setTimeout(r, 100));
  }
}

// ─── 重複除去 & ソース多様化 ──────────────────────────
function dedup(arts, limit = 80) {
  // タイトルで重複除去（日付降順）
  const seen = new Set();
  const unique = arts
    .filter(a => {
      if (!a?.title || a.title.length < 4 || !a.category) return false;
      const k = a.title.replace(/\s+/g,'').slice(0,40);
      if (seen.has(k)) return false;
      seen.add(k); return true;
    })
    .sort((a,b) => new Date(b.date)-new Date(a.date));

  // ソース別グループ化でラウンドロビン
  const bySource = {};
  for (const a of unique) {
    (bySource[a.source] = bySource[a.source]||[]).push(a);
  }
  const sources = Object.keys(bySource);
  if (sources.length <= 1) return unique.slice(0, limit);

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

// ─── メイン ───────────────────────────────────────────
async function main() {
  console.log('SIGNAL fetch-news\n');

  console.log('=== Google News（カテゴリRSS）===');
  const gnItems = await fetchBatch(GN_SOURCES, parseGN);

  console.log('\n=== YouTube チャンネル ===');
  const ytItems = await fetchBatch(YT_SOURCES, parseYouTubeRSS);

  console.log('\n=== 個別RSS ===');
  const jpItems = await fetchBatch(JP_RSS, parseJpRSS);

  // 全記事をマージ
  let all = [...gnItems, ...ytItems, ...jpItems];

  // デバッグ: カテゴリ分布確認
  const preDist = {};
  all.forEach(a => { preDist[a.category||'undefined'] = (preDist[a.category||'undefined']||0)+1; });
  console.log('\n取得後カテゴリ分布:', JSON.stringify(preDist));

  // 重複除去（全体）
  const seen = new Set();
  all = all.filter(a => {
    if (!a.title || !a.category) return false;
    const k = a.title.replace(/\s+/g,'').slice(0,40);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  // 1カテゴリあたり同一ソース上限
  const srcCatCount = {};
  all = all.filter(a => {
    const key = `${a.category}:${a.source}`;
    srcCatCount[key] = (srcCatCount[key]||0)+1;
    return srcCatCount[key] <= PER_SOURCE_LIMIT;
  });

  // 本文取得
  await enrichDescriptions(all);

  // カテゴリ別振り分け
  const cats = ['society','tech','business','entertainment','sports','politics'];
  const byCat = {};
  cats.forEach(c => {
    byCat[c] = dedup(all.filter(a => a.category === c));
  });
  byCat.custom = [];
  byCat.all = dedup(all, 120);

  // 書き込み
  if (byCat.all.length === 0) {
    console.error('\n⚠️ 全0件 — 既存データ保持');
    process.exit(0);
  }

  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const newsPath = path.join(OUT,'news.json');
  if (fs.existsSync(newsPath)) fs.copyFileSync(newsPath, path.join(OUT,'news.backup.json'));
  fs.writeFileSync(newsPath, JSON.stringify(byCat, null, 2));

  const srcCount = {};
  all.forEach(a => { srcCount[a.source] = (srcCount[a.source]||0)+1; });
  const sortedSrc = Object.entries(srcCount).sort((a,b)=>b[1]-a[1]);
  fs.writeFileSync(path.join(OUT,'meta.json'), JSON.stringify({
    updatedAt: new Date().toISOString(),
    counts: Object.fromEntries(Object.entries(byCat).map(([k,v])=>[k,v.length])),
    sources: sortedSrc,
  }, null, 2));

  console.log('\n=== カテゴリ別 ===');
  Object.entries(byCat).forEach(([k,v]) => console.log(`  ${k}: ${v.length}件`));
  console.log('\n=== 媒体一覧（上位20）===');
  sortedSrc.slice(0,20).forEach(([n,c]) => console.log(`  ${String(c).padStart(3)} ${n}`));
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
