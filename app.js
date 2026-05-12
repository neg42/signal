/* ═══════════════════════════════════════════════════════
   SIGNAL v5 — パーソナルニュースアグリゲーター
   ブラウザ側でRSSを直接取得（GitHub ActionsのIPブロック問題を回避）
   CORSプロキシ: rss2json.com（登録不要）+ allorigins.win（登録不要）
   ═══════════════════════════════════════════════════════ */

const CATEGORIES = [
  { id: 'all',           label: 'すべて',          icon: '◎' },
  { id: 'tech',          label: 'テクノロジー・AI', icon: '⚡' },
  { id: 'business',      label: 'ビジネス・経済',   icon: '📈' },
  { id: 'entertainment', label: 'エンタメ・ゲーム', icon: '🎮' },
  { id: 'politics',      label: '政治',            icon: '🏛' },
  { id: 'society',       label: '社会',            icon: '📰' },
  { id: 'custom',        label: 'カスタム RSS',     icon: '✦' },
];

// ─── RSSソース定義（ブラウザが直接取得）─────────────
const RSS_SOURCES = [
  // 社会
  { id: 'nhk0',      name: 'NHK トップ',         url: 'https://www3.nhk.or.jp/rss/news/cat0.xml',         category: 'society',       enabled: true  },
  { id: 'nhk1',      name: 'NHK 社会',            url: 'https://www3.nhk.or.jp/rss/news/cat1.xml',         category: 'society',       enabled: true  },
  { id: 'asahi',     name: '朝日新聞',             url: 'https://www.asahi.com/rss/asahi/newsheadlines.rdf',category: 'society',       enabled: true  },
  { id: 'mainichi',  name: '毎日新聞',             url: 'https://mainichi.jp/rss/etc/mainichi-flash.rss',   category: 'society',       enabled: true  },
  { id: 'yomiuri',   name: '読売新聞',             url: 'https://www.yomiuri.co.jp/feed/top/',              category: 'society',       enabled: true  },
  // テクノロジー・AI
  { id: 'tc',        name: 'TechCrunch',          url: 'https://techcrunch.com/feed/',                     category: 'tech',          enabled: true  },
  { id: 'ars',       name: 'Ars Technica',        url: 'https://feeds.arstechnica.com/arstechnica/index',  category: 'tech',          enabled: true  },
  { id: 'wired',     name: 'WIRED Japan',         url: 'https://wired.jp/rss/',                            category: 'tech',          enabled: true  },
  { id: 'giga',      name: 'GIGAZINE',            url: 'https://gigazine.net/news/rss_2.0/',               category: 'tech',          enabled: true  },
  { id: 'engadget',  name: 'Engadget Japan',      url: 'https://japanese.engadget.com/rss.xml',            category: 'tech',          enabled: true  },
  { id: 'gizmodo',   name: 'Gizmodo Japan',       url: 'https://www.gizmodo.jp/index.xml',                 category: 'tech',          enabled: true  },
  // ビジネス・経済
  { id: 'nhk5',      name: 'NHK 経済',            url: 'https://www3.nhk.or.jp/rss/news/cat5.xml',         category: 'business',      enabled: true  },
  { id: 'toyo',      name: '東洋経済オンライン',   url: 'https://toyokeizai.net/list/feed/rss',             category: 'business',      enabled: true  },
  { id: 'reuters',   name: 'Reuters Business',    url: 'https://feeds.reuters.com/reuters/businessNews',   category: 'business',      enabled: true  },
  { id: 'diamond',   name: 'ダイヤモンド Online',  url: 'https://diamond.jp/list/feed/rss',                 category: 'business',      enabled: true  },
  // エンタメ・ゲーム
  { id: 'famitsu',   name: 'ファミ通',             url: 'https://www.famitsu.com/feed',                     category: 'entertainment', enabled: true  },
  { id: 'dengeki',   name: '電撃オンライン',        url: 'https://dengekionline.com/rss/all.rss',            category: 'entertainment', enabled: true  },
  { id: 'oricon',    name: 'ORICON NEWS',         url: 'https://www.oricon.co.jp/rss/news.rdf',            category: 'entertainment', enabled: true  },
  { id: 'natalie',   name: 'ナタリー 音楽',        url: 'https://natalie.mu/music/feed/news',               category: 'entertainment', enabled: true  },
  { id: 'nataliec',  name: 'ナタリー コミック',    url: 'https://natalie.mu/comic/feed/news',               category: 'entertainment', enabled: true  },
  { id: 'ign',       name: 'IGN Japan',           url: 'https://jp.ign.com/feed.xml',                      category: 'entertainment', enabled: true  },
  // 政治
  { id: 'nhk4',      name: 'NHK 政治',            url: 'https://www3.nhk.or.jp/rss/news/cat4.xml',         category: 'politics',      enabled: true  },
  { id: 'nhk6',      name: 'NHK 国際',            url: 'https://www3.nhk.or.jp/rss/news/cat6.xml',         category: 'politics',      enabled: true  },
  { id: 'bbc',       name: 'BBC World',           url: 'http://feeds.bbci.co.uk/news/world/rss.xml',       category: 'politics',      enabled: true  },
  { id: 'rtpol',     name: 'Reuters Politics',    url: 'https://feeds.reuters.com/Reuters/PoliticsNews',   category: 'politics',      enabled: true  },
];

