/* ═══════════════════════════════════════════════════════
   SIGNAL app.js — 最終版
   ═══════════════════════════════════════════════════════ */

const CATEGORIES = [
  { id: 'all',           label: 'すべて',          icon: '◎' },
  { id: 'tech',          label: 'テクノロジー・AI', icon: '⚡' },
  { id: 'business',      label: 'ビジネス・経済',   icon: '📈' },
  { id: 'entertainment', label: 'エンタメ・ゲーム', icon: '🎮' },
  { id: 'politics',      label: '政治',            icon: '🏛' },
  { id: 'society',       label: '社会',            icon: '📰' },
];

const CAT_COLORS = {
  tech: '#1a3a5c', business: '#b8973a', entertainment: '#6b3a8c',
  politics: '#c0392b', society: '#2d6a4f', all: '#333',
};

let allArticles = [], filteredArticles = [];
let activeCategory = 'all', searchQuery = '', isListView = false;
let newsData = {}; // カテゴリ別データを保持

// ─── HTML除去（Google NewsのRSSに含まれるHTMLを完全除去）
function stripHTML(html = '') {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<a[^>]*href=["'][^"']*["'][^>]*>[\s\S]*?<\/a>/gi, '') // リンク除去
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
    .replace(/\s+/g,' ').trim();
}

function escHtml(s = '') {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function relTime(dateStr) {
  const m = Math.floor((Date.now() - new Date(dateStr)) / 60000);
  if (m < 1)  return 'たった今';
  if (m < 60) return m + '分前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + '時間前';
  return Math.floor(h / 24) + '日前';
}

// ─── INIT ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // ロゴクリックでトップ（すべて表示）
  document.querySelector('.logo').addEventListener('click', () => {
    setCategory('all', 'すべて');
    // モバイルではサイドバーを閉じる
    if (window.innerWidth <= 768) toggleSidebar();
    // トップにスクロール
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  setupEvents();
  buildCategoryNav();
  loadNews();
});

// ─── データ読み込み ───────────────────────────────────
async function loadNews() {
  showLoading();
  try {
    const res = await fetch('./data/news.json?v=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    newsData = await res.json();

    // descriptionのHTMLを除去して正規化
    Object.keys(newsData).forEach(cat => {
      if (!Array.isArray(newsData[cat])) return;
      newsData[cat] = newsData[cat].map(a => ({
        ...a,
        title: stripHTML(a.title || ''),
        description: stripHTML(a.description || ''),
      }));
    });

    allArticles = newsData.all || Object.values(newsData).flat().filter(a=>a?.title);

    // 重複除去
    const seen = new Set();
    allArticles = allArticles.filter(a => {
      const k = a.title.slice(0,40);
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });

    buildCategoryNav();
    buildTicker();

    // トップページ（all）の場合は最新ニュースセクションを表示
    if (activeCategory === 'all') {
      renderTopPage();
    } else {
      filterAndRender();
    }

    // メタ情報
    try {
      const mr = await fetch('./data/meta.json?v=' + Date.now(), { cache: 'no-store' });
      if (mr.ok) {
        const meta = await mr.json();
        const t = new Date(meta.updatedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
        document.getElementById('lastUpdated').textContent = `収集: ${t}`;
      }
    } catch {}

  } catch(e) {
    document.getElementById('feed').innerHTML = `
      <div class="empty-state">
        <h3>データを取得できません</h3>
        <p>Actions タブから手動実行してください。</p>
        <small style="font-family:var(--ff-mono);color:var(--ink3)">${e.message}</small>
        <button onclick="loadNews()" class="retry-btn">再読み込み</button>
      </div>`;
  }
}

// ─── トップページ：最新ニュースセクション ─────────────
function renderTopPage() {
  const feed = document.getElementById('feed');
  feed.className = 'feed top-page';

  const cats = CATEGORIES.filter(c => c.id !== 'all');
  let html = '';

  // ヒーロー記事（最新3件を大きく）
  const heroArts = allArticles.slice(0, 3);
  if (heroArts.length) {
    html += `<div class="hero-section">
      <div class="section-header">
        <span class="section-label">最新ニュース</span>
        <button class="section-more" onclick="setCategory('all','すべてのニュース')">すべて見る →</button>
      </div>
      <div class="hero-grid">
        ${heroArts.map((a, i) => heroCardHTML(a, i)).join('')}
      </div>
    </div>`;
  }

  // カテゴリ別セクション
  cats.forEach(cat => {
    const arts = (newsData[cat.id] || []).slice(0, 4);
    if (!arts.length) return;
    html += `<div class="category-section">
      <div class="section-header">
        <span class="section-label">${cat.icon} ${cat.label}</span>
        <button class="section-more" onclick="setCategory('${cat.id}','${cat.label}')">もっと見る →</button>
      </div>
      <div class="category-row">
        ${arts.map(a => compactCardHTML(a, cat.id)).join('')}
      </div>
    </div>`;
  });

  feed.innerHTML = html;

  // カードのクリックイベント
  feed.querySelectorAll('.card, .hero-card, .compact-card').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      const art = allArticles.find(a => a.id === id) ||
        Object.values(newsData).flat().find(a => a.id === id);
      if (art) openArticle(art);
    });
  });

  // アニメーション
  feed.querySelectorAll('.hero-card, .compact-card').forEach((el, i) => {
    el.style.animationDelay = (i * 0.04) + 's';
    el.classList.add('card-in');
  });
}

