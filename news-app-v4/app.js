/* ═══════════════════════════════════════════════════════
   SIGNAL v4 — パーソナルニュースアグリゲーター
   外部サービス登録不要。GitHubのみ。
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

// 設定画面の表示用ソース一覧（登録不要なものだけ）
const SOURCE_INFO = {
  tv: [
    { name: 'ANN テレ朝ニュース',      url: 'https://news.tv-asahi.co.jp',    category: 'society'   },
    { name: 'TBS NEWS DIG',           url: 'https://newsdig.tbs.co.jp',       category: 'society'   },
    { name: 'FNN プライムオンライン',  url: 'https://www.fnn.jp',             category: 'society'   },
    { name: '日テレ NEWS',            url: 'https://news.ntv.co.jp',          category: 'society'   },
    { name: 'テレ東BIZ',              url: 'https://txbiz.tv-tokyo.co.jp',    category: 'business'  },
    { name: 'MBS NEWS（毎日放送）',    url: 'https://www.mbs.jp/news',        category: 'society'   },
  ],
  rss: [
    { name: 'NHK ニュース / 社会 / 政治 / 経済 / 国際', category: '各カテゴリ' },
    { name: '朝日新聞 / 毎日新聞 / 読売新聞',           category: '社会'       },
    { name: 'TechCrunch / Ars Technica / WIRED Japan',  category: 'テクノロジー' },
    { name: 'GIGAZINE / Engadget Japan / Gizmodo Japan',category: 'テクノロジー' },
    { name: '東洋経済オンライン / ダイヤモンド / Reuters', category: 'ビジネス'  },
    { name: 'ファミ通 / 電撃 / ORICON / ナタリー / IGN', category: 'エンタメ'   },
    { name: 'BBC World / Reuters Politics',              category: '政治'       },
  ],
  api: [
    { name: 'Hacker News Firebase API', note: '登録不要・無料・無制限' },
  ],
};

// ─── STATE ───────────────────────────────────────────
let allArticles      = [];
let filteredArticles = [];
let activeCategory   = 'all';
let searchQuery      = '';
let isListView       = false;
let customSources    = [];
let lastMeta         = null;

// ─── INIT ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  customSources = JSON.parse(localStorage.getItem('signal_custom_sources') || '[]');
  buildCategoryNav();
  setupEventListeners();
  loadNews();
});

// ─── NEWS LOAD ───────────────────────────────────────
async function loadNews() {
  showLoading();
  const [cached, meta, customArts] = await Promise.all([
    fetchCachedNews(),
    fetchMeta(),
    fetchCustomRSS(),
  ]);
  lastMeta = meta;
  allArticles = dedupSort([...cached, ...customArts]);
  buildCategoryNav();
  buildTicker();
  filterAndRender();
  updateLastUpdated(meta);
}

async function fetchCachedNews() {
  try {
    const res = await fetch('./data/news.json?t=' + Date.now());
    if (!res.ok) return [];
    const data = await res.json();
    if (Array.isArray(data.all) && data.all.length) return data.all;
    // all がなければ全カテゴリをフラット化
    return Object.values(data).flat().filter(a => a && a.title);
  } catch(e) {
    console.warn('[SIGNAL] キャッシュ読込失敗:', e.message);
    return [];
  }
}

async function fetchMeta() {
  try {
    const res = await fetch('./data/meta.json?t=' + Date.now());
    return res.ok ? res.json() : null;
  } catch { return null; }
}

// カスタムRSS: AllOrigins (登録不要・無料プロキシ) でCORSを回避
async function fetchCustomRSS() {
  const enabled = customSources.filter(s => s.enabled);
  if (!enabled.length) return [];
  const results = await Promise.allSettled(enabled.map(fetchOneCustomRSS));
  return results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
}

async function fetchOneCustomRSS(src) {
  const proxy = 'https://api.allorigins.win/get?url=' + encodeURIComponent(src.url);
  const res = await fetch(proxy, { signal: AbortSignal.timeout(9000) });
  const data = await res.json();
  if (!data.contents) return [];
  return parseRSSBrowser(data.contents, src.name, src.category);
}

function parseRSSBrowser(xml, sourceName, category) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  return [...doc.querySelectorAll('item, entry')].slice(0, 15).map(item => {
    const g = sel => item.querySelector(sel)?.textContent?.trim() || '';
    const ga = (sel, attr) => item.querySelector(sel)?.getAttribute(attr) || '';
    const title = g('title');
    const link  = g('link') || ga('link', 'href');
    if (!title || !link) return null;
    return {
      id: link, title,
      description: (g('description') || g('summary') || '').replace(/<[^>]*>/g,'').trim().slice(0,200),
      url: link,
      image: ga('enclosure','url') || ga('media:thumbnail','url') || '',
      date: (() => { try { return new Date(g('pubDate')||g('published')||g('updated')||'').toISOString(); } catch { return new Date().toISOString(); } })(),
      source: sourceName, category,
    };
  }).filter(Boolean);
}

function dedupSort(arts, limit = 200) {
  const seen = new Set();
  return arts.filter(a => {
    if (!a?.title) return false;
    const k = a.title.replace(/\s+/g,'').slice(0,40);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, limit);
}

// ─── カテゴリ NAV ────────────────────────────────────
function buildCategoryNav() {
  const list = document.getElementById('categoryList');
  list.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const count = cat.id === 'all'
      ? allArticles.length
      : allArticles.filter(a => a.category === cat.id).length;
    const li = document.createElement('li');
    li.innerHTML = `<a class="${activeCategory === cat.id ? 'active' : ''}" data-cat="${cat.id}">
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
  document.getElementById('topbarTitle').textContent = id === 'all' ? 'すべてのニュース' : label;
  buildCategoryNav();
  filterAndRender();
  if (window.innerWidth <= 768) toggleSidebar();
}

// ─── TICKER ──────────────────────────────────────────
function buildTicker() {
  const track = document.getElementById('tickerTrack');
  const top = allArticles.slice(0, 12);
  const items = top.map(a => `<span class="ticker-item">${escHtml(a.title)}</span>`).join('');
  track.innerHTML = items + items;
}

// ─── RENDER ──────────────────────────────────────────
function filterAndRender() {
  const q = searchQuery.toLowerCase();
  filteredArticles = allArticles.filter(a => {
    const catOk = activeCategory === 'all' || a.category === activeCategory;
    const searchOk = !q || a.title.toLowerCase().includes(q) || (a.description||'').toLowerCase().includes(q);
    return catOk && searchOk;
  });
  renderFeed();
}

function renderFeed() {
  const feed = document.getElementById('feed');
  feed.className = 'feed' + (isListView ? ' list-view' : '');
  if (!filteredArticles.length) {
    feed.innerHTML = `<div class="empty-state"><h3>記事が見つかりません</h3><p>リロードするか別のカテゴリをお試しください。</p></div>`;
    return;
  }
  feed.innerHTML = filteredArticles.map(cardHTML).join('');
  feed.querySelectorAll('.card').forEach((el, i) => {
    el.style.animationDelay = (i * 0.03) + 's';
    el.classList.add('card-in');
    el.addEventListener('click', () => openArticle(filteredArticles[i]));
  });
}

const TV_NAMES = new Set(SOURCE_INFO.tv.map(s => s.name));

function cardHTML(a) {
  const catLabel = CATEGORIES.find(c => c.id === a.category)?.label || a.category;
  const img = a.image ? `<img class="card-img" src="${escHtml(a.image)}" alt="" loading="lazy" onerror="this.style.display='none'"/>` : '';
  const tvBadge = TV_NAMES.has(a.source) ? `<span class="tv-badge">📺</span>` : '';
  return `<article class="card">
    ${img}
    <div class="card-body">
      <div class="card-category">${escHtml(catLabel)}${tvBadge}</div>
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
  document.getElementById('feed').innerHTML = `<div class="loading-state"><div class="spinner"></div><p>ニュースを読み込み中…</p></div>`;
}

// ─── 記事モーダル ────────────────────────────────────
function openArticle(a) {
  const catLabel = CATEGORIES.find(c => c.id === a.category)?.label || a.category;
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
  ['articleModal','articleBackdrop'].forEach(id => document.getElementById(id).classList.remove('active'));
}

// ─── 設定モーダル ────────────────────────────────────
function buildSourceList() {
  const c = document.getElementById('sourceCategories');

  const tvRows = SOURCE_INFO.tv.map(s => `
    <div class="source-item">
      <span class="source-badge scrape">📺 スクレイピング</span>
      <label>${escHtml(s.name)}</label>
      <a class="source-link" href="${escHtml(s.url)}" target="_blank" rel="noopener">↗</a>
    </div>`).join('');

  const rssRows = SOURCE_INFO.rss.map(s => `
    <div class="source-item">
      <span class="source-badge rss">RSS</span>
      <label>${escHtml(s.name)}</label>
      <small class="source-cat">${escHtml(s.category)}</small>
    </div>`).join('');

  const apiRows = SOURCE_INFO.api.map(s => `
    <div class="source-item">
      <span class="source-badge api">API</span>
      <label>${escHtml(s.name)}</label>
      <small class="source-cat">${escHtml(s.note)}</small>
    </div>`).join('');

  const customRows = customSources.length
    ? customSources.map(s => `
      <div class="source-item" data-id="${s.id}">
        <input type="checkbox" id="cs-${s.id}" ${s.enabled?'checked':''}/>
        <label for="cs-${s.id}">${escHtml(s.name)}</label>
        <span class="source-badge custom">カスタム</span>
        <button class="delete-source-btn" data-id="${s.id}">✕</button>
      </div>`).join('')
    : `<p class="no-custom">まだカスタムソースはありません</p>`;

  c.innerHTML = `
    <div class="source-group">
      <div class="source-group-title">📺 テレビ局（自動スクレイピング・登録不要）</div>${tvRows}
    </div>
    <div class="source-group">
      <div class="source-group-title">📡 RSSフィード（登録不要）</div>${rssRows}
    </div>
    <div class="source-group">
      <div class="source-group-title">🔌 公開API（登録不要）</div>${apiRows}
    </div>
    <div class="source-group">
      <div class="source-group-title">✦ カスタムRSS（任意追加）</div>${customRows}
    </div>`;

  c.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const src = customSources.find(s => s.id === cb.closest('.source-item').dataset.id);
      if (src) { src.enabled = cb.checked; saveCustom(); }
    });
  });
  c.querySelectorAll('.delete-source-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      customSources = customSources.filter(s => s.id !== btn.dataset.id);
      saveCustom(); buildSourceList();
    });
  });
}

function saveCustom() { localStorage.setItem('signal_custom_sources', JSON.stringify(customSources)); }

// ─── イベント ────────────────────────────────────────
function setupEventListeners() {
  document.getElementById('menuBtn').addEventListener('click', toggleSidebar);
  document.getElementById('sidebarClose').addEventListener('click', toggleSidebar);

  document.getElementById('viewGrid').addEventListener('click', () => {
    isListView = false;
    document.getElementById('viewGrid').classList.add('active');
    document.getElementById('viewList').classList.remove('active');
    filterAndRender();
  });
  document.getElementById('viewList').addEventListener('click', () => {
    isListView = true;
    document.getElementById('viewList').classList.add('active');
    document.getElementById('viewGrid').classList.remove('active');
    filterAndRender();
  });

  let timer;
  document.getElementById('searchInput').addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { searchQuery = e.target.value; filterAndRender(); }, 300);
  });

  document.getElementById('openSettings').addEventListener('click', () => {
    buildSourceList();
    document.getElementById('settingsModal').classList.add('active');
    document.getElementById('modalBackdrop').classList.add('active');
  });
  const closeSettings = () => {
    ['settingsModal','modalBackdrop'].forEach(id => document.getElementById(id).classList.remove('active'));
  };
  document.getElementById('closeSettings').addEventListener('click', closeSettings);
  document.getElementById('modalBackdrop').addEventListener('click', closeSettings);

  document.getElementById('addFeedBtn').addEventListener('click', () => {
    const name = document.getElementById('newFeedName').value.trim();
    const url  = document.getElementById('newFeedUrl').value.trim();
    const cat  = document.getElementById('newFeedCategory').value;
    if (!name || !url) { alert('名前とURLを入力してください'); return; }
    if (!url.startsWith('http')) { alert('有効なURLを入力してください'); return; }
    customSources.push({ id: 'c' + Date.now(), name, url, category: cat, enabled: true });
    saveCustom();
    buildSourceList();
    document.getElementById('newFeedName').value = '';
    document.getElementById('newFeedUrl').value = '';
  });

  document.getElementById('closeArticle').addEventListener('click', closeArticle);
  document.getElementById('articleBackdrop').addEventListener('click', closeArticle);

  document.getElementById('refreshBtn').addEventListener('click', () => {
    ['settingsModal','modalBackdrop'].forEach(id => document.getElementById(id).classList.remove('active'));
    loadNews();
  });

  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeArticle(); closeSettings(); } });
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  if (window.innerWidth <= 768) sb.classList.toggle('mobile-open');
  else { sb.classList.toggle('hidden'); document.querySelector('.main').classList.toggle('expanded'); }
}

// ─── ユーティリティ ──────────────────────────────────
function relativeTime(dateStr) {
  const m = Math.floor((Date.now() - new Date(dateStr)) / 60000);
  if (m < 1)  return 'たった今';
  if (m < 60) return m + '分前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + '時間前';
  return Math.floor(h / 24) + '日前';
}
function escHtml(s = '') {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function updateLastUpdated(meta) {
  const el = document.getElementById('lastUpdated');
  el.textContent = meta?.updatedAt
    ? '収集: ' + new Date(meta.updatedAt).toLocaleString('ja-JP', { timeZone:'Asia/Tokyo' })
    : '更新: ' + new Date().toLocaleTimeString('ja-JP');
}

// ─── スタイル追加 ────────────────────────────────────
document.head.insertAdjacentHTML('beforeend', `<style>
  .card-in { animation: fadeUp .35s ease both; }
  @keyframes fadeUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
  .tv-badge { font-size:11px; margin-left:5px; }
  .source-link { color:var(--muted); text-decoration:none; font-size:13px; margin-left:auto; padding-left:8px; }
  .source-link:hover { color:var(--accent); }
  .source-cat { color:var(--muted); font-size:11px; margin-left:auto; }
  .source-badge.scrape { background:rgba(255,120,60,.12); color:#ff8060; }
  .source-badge.api    { background:rgba(100,200,255,.12); color:#60c8ff; }
  .no-custom { color:var(--muted); font-size:12px; padding:8px 0; }
</style>`);