// ─── CORSプロキシ（登録不要・2系統でフォールバック）──
// 方法1: rss2json.com — RSSをJSONに変換して返す（最も安定）
// 方法2: allorigins.win — 汎用プロキシ
async function fetchRSSviaProxy(src) {
  // まずrss2jsonで試みる
  try {
    const url = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(src.url)}&count=20`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    if (data.status === 'ok' && data.items?.length) {
      return data.items.map(item => ({
        id:          item.link || item.guid,
        title:       item.title || '',
        description: stripHTML(item.description || item.content || '').slice(0, 250),
        url:         item.link || '',
        image:       item.enclosure?.link || item.thumbnail || extractFirstImg(item.description || item.content || ''),
        date:        item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
        source:      src.name,
        category:    src.category,
      })).filter(a => a.title && a.url);
    }
  } catch { /* fallthrough */ }

  // フォールバック: allorigins経由でXMLを直接パース
  try {
    const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(src.url)}`;
    const res = await fetch(proxy, { signal: AbortSignal.timeout(12000) });
    const data = await res.json();
    if (!data.contents) return [];
    return parseRSSXML(data.contents, src.name, src.category);
  } catch { return []; }
}

function parseRSSXML(xml, sourceName, category) {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    return [...doc.querySelectorAll('item, entry')].slice(0, 20).map(item => {
      const g  = sel => item.querySelector(sel)?.textContent?.trim() || '';
      const ga = (sel, attr) => item.querySelector(sel)?.getAttribute(attr) || '';
      const title = g('title');
      const link  = g('link') || ga('link', 'href');
      if (!title || !link) return null;
      const desc = stripHTML(g('description') || g('summary') || g('content') || '').slice(0, 250);
      const dateStr = g('pubDate') || g('published') || g('updated') || '';
      const image = ga('enclosure', 'url') || ga('media:thumbnail', 'url') || extractFirstImg(g('description') || '');
      return {
        id: link, title, description: desc, url: link, image,
        date: dateStr ? new Date(dateStr).toISOString() : new Date().toISOString(),
        source: sourceName, category,
      };
    }).filter(Boolean);
  } catch { return []; }
}

// Hacker News（登録不要・無制限）
async function fetchHackerNews() {
  try {
    const res = await fetch('https://hacker-news.firebaseio.com/topstories.json', { signal: AbortSignal.timeout(8000) });
    const ids = (await res.json()).slice(0, 20);
    const stories = await Promise.all(
      ids.map(id =>
        fetch(`https://hacker-news.firebaseio.com/item/${id}.json`)
          .then(r => r.json()).catch(() => null)
      )
    );
    return stories.filter(s => s?.title && s?.url).map(s => ({
      id:          `hn-${s.id}`,
      title:       s.title,
      description: `▲ ${s.score} points · ${s.descendants || 0} comments · by ${s.by}`,
      url:         s.url,
      image:       '',
      date:        new Date(s.time * 1000).toISOString(),
      source:      'Hacker News',
      category:    'tech',
    }));
  } catch { return []; }
}