function heroCardHTML(a, idx) {
  const catLabel = CATEGORIES.find(c => c.id === a.category)?.label || '';
  const color = CAT_COLORS[a.category] || '#333';
  const isMain = idx === 0;
  return `<div class="hero-card ${isMain?'hero-main':''}" data-id="${escHtml(a.id)}">
    <div class="hero-cat" style="color:${color}">${escHtml(catLabel)}</div>
    <div class="hero-title">${escHtml(a.title)}</div>
    <div class="hero-meta">
      <span class="hero-source">${escHtml(a.source)}</span>
      <span class="hero-time">${relTime(a.date)}</span>
    </div>
  </div>`;
}

function compactCardHTML(a, catId) {
  const color = CAT_COLORS[catId] || '#333';
  return `<div class="compact-card" data-id="${escHtml(a.id)}">
    <div class="compact-dot" style="background:${color}"></div>
    <div class="compact-body">
      <div class="compact-title">${escHtml(a.title)}</div>
      <div class="compact-meta">${escHtml(a.source)} · ${relTime(a.date)}</div>
    </div>
  </div>`;
}

// ─── 通常フィード ─────────────────────────────────────
function filterAndRender() {
  const q = searchQuery.toLowerCase();
  filteredArticles = allArticles.filter(a => {
    const catOk = activeCategory === 'all' || a.category === activeCategory;
    const srchOk = !q || a.title.toLowerCase().includes(q) || (a.description||'').toLowerCase().includes(q);
    return catOk && srchOk;
  });
  renderFeed();
}

function renderFeed() {
  const feed = document.getElementById('feed');
  feed.className = 'feed' + (isListView ? ' list-view' : '');
  if (!filteredArticles.length) {
    feed.innerHTML = `<div class="empty-state"><h3>記事が見つかりません</h3></div>`;
    return;
  }
  feed.innerHTML = filteredArticles.map(cardHTML).join('');
  feed.querySelectorAll('.card').forEach((el, i) => {
    el.style.animationDelay = (i * 0.025) + 's';
    el.classList.add('card-in');
    el.addEventListener('click', () => openArticle(filteredArticles[i]));
  });
}

function cardHTML(a) {
  const catLabel = CATEGORIES.find(c => c.id === a.category)?.label || a.category;
  const color = CAT_COLORS[a.category] || '#333';
  return `<article class="card">
    <div class="card-body">
      <div class="card-category" style="color:${color}">${escHtml(catLabel)}</div>
      <div class="card-title">${escHtml(a.title)}</div>
      <div class="card-desc">${escHtml(a.description)}</div>
    </div>
    <div class="card-footer">
      <span class="card-source">${escHtml(a.source)}</span>
      <span class="card-time">${relTime(a.date)}</span>
    </div>
  </article>`;
}

