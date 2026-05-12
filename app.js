/* SIGNAL app.js — 最終版 */

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
let newsData = {};

// HTMLを完全除去（サーバー側と同じロジック）
function stripHTML(html = '') {
  return String(html)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
    .replace(/&[a-z#0-9]+;/gi,' ')
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
  document.querySelector('.logo').addEventListener('click', () => {
    setCategory('all', 'すべてのニュース');
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

    // 全記事のtitle/descriptionからHTMLを除去
    Object.keys(newsData).forEach(cat => {
      if (!Array.isArray(newsData[cat])) return;
      newsData[cat] = newsData[cat].map(a => ({
        ...a,
        title:       stripHTML(a.title || ''),
        description: stripHTML(a.description || ''),
        source:      stripHTML(a.source || ''),
      })).filter(a => a.title.length > 3);
    });

    allArticles = newsData.all || [];
    if (!allArticles.length) {
      const seen = new Set();
      allArticles = Object.values(newsData).flat().filter(a => {
        if (!a?.title) return false;
        const k = a.title.slice(0,40);
        if (seen.has(k)) return false;
        seen.add(k); return true;
      }).sort((a,b) => new Date(b.date)-new Date(a.date));
    }

    buildCategoryNav();
    buildTicker();
    if (activeCategory === 'all' && !searchQuery) renderTopPage();
    else filterAndRender();

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
        <small style="font-family:var(--ff-mono);color:var(--ink3);font-size:11px">${escHtml(e.message)}</small><br>
        <button onclick="loadNews()" style="margin-top:16px;padding:9px 20px;background:var(--ink);color:var(--paper);border:none;border-radius:4px;cursor:pointer;font-family:var(--ff-body)">再読み込み</button>
      </div>`;
  }
}

// ─── トップページ ─────────────────────────────────────
function renderTopPage() {
  const feed = document.getElementById('feed');
  feed.className = 'feed top-page';

  const cats = CATEGORIES.filter(c => c.id !== 'all');
  let html = '';

  // 最新ニュース（上位3件）
  const top3 = allArticles.slice(0, 3);
  if (top3.length) {
    html += `<div class="top-section">
      <div class="section-hd">
        <span class="section-label">最新ニュース</span>
        <button class="section-more" onclick="setCategory('all','すべてのニュース')">すべて見る →</button>
      </div>
      ${top3.map((a,i) => heroCard(a,i)).join('')}
    </div>`;
  }

  // カテゴリ別
  cats.forEach(cat => {
    const arts = (newsData[cat.id] || []).slice(0, 5);
    if (!arts.length) return;
    const color = CAT_COLORS[cat.id] || '#333';
    html += `<div class="cat-section">
      <div class="section-hd">
        <span class="section-label" style="color:${color}">${cat.icon} ${cat.label}</span>
        <button class="section-more" onclick="setCategory('${cat.id}','${cat.label}')">もっと見る →</button>
      </div>
      ${arts.map(a => compactCard(a, color)).join('')}
    </div>`;
  });

  feed.innerHTML = html;
  feed.querySelectorAll('[data-id]').forEach(el => {
    el.addEventListener('click', () => {
      const art = allArticles.find(a=>a.id===el.dataset.id)
        || Object.values(newsData).flat().find(a=>a.id===el.dataset.id);
      if (art) openArticle(art);
    });
  });
  feed.querySelectorAll('[data-id]').forEach((el,i) => {
    el.style.animationDelay = (i*0.03)+'s';
    el.classList.add('card-in');
  });
}

function heroCard(a, idx) {
  const catLabel = CATEGORIES.find(c=>c.id===a.category)?.label || '';
  const color = CAT_COLORS[a.category] || '#333';
  const isFirst = idx === 0;
  return `<div class="hero-card${isFirst?' hero-first':''}" data-id="${escHtml(a.id)}">
    <div class="hero-cat" style="color:${color}">
      <span class="cat-dash"></span>${escHtml(catLabel)}
    </div>
    <div class="hero-title">${escHtml(a.title)}</div>
    <div class="hero-meta">${escHtml(a.source)}<span class="hero-dot">·</span>${relTime(a.date)}</div>
  </div>`;
}

function compactCard(a, color) {
  return `<div class="compact-card" data-id="${escHtml(a.id)}">
    <span class="compact-dot" style="background:${color}"></span>
    <div class="compact-inner">
      <div class="compact-title">${escHtml(a.title)}</div>
      <div class="compact-meta">${escHtml(a.source)}<span class="hero-dot">·</span>${relTime(a.date)}</div>
    </div>
  </div>`;
}

// ─── 通常フィード ─────────────────────────────────────
function filterAndRender() {
  const q = searchQuery.toLowerCase();
  filteredArticles = allArticles.filter(a => {
    const catOk = activeCategory==='all' || a.category===activeCategory;
    const srchOk = !q || a.title.toLowerCase().includes(q) || (a.description||'').toLowerCase().includes(q);
    return catOk && srchOk;
  });
  renderFeed();
}

function renderFeed() {
  const feed = document.getElementById('feed');
  feed.className = 'feed list-feed';
  if (!filteredArticles.length) {
    feed.innerHTML = `<div class="empty-state"><h3>記事が見つかりません</h3></div>`;
    return;
  }
  feed.innerHTML = filteredArticles.map(cardHTML).join('');
  feed.querySelectorAll('.std-card').forEach((el,i) => {
    el.style.animationDelay = (i*0.025)+'s';
    el.classList.add('card-in');
    el.addEventListener('click', () => openArticle(filteredArticles[i]));
  });
}

function cardHTML(a) {
  const catLabel = CATEGORIES.find(c=>c.id===a.category)?.label || a.category;
  const color = CAT_COLORS[a.category] || '#333';
  return `<article class="std-card">
    <div class="std-body">
      <div class="std-cat" style="color:${color}">
        <span class="cat-dash"></span>${escHtml(catLabel)}
      </div>
      <div class="std-title">${escHtml(a.title)}</div>
      ${a.description ? `<div class="std-desc">${escHtml(a.description)}</div>` : ''}
    </div>
    <div class="std-foot">
      <span class="std-source">${escHtml(a.source)}</span>
      <span class="std-time">${relTime(a.date)}</span>
    </div>
  </article>`;
}

function showLoading() {
  document.getElementById('feed').innerHTML = `
    <div class="loading-state"><div class="spinner"></div><p>読み込み中…</p></div>`;
}

// ─── 記事モーダル ─────────────────────────────────────
function openArticle(a) {
  const catLabel = CATEGORIES.find(c=>c.id===a.category)?.label || a.category;
  const color = CAT_COLORS[a.category] || '#333';
  document.getElementById('articleMetaTop').textContent = a.source + ' · ' + relTime(a.date);
  document.getElementById('articleBody').innerHTML = `
    <div class="art-cat" style="color:${color}"><span class="cat-dash"></span>${escHtml(catLabel)}</div>
    <h1>${escHtml(a.title)}</h1>
    <div class="art-meta">
      <span>${escHtml(a.source)}</span><span>·</span>
      <span>${new Date(a.date).toLocaleString('ja-JP')}</span>
    </div>
    ${a.description ? `<p class="art-body">${escHtml(a.description)}</p>` : ''}
    <a class="art-link" href="${escHtml(a.url)}" target="_blank" rel="noopener">元記事を読む →</a>`;
  document.getElementById('articleModal').classList.add('active');
  document.getElementById('articleBackdrop').classList.add('active');
}
function closeArticle() {
  ['articleModal','articleBackdrop'].forEach(id=>document.getElementById(id).classList.remove('active'));
}

// ─── カテゴリナビ ─────────────────────────────────────
function buildCategoryNav() {
  const list = document.getElementById('categoryList');
  list.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const count = cat.id==='all' ? allArticles.length : (newsData[cat.id]||[]).length;
    const li = document.createElement('li');
    li.innerHTML = `<a class="${activeCategory===cat.id?'active':''}" data-cat="${cat.id}">
      <span class="cat-icon">${cat.icon}</span>
      <span>${cat.label}</span>
      ${count>0?`<span class="cat-count">${count}</span>`:''}
    </a>`;
    li.querySelector('a').addEventListener('click',()=>setCategory(cat.id, cat.label));
    list.appendChild(li);
  });
}

function setCategory(id, label) {
  activeCategory = id;
  document.getElementById('topbarTitle').textContent = id==='all' ? 'すべてのニュース' : label;
  buildCategoryNav();
  buildTicker();
  if (id==='all' && !searchQuery) renderTopPage();
  else filterAndRender();
  window.scrollTo({ top:0, behavior:'smooth' });
  if (window.innerWidth<=768) toggleSidebar();
}

// ─── ティッカー ───────────────────────────────────────
function buildTicker() {
  const track = document.getElementById('tickerTrack');
  const src = activeCategory==='all' ? allArticles : (newsData[activeCategory]||allArticles);
  const items = src.slice(0,12).map(a=>`<span class="ticker-item">${escHtml(a.title)}</span>`).join('');
  track.innerHTML = items + items;
}

// ─── 設定モーダル ─────────────────────────────────────
function openSettings() {
  document.getElementById('sourceCategories').innerHTML = `
    <div class="source-group">
      <div class="source-group-title">収集の仕組み</div>
      <div style="padding:12px;background:#fff;border:1px solid var(--paper3);border-radius:4px;font-size:12.5px;color:var(--ink2);line-height:1.8">
        GitHub Actionsが15分ごとに<strong>Google News RSS（日本語）</strong>と
        国内メディアのRSSを収集し、<code style="font-family:var(--ff-mono);font-size:11px;background:var(--paper2);padding:1px 5px;border-radius:3px">data/news.json</code>
        に保存します。英語のみの記事は自動除外されます。
      </div>
    </div>
    <div class="source-group">
      <div class="source-group-title">収集ソース（日本語）</div>
      ${[
        ['Google News RSS', '社会・政治・経済・テクノロジー・エンタメ（日本語フィルタ済）'],
        ['GIGAZINE', 'テクノロジー'],
        ['ファミ通 / 電撃 / IGN Japan', 'エンタメ・ゲーム'],
        ['ORICON NEWS / ナタリー', 'エンタメ'],
        ['Hacker News', 'テクノロジー（英語）'],
      ].map(([n,c])=>`<div class="source-item">
        <span class="source-badge rss">RSS</span>
        <label>${n}</label>
        <small style="color:var(--ink3);font-size:10.5px;margin-left:auto">${c}</small>
      </div>`).join('')}
    </div>
    <div class="source-group">
      <div class="source-group-title">手動実行</div>
      <a href="https://github.com/neg42/signal/actions" target="_blank" rel="noopener"
         style="display:inline-flex;align-items:center;gap:6px;background:var(--ink);color:var(--paper);padding:9px 16px;border-radius:4px;font-size:13px;text-decoration:none">
        GitHub Actions を開く →
      </a>
    </div>`;
  document.getElementById('settingsModal').classList.add('active');
  document.getElementById('modalBackdrop').classList.add('active');
}
function closeSettings() {
  ['settingsModal','modalBackdrop'].forEach(id=>document.getElementById(id).classList.remove('active'));
}

// ─── イベント ─────────────────────────────────────────
function setupEvents() {
  document.getElementById('menuBtn').addEventListener('click',toggleSidebar);
  document.getElementById('sidebarClose').addEventListener('click',toggleSidebar);
  document.getElementById('viewGrid').addEventListener('click',()=>{
    isListView=false;
    document.getElementById('viewGrid').classList.add('active');
    document.getElementById('viewList').classList.remove('active');
    if(activeCategory==='all'&&!searchQuery) renderTopPage(); else filterAndRender();
  });
  document.getElementById('viewList').addEventListener('click',()=>{
    isListView=true;
    document.getElementById('viewList').classList.add('active');
    document.getElementById('viewGrid').classList.remove('active');
    filterAndRender();
  });
  let srchTimer;
  document.getElementById('searchInput').addEventListener('input',e=>{
    clearTimeout(srchTimer);
    srchTimer=setTimeout(()=>{
      searchQuery=e.target.value;
      if(searchQuery) filterAndRender();
      else if(activeCategory==='all') renderTopPage();
      else filterAndRender();
    },300);
  });
  document.getElementById('openSettings').addEventListener('click',openSettings);
  document.getElementById('closeSettings').addEventListener('click',closeSettings);
  document.getElementById('modalBackdrop').addEventListener('click',closeSettings);
  document.getElementById('closeArticle').addEventListener('click',closeArticle);
  document.getElementById('articleBackdrop').addEventListener('click',closeArticle);
  document.getElementById('refreshBtn').addEventListener('click',()=>{closeSettings();loadNews();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeArticle();closeSettings();}});
}

function toggleSidebar() {
  const sb=document.getElementById('sidebar');
  if(window.innerWidth<=768) sb.classList.toggle('mobile-open');
  else{sb.classList.toggle('hidden');document.querySelector('.main').classList.toggle('expanded');}
}

// ─── インラインスタイル ───────────────────────────────
document.head.insertAdjacentHTML('beforeend',`<style>
.card-in{animation:fadeUp .3s ease both}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

/* ダッシュ */
.cat-dash{display:inline-block;width:14px;height:2px;background:currentColor;border-radius:1px;margin-right:6px;vertical-align:middle}

/* ─── トップページ ─── */
.feed.top-page{display:block;background:var(--paper)}

.top-section{border-bottom:2px solid var(--ink);padding:20px 20px 24px}
.cat-section{border-bottom:1px solid var(--paper3);padding:18px 20px 20px}

.section-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.section-label{font-family:var(--ff-mono);font-size:9.5px;font-weight:500;letter-spacing:0.18em;text-transform:uppercase;color:var(--ink3)}
.section-more{background:none;border:none;font-family:var(--ff-mono);font-size:10px;color:var(--red);cursor:pointer;letter-spacing:0.06em}
.section-more:hover{opacity:0.7}

/* ヒーローカード */
.hero-card{padding:14px 0;border-bottom:1px solid var(--paper3);cursor:pointer;transition:background .15s}
.hero-card:last-child{border-bottom:none}
.hero-card:hover{background:rgba(0,0,0,0.02)}
.hero-first .hero-title{font-size:18px;line-height:1.35}
.hero-cat{font-family:var(--ff-mono);font-size:9px;font-weight:500;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:7px;display:flex;align-items:center}
.hero-title{font-family:var(--ff-head);font-size:14.5px;font-weight:700;line-height:1.4;color:var(--ink);margin-bottom:8px;letter-spacing:-0.01em}
.hero-meta{font-family:var(--ff-mono);font-size:10px;color:var(--ink3)}
.hero-dot{margin:0 5px;opacity:0.4}

/* コンパクトカード */
.compact-card{display:flex;gap:10px;align-items:flex-start;padding:11px 0;border-bottom:1px solid var(--paper3);cursor:pointer;transition:background .15s}
.compact-card:last-child{border-bottom:none}
.compact-card:hover{background:rgba(0,0,0,0.02)}
.compact-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;margin-top:6px}
.compact-inner{flex:1;min-width:0}
.compact-title{font-family:var(--ff-head);font-size:13px;font-weight:700;line-height:1.4;color:var(--ink);letter-spacing:-0.01em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.compact-meta{font-family:var(--ff-mono);font-size:10px;color:var(--ink3);margin-top:4px}

/* ─── 通常フィード（カテゴリ選択時）─── */
.feed.list-feed{display:block;background:var(--paper)}

.std-card{border-bottom:1px solid var(--paper3);padding:16px 20px;cursor:pointer;transition:background .15s;position:relative}
.std-card:hover{background:rgba(0,0,0,0.02)}
.std-cat{font-family:var(--ff-mono);font-size:9px;font-weight:500;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:7px;display:flex;align-items:center}
.std-title{font-family:var(--ff-head);font-size:16px;font-weight:700;line-height:1.38;color:var(--ink);margin-bottom:6px;letter-spacing:-0.01em}
.std-desc{font-size:12.5px;color:var(--ink3);line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.std-foot{display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-family:var(--ff-mono);font-size:10.5px;color:var(--ink3)}
.std-source{color:var(--ink2);font-weight:500}

/* 記事モーダル */
.art-cat{font-family:var(--ff-mono);font-size:9px;font-weight:500;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:12px;display:flex;align-items:center}
#articleBody h1{font-family:var(--ff-head);font-size:20px;font-weight:700;line-height:1.3;margin-bottom:12px;color:var(--ink);letter-spacing:-0.02em}
.art-meta{display:flex;gap:8px;flex-wrap:wrap;font-size:10.5px;color:var(--ink3);margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--paper3);font-family:var(--ff-mono)}
.art-body{font-size:13.5px;line-height:1.85;color:var(--ink2);margin-bottom:22px}
.art-link{display:inline-flex;align-items:center;gap:8px;background:var(--ink);color:var(--paper);padding:10px 20px;border-radius:4px;font-family:var(--ff-body);font-size:13px;text-decoration:none;transition:opacity .2s}
.art-link:hover{opacity:0.8}
</style>`);