// ─── ユーティリティ ──────────────────────────────────
function stripHTML(html = '') {
  return html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
}
function extractFirstImg(html = '') {
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : '';
}
function dedupSort(arts, limit = 200) {
  const seen = new Set();
  return arts.filter(a => {
    if (!a?.title) return false;
    const k = a.title.replace(/\s+/g,'').slice(0,40);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).sort((a,b) => new Date(b.date)-new Date(a.date)).slice(0, limit);
}
function relativeTime(dateStr) {
  const m = Math.floor((Date.now() - new Date(dateStr)) / 60000);
  if (m < 1)  return 'たった今';
  if (m < 60) return m + '分前';
  const h = Math.floor(m/60);
  if (h < 24) return h + '時間前';
  return Math.floor(h/24) + '日前';
}
function escHtml(s='') {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── STATE ───────────────────────────────────────────
let allArticles      = [];
let filteredArticles = [];
let activeCategory   = 'all';
let searchQuery      = '';
let isListView       = false;
let customSources    = [];
let activeSources    = [];

// ─── INIT ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  customSources = JSON.parse(localStorage.getItem('signal_custom_sources') || '[]');
  activeSources = JSON.parse(localStorage.getItem('signal_active_sources') ||
    JSON.stringify(RSS_SOURCES.map(s => ({ id: s.id, enabled: s.enabled }))));
  buildCategoryNav();
  setupEventListeners();
  loadNews();
});

// ─── NEWS LOAD ───────────────────────────────────────
async function loadNews() {
  showLoading();
  allArticles = [];
  buildCategoryNav();

  const enabledRSS = RSS_SOURCES.filter(s => {
    const state = activeSources.find(a => a.id === s.id);
    return state ? state.enabled : s.enabled;
  });
  const enabledCustom = customSources.filter(s => s.enabled);
  const allSources = [
    ...enabledRSS,
    ...enabledCustom,
  ];

  // 進捗表示付きで並行取得
  const total = allSources.length + 1; // +1 for HN
  let done = 0;
  const updateProgress = () => {
    done++;
    const pct = Math.round(done/total*100);
    const el = document.getElementById('loadingMsg');
    if (el) el.textContent = `ニュースを取得中… ${done}/${total} (${pct}%)`;
  };

  // RSSを並行取得（4本ずつ）
  const BATCH = 4;
  const results = [];
  for (let i = 0; i < allSources.length; i += BATCH) {
    const batch = allSources.slice(i, i+BATCH);
    const fetched = await Promise.all(batch.map(async src => {
      const arts = await fetchRSSviaProxy(src);
      updateProgress();
      return arts;
    }));
    results.push(...fetched.flat());
  }

  // Hacker News
  const hn = await fetchHackerNews();
  updateProgress();
  results.push(...hn);

  allArticles = dedupSort(results);
  buildCategoryNav();
  buildTicker();
  filterAndRender();
  updateLastUpdated();
}

// ─── カテゴリ ────────────────────────────────────────
function buildCategoryNav() {
  const list = document.getElementById('categoryList');
  list.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const count = cat.id === 'all' ? allArticles.length
      : allArticles.filter(a => a.category === cat.id).length;
    const li = document.createElement('li');
    li.innerHTML = `<a class="${activeCategory===cat.id?'active':''}" data-cat="${cat.id}">
      <span class="cat-icon">${cat.icon}</span>
      <span>${cat.label}</span>
      ${count > 0 ? `<span class="cat-count">${count}</span>` : ''}
    </a>`;
    li.querySelector('a').addEventListener('click', () => setCategory(cat.id, cat.label));
    list.appendChild(li);
  });
}

function setCategory(id, label) {
  activeCategory = id;
  document.getElementById('topbarTitle').textContent = id==='all' ? 'すべてのニュース' : label;
  buildCategoryNav();
  filterAndRender();
  if (window.innerWidth <= 768) toggleSidebar();
}

// ─── TICKER ──────────────────────────────────────────
function buildTicker() {
  const track = document.getElementById('tickerTrack');
  const items = allArticles.slice(0,12).map(a => `<span class="ticker-item">${escHtml(a.title)}</span>`).join('');
  track.innerHTML = items + items;
}

// ─── RENDER ──────────────────────────────────────────
function filterAndRender() {
  const q = searchQuery.toLowerCase();
  filteredArticles = allArticles.filter(a => {
    const catOk = activeCategory==='all' || a.category===activeCategory;
    const searchOk = !q || a.title.toLowerCase().includes(q) || (a.description||'').toLowerCase().includes(q);
    return catOk && searchOk;
  });
  renderFeed();
}