function showLoading() {
  document.getElementById('feed').innerHTML = `
    <div class="loading-state"><div class="spinner"></div><p>読み込み中…</p></div>`;
}

// ─── カテゴリ ────────────────────────────────────────
function buildCategoryNav() {
  const list = document.getElementById('categoryList');
  list.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const count = cat.id === 'all' ? allArticles.length
      : (newsData[cat.id]||[]).length;
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
  document.getElementById('topbarTitle').textContent =
    id === 'all' ? 'すべてのニュース' : label;
  buildCategoryNav();
  buildTicker();
  if (id === 'all' && !searchQuery) {
    renderTopPage();
  } else {
    filterAndRender();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (window.innerWidth <= 768) toggleSidebar();
}

// ─── ティッカー ──────────────────────────────────────
function buildTicker() {
  const track = document.getElementById('tickerTrack');
  const items = allArticles.slice(0, 12)
    .map(a => `<span class="ticker-item">${escHtml(stripHTML(a.title))}</span>`).join('');
  track.innerHTML = items + items;
}

// ─── 記事モーダル ────────────────────────────────────
function openArticle(a) {
  const catLabel = CATEGORIES.find(c => c.id === a.category)?.label || a.category;
  const color = CAT_COLORS[a.category] || '#333';
  document.getElementById('articleMetaTop').textContent = a.source + ' · ' + relTime(a.date);
  document.getElementById('articleBody').innerHTML = `
    <div class="art-category" style="color:${color}">${escHtml(catLabel)}</div>
    <h1>${escHtml(stripHTML(a.title))}</h1>
    <div class="art-meta">
      <span>📰 ${escHtml(a.source)}</span>
      <span>🕐 ${new Date(a.date).toLocaleString('ja-JP')}</span>
    </div>
    <p class="art-body">${escHtml(stripHTML(a.description))}</p>
    <a class="art-link" href="${escHtml(a.url)}" target="_blank" rel="noopener">
      元記事を読む →
    </a>`;
  document.getElementById('articleModal').classList.add('active');
  document.getElementById('articleBackdrop').classList.add('active');
}
function closeArticle() {
  ['articleModal','articleBackdrop'].forEach(id =>
    document.getElementById(id).classList.remove('active'));
}

// ─── 設定モーダル ────────────────────────────────────
function openSettings() {
  document.getElementById('sourceCategories').innerHTML = `
    <div class="source-group">
      <div class="source-group-title">収集の仕組み</div>
      <div class="source-item" style="flex-direction:column;align-items:flex-start;gap:6px;padding:14px">
        <p style="font-size:12.5px;color:var(--ink2);line-height:1.8">
          GitHub Actions が15分ごとに <strong>Google News RSS</strong> と各メディアのRSSを収集し、
          <code style="font-family:var(--ff-mono);font-size:11px;background:var(--paper2);padding:1px 5px;border-radius:3px">data/news.json</code>
          に保存します。ページを開くとそのJSONを読み込みます。
        </p>
      </div>
    </div>
    <div class="source-group">
      <div class="source-group-title">収集ソース</div>
      <div style="padding:4px 0">
        ${[
          ['Google News JP', 'トップ・日本・各カテゴリ・キーワード検索'],
          ['Hacker News RSS', 'テクノロジー'],
          ['TechCrunch / Ars Technica / GIGAZINE', 'テクノロジー'],
          ['Reuters / BBC World', '政治・ビジネス'],
          ['IGN Japan', 'エンタメ・ゲーム'],
        ].map(([n,c]) => `<div class="source-item">
          <span class="source-badge rss">RSS</span>
          <label>${n}</label>
          <small style="color:var(--ink3);font-size:11px;margin-left:auto">${c}</small>
        </div>`).join('')}
      </div>
    </div>
    <div class="source-group">
      <div class="source-group-title">手動実行</div>
      <a href="https://github.com/neg42/signal/actions" target="_blank" rel="noopener"
         style="display:inline-flex;align-items:center;gap:6px;background:var(--ink);color:var(--paper);padding:10px 18px;border-radius:4px;font-size:13px;text-decoration:none">
        GitHub Actions を開く →
      </a>
    </div>`;
  document.getElementById('settingsModal').classList.add('active');
  document.getElementById('modalBackdrop').classList.add('active');
}
function closeSettings() {
  ['settingsModal','modalBackdrop'].forEach(id =>
    document.getElementById(id).classList.remove('active'));
}

// ─── イベント ────────────────────────────────────────
function setupEvents() {
  document.getElementById('menuBtn').addEventListener('click', toggleSidebar);
  document.getElementById('sidebarClose').addEventListener('click', toggleSidebar);

  document.getElementById('viewGrid').addEventListener('click', () => {
    isListView = false;
    document.getElementById('viewGrid').classList.add('active');
    document.getElementById('viewList').classList.remove('active');
    if (activeCategory !== 'all' || searchQuery) filterAndRender();
    else renderTopPage();
  });
  document.getElementById('viewList').addEventListener('click', () => {
    isListView = true;
    document.getElementById('viewList').classList.add('active');
    document.getElementById('viewGrid').classList.remove('active');
    filterAndRender();
  });

  let srchTimer;
  document.getElementById('searchInput').addEventListener('input', e => {
    clearTimeout(srchTimer);
    srchTimer = setTimeout(() => {
      searchQuery = e.target.value;
      if (searchQuery) filterAndRender();
      else if (activeCategory === 'all') renderTopPage();
      else filterAndRender();
    }, 300);
  });

  document.getElementById('openSettings').addEventListener('click', openSettings);
  document.getElementById('closeSettings').addEventListener('click', closeSettings);
  document.getElementById('modalBackdrop').addEventListener('click', closeSettings);
  document.getElementById('closeArticle').addEventListener('click', closeArticle);
  document.getElementById('articleBackdrop').addEventListener('click', closeArticle);
  document.getElementById('refreshBtn').addEventListener('click', () => { closeSettings(); loadNews(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeArticle(); closeSettings(); } });
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  if (window.innerWidth <= 768) sb.classList.toggle('mobile-open');
  else {
    sb.classList.toggle('hidden');
    document.querySelector('.main').classList.toggle('expanded');
  }
}

// ─── スタイル追加 ────────────────────────────────────
document.head.insertAdjacentHTML('beforeend', `<style>
/* カードアニメーション */
.card-in { animation: fadeUp .3s ease both; }
@keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }

/* ロゴをクリック可能に */
.logo { cursor: pointer; user-select: none; }

/* トップページ */
.feed.top-page {
  display: block;
  padding: 0;
  background: var(--paper);
}

/* ヒーローセクション */
.hero-section {
  border-bottom: 2px solid var(--ink);
  padding: 24px 32px 28px;
  background: var(--paper);
}
.section-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px;
}
.section-label {
  font-family: var(--ff-mono);
  font-size: 10px; font-weight: 500;
  letter-spacing: 0.2em; text-transform: uppercase;
  color: var(--ink3);
}
.section-more {
  background: none; border: none;
  font-family: var(--ff-mono); font-size: 10px;
  color: var(--red); cursor: pointer;
  letter-spacing: 0.08em;
  transition: opacity .15s;
}
.section-more:hover { opacity: 0.7; }

.hero-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 1px;
  background: var(--paper3);
}
.hero-card {
  background: var(--paper);
  padding: 20px 22px;
  cursor: pointer;
  transition: background .15s;
  position: relative;
}
.hero-card:hover { background: #fff; }
.hero-card::after {
  content: '';
  position: absolute; top:0; left:0; right:0;
  height: 2px; background: var(--red);
  transform: scaleX(0); transform-origin: left;
  transition: transform .2s;
}
.hero-card:hover::after { transform: scaleX(1); }
.hero-main { grid-row: span 2; border-right: 1px solid var(--paper3); }
.hero-main .hero-title { font-size: 20px; line-height: 1.35; }
.hero-cat {
  font-family: var(--ff-mono); font-size: 9px; font-weight: 500;
  letter-spacing: 0.16em; text-transform: uppercase;
  margin-bottom: 8px;
  display: flex; align-items: center; gap: 6px;
}
.hero-cat::before {
  content:''; display:inline-block;
  width:14px; height:2px; background:currentColor; border-radius:1px;
}
.hero-title {
  font-family: var(--ff-head); font-size: 15px; font-weight: 700;
  line-height: 1.4; color: var(--ink); margin-bottom: 12px;
  letter-spacing: -0.01em;
}
.hero-meta {
  display: flex; gap: 12px; align-items: center;
  font-family: var(--ff-mono); font-size: 10px; color: var(--ink3);
}
.hero-source { font-weight: 500; color: var(--ink2); }

/* カテゴリセクション */
.category-section {
  padding: 20px 32px 24px;
  border-bottom: 1px solid var(--paper3);
}
.category-row {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 1px;
  background: var(--paper3);
}
.compact-card {
  display: flex; gap: 12px; align-items: flex-start;
  background: var(--paper); padding: 14px 16px;
  cursor: pointer; transition: background .15s;
}
.compact-card:hover { background: #fff; }
.compact-dot {
  width: 6px; height: 6px; border-radius: 50%;
  flex-shrink: 0; margin-top: 6px;
}
.compact-title {
  font-family: var(--ff-head); font-size: 13.5px; font-weight: 700;
  line-height: 1.4; color: var(--ink); margin-bottom: 5px;
  letter-spacing: -0.01em;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.compact-meta {
  font-family: var(--ff-mono); font-size: 10px; color: var(--ink3);
}

/* 通常カード（カテゴリ別表示時） */
.feed:not(.top-page) {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1px;
  background: var(--paper3);
  padding: 0;
  align-content: start;
}
.feed.list-view { grid-template-columns: 1fr; max-width: 720px; }

.card {
  background: var(--paper); cursor: pointer;
  transition: background .15s; position: relative;
  display: flex; flex-direction: column;
}
.card:hover { background: #fff; }
.card::after {
  content:''; position: absolute; top:0; left:0; right:0;
  height: 2px; background: var(--red);
  transform: scaleX(0); transform-origin: left;
  transition: transform .2s;
}
.card:hover::after { transform: scaleX(1); }

.card-body { padding: 18px 20px 12px; flex: 1; }
.card-category {
  font-family: var(--ff-mono); font-size: 9px; font-weight: 500;
  letter-spacing: 0.16em; text-transform: uppercase;
  margin-bottom: 8px;
  display: flex; align-items: center; gap: 6px;
}
.card-category::before {
  content:''; display:inline-block; width:14px; height:2px;
  background:currentColor; border-radius:1px;
}
.card-title {
  font-family: var(--ff-head); font-size: 15.5px; font-weight: 700;
  line-height: 1.38; color: var(--ink); margin-bottom: 8px;
  letter-spacing: -0.01em;
}
.card-desc {
  font-size: 12.5px; color: var(--ink3); line-height: 1.65;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.card-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 20px 14px;
  font-family: var(--ff-mono); font-size: 10.5px; color: var(--ink3);
}
.card-source { color: var(--ink2); font-weight: 500; }

/* リトライボタン */
.retry-btn {
  margin-top: 16px; padding: 10px 24px;
  background: var(--ink); color: var(--paper);
  border: none; border-radius: 4px;
  font-family: var(--ff-body); cursor: pointer;
}

/* レスポンシブ */
@media (max-width: 768px) {
  .hero-section, .category-section { padding: 16px; }
  .hero-grid { grid-template-columns: 1fr; }
  .hero-main { grid-row: span 1; border-right: none; }
  .category-row { grid-template-columns: 1fr; }
  .feed:not(.top-page) { grid-template-columns: 1fr; }
}
</style>`);
