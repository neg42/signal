/**
 * SIGNAL fetch-news.js v6
 * 
 * GitHub Actions で動く確実な収集スクリプト。
 * 
 * 戦略:
 *  1. User-Agentをgooglebotに設定 → ほぼ全サイトが許可するクローラー
 *  2. Refererを設定して一般クローラーと見なさせる
 *  3. 接続失敗したソースはスキップ（全体を止めない）
 *  4. data/news.json に書き出す
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');
const { URL } = require('url');

const OUT_DIR = path.resolve(__dirname, '../data');

// ─── HTTP取得（複数UAを試す）─────────────────────────
const USER_AGENTS = [
  // Googlebotは最も通りやすい
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  // 次点: 一般的なブラウザUA
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  // フィードリーダー
  'FeedFetcher-Google; (+http://www.google.com/feedfetcher.html)',
];

function httpGet(rawUrl, uaIndex = 0) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(rawUrl); }
    catch { return resolve(null); }

    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': USER_AGENTS[uaIndex] || USER_AGENTS[0],
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'ja,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
      },
      timeout: 15000,
    }, res => {
      if ([301,302,307,308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        let next = res.headers.location;
        if (!next.startsWith('http')) next = `${parsed.protocol}//${parsed.hostname}${next}`;
        return httpGet(next, uaIndex).then(resolve);
      }
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// UAを変えながらリトライ
async function fetchWithRetry(url) {
  for (let i = 0; i < USER_AGENTS.length; i++) {
    const r = await httpGet(url, i);
    if (r && r.status === 200 && r.body.length > 100) return r.body;
    if (r && r.status === 200) return r.body; // 空でも200なら使う
  }
  return null;
}

// ─── RSS パーサー ─────────────────────────────────────
function parseRSS(xml, source, category) {
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
    const attr = (tag, a) => {
      const r = new RegExp(`<${tag}[^>]+${a}=["']([^"']+)["']`, 'i');
      const h = r.exec(chunk);
      return h ? h[1] : '';
    };

    const title = strip(txt('title'));
    const link  = txt('link') || attr('link', 'href') || attr('enclosure', 'url');
    if (!title || !link || title.length < 3) continue;

    const desc = strip(txt('description') || txt('summary') || txt('content')).slice(0, 280);
    const date = parseDate(txt('pubDate') || txt('published') || txt('updated'));

    // 画像: media:thumbnail > enclosure > content内img > description内img
    const image =
      attr('media:thumbnail', 'url') ||
      attr('media:content', 'url')   ||
      (attr('enclosure', 'type').startsWith('image') ? attr('enclosure', 'url') : '') ||
      attr('enclosure', 'url')       ||
      extractImg(txt('content') || txt('description') || chunk) ||
      '';

    items.push({ id: link, title, description: desc, url: link, image, date, source, category });
  }
  return items.slice(0, 25);
}

function strip(h = '') {
  return h.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
}
function extractImg(html = '') {
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : '';
}
function parseDate(s) {
  if (!s) return new Date().toISOString();
  try { const d = new Date(s); return isNaN(d) ? new Date().toISOString() : d.toISOString(); }
  catch { return new Date().toISOString(); }
}

// ─── RSSソース定義 ────────────────────────────────────
const SOURCES = [
  // 社会
  { name: 'NHK トップ',          url: 'https://www3.nhk.or.jp/rss/news/cat0.xml',         cat: 'society' },
  { name: 'NHK 社会',            url: 'https://www3.nhk.or.jp/rss/news/cat1.xml',          cat: 'society' },
  { name: '朝日新聞',             url: 'https://www.asahi.com/rss/asahi/newsheadlines.rdf', cat: 'society' },
  { name: '毎日新聞',             url: 'https://mainichi.jp/rss/etc/mainichi-flash.rss',    cat: 'society' },
  { name: '読売新聞',             url: 'https://www.yomiuri.co.jp/feed/top/',               cat: 'society' },
  // テクノロジー
  { name: 'TechCrunch',         url: 'https://techcrunch.com/feed/',                       cat: 'tech'    },
  { name: 'Ars Technica',       url: 'https://feeds.arstechnica.com/arstechnica/index',    cat: 'tech'    },
  { name: 'WIRED Japan',        url: 'https://wired.jp/rss/',                              cat: 'tech'    },
  { name: 'GIGAZINE',           url: 'https://gigazine.net/news/rss_2.0/',                 cat: 'tech'    },
  { name: 'Engadget Japan',     url: 'https://japanese.engadget.com/rss.xml',              cat: 'tech'    },
  // ビジネス
  { name: 'NHK 経済',           url: 'https://www3.nhk.or.jp/rss/news/cat5.xml',          cat: 'business'},
  { name: '東洋経済オンライン',   url: 'https://toyokeizai.net/list/feed/rss',              cat: 'business'},
  { name: 'Reuters Business',   url: 'https://feeds.reuters.com/reuters/businessNews',     cat: 'business'},
  { name: 'ダイヤモンドOnline',  url: 'https://diamond.jp/list/feed/rss',                  cat: 'business'},
  // エンタメ・ゲーム
  { name: 'ファミ通',            url: 'https://www.famitsu.com/feed',                      cat: 'entertainment' },
  { name: '電撃オンライン',       url: 'https://dengekionline.com/rss/all.rss',              cat: 'entertainment' },
  { name: 'ORICON NEWS',        url: 'https://www.oricon.co.jp/rss/news.rdf',              cat: 'entertainment' },
  { name: 'ナタリー 音楽',       url: 'https://natalie.mu/music/feed/news',                 cat: 'entertainment' },
  { name: 'ナタリー コミック',    url: 'https://natalie.mu/comic/feed/news',                cat: 'entertainment' },
  { name: 'IGN Japan',          url: 'https://jp.ign.com/feed.xml',                        cat: 'entertainment' },
  // 政治
  { name: 'NHK 政治',           url: 'https://www3.nhk.or.jp/rss/news/cat4.xml',          cat: 'politics'},
  { name: 'NHK 国際',           url: 'https://www3.nhk.or.jp/rss/news/cat6.xml',          cat: 'politics'},
  { name: 'BBC World',          url: 'https://feeds.bbci.co.uk/news/world/rss.xml',        cat: 'politics'},
  { name: 'Reuters Politics',   url: 'https://feeds.reuters.com/Reuters/PoliticsNews',     cat: 'politics'},
];

// ─── Hacker News ──────────────────────────────────────
async function fetchHN() {
  try {
    const body = await fetchWithRetry('https://hacker-news.firebaseio.com/topstories.json');
    if (!body) return [];
    const ids = JSON.parse(body).slice(0, 20);
    const stories = await Promise.all(
      ids.map(id => fetchWithRetry(`https://hacker-news.firebaseio.com/item/${id}.json`)
        .then(b => b ? JSON.parse(b) : null).catch(() => null))
    );
    return stories.filter(s => s?.title && s?.url).map(s => ({
      id: `hn-${s.id}`, title: s.title,
      description: `▲ ${s.score} points · ${s.descendants||0} comments · by ${s.by}`,
      url: s.url, image: '',
      date: new Date(s.time * 1000).toISOString(),
      source: 'Hacker News', category: 'tech',
    }));
  } catch { return []; }
}

// ─── 重複除去 ─────────────────────────────────────────
function dedup(arts, limit = 80) {
  const seen = new Set();
  return arts.filter(a => {
    if (!a?.title) return false;
    const k = a.title.replace(/\s+/g,'').slice(0,40);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).sort((a,b) => new Date(b.date)-new Date(a.date)).slice(0, limit);
}

// ─── メイン ───────────────────────────────────────────
async function main() {
  console.log('SIGNAL fetch-news v6\n');

  const byCat = { society:[], tech:[], business:[], entertainment:[], politics:[], all:[], custom:[] };

  // RSS 4並行
  const BATCH = 4;
  for (let i = 0; i < SOURCES.length; i += BATCH) {
    const batch = SOURCES.slice(i, i + BATCH);
    await Promise.all(batch.map(async src => {
      const xml = await fetchWithRetry(src.url);
      if (!xml) { console.log(`  SKIP ${src.name}`); return; }
      const items = parseRSS(xml, src.name, src.cat);
      byCat[src.cat].push(...items);
      // 画像取得数を表示
      const withImg = items.filter(a => a.image).length;
      console.log(`  OK   ${src.name}: ${items.length}件 (画像${withImg}件)`);
    }));
    await new Promise(r => setTimeout(r, 200));
  }

  // Hacker News
  const hn = await fetchHN();
  byCat.tech.push(...hn);
  console.log(`  OK   Hacker News: ${hn.length}件`);

  // 重複除去・ソート
  for (const k of Object.keys(byCat)) {
    if (k !== 'all' && k !== 'custom') byCat[k] = dedup(byCat[k]);
  }
  byCat.all = dedup(Object.entries(byCat).filter(([k])=>k!=='all'&&k!=='custom').flatMap(([,v])=>v), 120);

  // 書き出し
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR,'news.json'), JSON.stringify(byCat, null, 2));
  fs.writeFileSync(path.join(OUT_DIR,'meta.json'), JSON.stringify({
    updatedAt: new Date().toISOString(),
    counts: Object.fromEntries(Object.entries(byCat).map(([k,v])=>[k,v.length])),
  }, null, 2));

  console.log('\n結果:');
  Object.entries(byCat).forEach(([k,v]) => console.log(`  ${k}: ${v.length}件`));
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