function renderFeed() {
  const feed = document.getElementById('feed');
  feed.className = 'feed' + (isListView ? ' list-view' : '');
  if (!filteredArticles.length) {
    feed.innerHTML = `<div class="empty-state"><h3>記事が見つかりません</h3><p>別のカテゴリを選択するか、しばらくお待ちください。</p></div>`;
    return;
  }
  feed.innerHTML = filteredArticles.map(cardHTML).join('');
  feed.querySelectorAll('.card').forEach((el,i) => {
    el.style.animationDelay = (i*0.03)+'s';
    el.classList.add('card-in');
    el.addEventListener('click', () => openArticle(filteredArticles[i]));
  });
}

function cardHTML(a) {
  const catLabel = CATEGORIES.find(c=>c.id===a.category)?.label || a.category;
  const img = a.image ? `<img class="card-img" src="${escHtml(a.image)}" alt="" loading="lazy" onerror="this.style.display='none'"/>` : '';
  return `<article class="card">
    ${img}
    <div class="card-body">
      <div class="card-category">${escHtml(catLabel)}</div>
      <div class="card-title">${escHtml(a.title)}</div>
      <div class="card-desc">${escHtml(a.description||'')}</div>
    </div>
    <div class="card-footer">
      <span class="card-source">${escHtml(a.source)}</span>
      <span class="card-time">${relativeTime(a.date)}</span>
    </div>
  </article>`;
}

function showLoading() {
  document.getElementById('feed').innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p id="loadingMsg">ニュースを取得中…</p>
    </div>`;
}

// ─── 記事モーダル ────────────────────────────────────
function openArticle(a) {
  const catLabel = CATEGORIES.find(c=>c.id===a.category)?.label || a.category;
  document.getElementById('articleMetaTop').textContent = a.source + ' · ' + relativeTime(a.date);
  document.getElementById('articleBody').innerHTML = `
    <div class="art-category">${escHtml(catLabel)}</div>
    <h1>${escHtml(a.title)}</h1>
    <div class="art-meta">
      <span>📰 ${escHtml(a.source)}</span>
      <span>🕐 ${new Date(a.date).toLocaleString('ja-JP')}</span>
    </div>
    ${a.image?`<img class="art-img" src="${escHtml(a.image)}" alt="" onerror="this.style.display='none'"/>`:''}
    <p class="art-body">${escHtml(a.description||'')}</p>
    <a class="art-link" href="${escHtml(a.url)}" target="_blank" rel="noopener">元記事を読む →</a>`;
  document.getElementById('articleModal').classList.add('active');
  document.getElementById('articleBackdrop').classList.add('active');
}
function closeArticle() {
  ['articleModal','articleBackdrop'].forEach(id=>document.getElementById(id).classList.remove('active'));
}

// ─── 設定モーダル ────────────────────────────────────
function buildSourceList() {
  const c = document.getElementById('sourceCategories');
  const grouped = {};
  CATEGORIES.filter(cat=>cat.id!=='all'&&cat.id!=='custom').forEach(cat=>{
    grouped[cat.id] = { label: cat.label, icon: cat.icon, sources: RSS_SOURCES.filter(s=>s.category===cat.id) };
  });

  const rssHTML = Object.values(grouped).map(g => `
    <div class="source-group">
      <div class="source-group-title">${g.icon} ${escHtml(g.label)}</div>
      ${g.sources.map(s => {
        const state = activeSources.find(a=>a.id===s.id);
        const checked = state ? state.enabled : s.enabled;
        return `<div class="source-item">
          <input type="checkbox" id="src-${s.id}" data-id="${s.id}" ${checked?'checked':''}/>
          <label for="src-${s.id}">${escHtml(s.name)}</label>
          <span class="source-badge rss">RSS</span>
        </div>`;
      }).join('')}
    </div>`).join('');

  const hnHTML = `<div class="source-group">
    <div class="source-group-title">⚡ テクノロジー（API）</div>
    <div class="source-item">
      <input type="checkbox" checked disabled/>
      <label>Hacker News</label>
      <span class="source-badge api">API</span>
    </div>
  </div>`;

  const customHTML = customSources.length
    ? customSources.map(s=>`
      <div class="source-item" data-id="${s.id}">
        <input type="checkbox" id="cs-${s.id}" data-custom="${s.id}" ${s.enabled?'checked':''}/>
        <label for="cs-${s.id}">${escHtml(s.name)}</label>
        <span class="source-badge custom">カスタム</span>
        <button class="delete-source-btn" data-id="${s.id}">✕</button>
      </div>`).join('')
    : `<p class="no-custom">まだカスタムソースはありません</p>`;

  c.innerHTML = rssHTML + hnHTML + `
    <div class="source-group">
      <div class="source-group-title">✦ カスタムRSS</div>${customHTML}
    </div>`;

  c.querySelectorAll('input[data-id]').forEach(cb=>{
    cb.addEventListener('change', ()=>{
      const id = cb.dataset.id;
      const existing = activeSources.find(a=>a.id===id);
      if (existing) existing.enabled = cb.checked;
      else activeSources.push({ id, enabled: cb.checked });
      localStorage.setItem('signal_active_sources', JSON.stringify(activeSources));
    });
  });
  c.querySelectorAll('input[data-custom]').forEach(cb=>{
    cb.addEventListener('change', ()=>{
      const src = customSources.find(s=>s.id===cb.dataset.custom);
      if (src) { src.enabled=cb.checked; localStorage.setItem('signal_custom_sources',JSON.stringify(customSources)); }
    });
  });
  c.querySelectorAll('.delete-source-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      customSources = customSources.filter(s=>s.id!==btn.dataset.id);
      localStorage.setItem('signal_custom_sources',JSON.stringify(customSources));
      buildSourceList();
    });
  });
}

// ─── イベント ────────────────────────────────────────
function setupEventListeners() {
  document.getElementById('menuBtn').addEventListener('click', toggleSidebar);
  document.getElementById('sidebarClose').addEventListener('click', toggleSidebar);

  document.getElementById('viewGrid').addEventListener('click', ()=>{
    isListView=false;
    document.getElementById('viewGrid').classList.add('active');
    document.getElementById('viewList').classList.remove('active');
    filterAndRender();
  });
  document.getElementById('viewList').addEventListener('click', ()=>{
    isListView=true;
    document.getElementById('viewList').classList.add('active');
    document.getElementById('viewGrid').classList.remove('active');
    filterAndRender();
  });

  let timer;
  document.getElementById('searchInput').addEventListener('input', e=>{
    clearTimeout(timer);
    timer=setTimeout(()=>{ searchQuery=e.target.value; filterAndRender(); },300);
  });

  document.getElementById('openSettings').addEventListener('click', ()=>{
    buildSourceList();
    document.getElementById('settingsModal').classList.add('active');
    document.getElementById('modalBackdrop').classList.add('active');
  });
  const closeSettings=()=>['settingsModal','modalBackdrop'].forEach(id=>document.getElementById(id).classList.remove('active'));
  document.getElementById('closeSettings').addEventListener('click', closeSettings);
  document.getElementById('modalBackdrop').addEventListener('click', closeSettings);

  document.getElementById('addFeedBtn').addEventListener('click', ()=>{
    const name=document.getElementById('newFeedName').value.trim();
    const url=document.getElementById('newFeedUrl').value.trim();
    const cat=document.getElementById('newFeedCategory').value;
    if(!name||!url){alert('名前とURLを入力してください');return;}
    if(!url.startsWith('http')){alert('有効なURLを入力してください');return;}
    customSources.push({id:'c'+Date.now(),name,url,category:cat,enabled:true});
    localStorage.setItem('signal_custom_sources',JSON.stringify(customSources));
    buildSourceList();
    document.getElementById('newFeedName').value='';
    document.getElementById('newFeedUrl').value='';
  });

  document.getElementById('closeArticle').addEventListener('click', closeArticle);
  document.getElementById('articleBackdrop').addEventListener('click', closeArticle);

  document.getElementById('refreshBtn').addEventListener('click', ()=>{
    ['settingsModal','modalBackdrop'].forEach(id=>document.getElementById(id).classList.remove('active'));
    loadNews();
  });

  document.addEventListener('keydown', e=>{ if(e.key==='Escape'){closeArticle();} });
}

function toggleSidebar() {
  const sb=document.getElementById('sidebar');
  if(window.innerWidth<=768) sb.classList.toggle('mobile-open');
  else { sb.classList.toggle('hidden'); document.querySelector('.main').classList.toggle('expanded'); }
}

function updateLastUpdated() {
  document.getElementById('lastUpdated').textContent = '更新: ' + new Date().toLocaleTimeString('ja-JP');
}

// ─── スタイル追加 ────────────────────────────────────
document.head.insertAdjacentHTML('beforeend',`<style>
  .card-in{animation:fadeUp .35s ease both}
  @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
  .source-badge.api{background:rgba(100,200,255,.12);color:#60c8ff}
  .no-custom{color:var(--muted);font-size:12px;padding:8px 0}
</style>`);
