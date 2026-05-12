/* ═══════════════════════════════════════════════════════
   SIGNAL app.js v6
   data/news.json（GitHub Actionsが生成）を読むだけ。
   CORSプロキシ不要・安定動作。
   ═══════════════════════════════════════════════════════ */

const CATEGORIES = [
  { id: 'all',           label: 'すべて',          icon: '◎' },
  { id: 'tech',          label: 'テクノロジー・AI', icon: '⚡' },
  { id: 'business',      label: 'ビジネス・経済',   icon: '📈' },
  { id: 'entertainment', label: 'エンタメ・ゲーム', icon: '🎮' },
  { id: 'politics',      label: '政治',            icon: '🏛' },
  { id: 'society',       label: '社会',            icon: '📰' },
  { id: 'custom',        label: 'カスタム',         icon: '✦' },
];

let allArticles = [], filteredArticles = [];
let activeCategory = 'all', searchQuery = '', isListView = false;

// ─── INIT ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  buildCategoryNav();
  setupEvents();
  loadNews();
});

// ─── data/news.json を読む ─────────────────────────────
async function loadNews() {
  showLoading('ニュースを読み込み中…');
  try {
    // キャッシュ回避のためタイムスタンプ付与
    const res = await fetch('./data/news.json?v=' + Date.now(), {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    // all があればそのまま、なければ全カテゴリをマージ
    if (Array.isArray(data.all) && data.all.length > 0) {
      allArticles = data.all;
    } else {
      const seen = new Set();
      allArticles = Object.values(data).flat().filter(a => {
        if (!a?.title) return false;
        const k = a.title.slice(0,40);
        if (seen.has(k)) return false;
        seen.add(k); return true;
      }).sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    buildCategoryNav();
    buildTicker();
    filterAndRender();

    // meta.json があれば更新時刻を表示
    try {
      const mr = await fetch('./data/meta.json?v=' + Date.now(), { cache: 'no-store' });
      if (mr.ok) {
        const meta = await mr.json();
        const t = new Date(meta.updatedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
        document.getElementById('lastUpdated').textContent = `収集: ${t}`;
        document.getElementById('lastUpdated').title =
          Object.entries(meta.counts || {}).map(([k,v])=>`${k}: ${v}件`).join('\n');
      }
    } catch {}

  } catch (e) {
    document.getElementById('feed').innerHTML = `
      <div class="empty-state">
        <h3>データを取得できません</h3>
        <p style="margin-bottom:16px">GitHub Actions がまだ実行されていない可能性があります。<br>Actions タブから手動実行してください。</p>
        <p style="font-size:11px;color:var(--ink3);font-family:var(--ff-mono)">${e.message}</p>
        <button onclick="loadNews()" style="margin-top:20px;padding:10px 24px;background:var(--ink);color:var(--paper);border:none;border-radius:4px;cursor:pointer;font-family:var(--ff-body)">再読み込み</button>
      </div>`;
  }
}

// ─── カテゴリ ────────────────────────────────────────
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
    li.querySelector('a').addEventListener('click', () => {
      activeCategory = cat.id;
      document.getElementById('topbarTitle').textContent =
        cat.id === 'all' ? 'すべてのニュース' : cat.label;
      buildCategoryNav();
      filterAndRender();
      if (window.innerWidth <= 768) toggleSidebar();
    });
    list.appendChild(li);
  });
}

// ─── ティッカー ──────────────────────────────────────
function buildTicker() {
  const track = document.getElementById('tickerTrack');
  const items = allArticles.slice(0, 12)
    .map(a => `<span class="ticker-item">${escHtml(a.title)}</span>`).join('');
  track.innerHTML = items + items;
}

// ─── フィルタ & 描画 ─────────────────────────────────
function filterAndRender() {
  const q = searchQuery.toLowerCase();
  filteredArticles = allArticles.filter(a => {
    const catOk = activeCategory === 'all' || a.category === activeCategory;
    const srchOk = !q || a.title.toLowerCase().includes(q) ||
                   (a.description || '').toLowerCase().includes(q);
    return catOk && srchOk;
  });
  renderFeed();
}

function renderFeed() {
  const feed = document.getElementById('feed');
  feed.className = 'feed' + (isListView ? ' list-view' : '');

  if (!filteredArticles.length) {
    feed.innerHTML = `<div class="empty-state"><h3>記事が見つかりません</h3>
      <p>別のカテゴリを選択するか、Actions を手動実行してください。</p></div>`;
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

  // 画像: imageフィールドを優先、なければプレースホルダ表示なし
  const imgHtml = a.image
    ? `<div class="card-img-wrap">
         <img class="card-img" src="${escHtml(a.image)}" alt=""
              loading="lazy"
              onerror="this.closest('.card-img-wrap').style.display='none'"/>
       </div>`
    : '';

  return `<article class="card">
    ${imgHtml}
    <div class="card-body">
      <div class="card-category">${escHtml(catLabel)}</div>
      <div class="card-title">${escHtml(a.title)}</div>
      <div class="card-desc">${escHtml(a.description || '')}</div>
    </div>
    <div class="card-footer">
      <span class="card-source">${escHtml(a.source)}</span>
      <span class="card-time">${relTime(a.date)}</span>
    </div>
  </article>`;
}

function showLoading(msg) {
  document.getElementById('feed').innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p id="loadingMsg">${msg}</p>
    </div>`;
}

// ─── 記事モーダル ────────────────────────────────────
function openArticle(a) {
  const catLabel = CATEGORIES.find(c => c.id === a.category)?.label || a.category;
  document.getElementById('articleMetaTop').textContent =
    a.source + ' · ' + relTime(a.date);
  document.getElementById('articleBody').innerHTML = `
    <div class="art-category">${escHtml(catLabel)}</div>
    <h1>${escHtml(a.title)}</h1>
    <div class="art-meta">
      <span>📰 ${escHtml(a.source)}</span>
      <span>🕐 ${new Date(a.date).toLocaleString('ja-JP')}</span>
    </div>
    ${a.image ? `<img class="art-img" src="${escHtml(a.image)}" alt=""
        onerror="this.style.display='none'"/>` : ''}
    <p class="art-body">${escHtml(a.description || '')}</p>
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
  const c = document.getElementById('sourceCategories');
  c.innerHTML = `
    <div class="source-group">
      <div class="source-group-title">収集の仕組み</div>
      <div class="source-item" style="flex-direction:column;align-items:flex-start;gap:6px">
        <p style="font-size:12.5px;color:var(--ink2);line-height:1.7">
          GitHub Actions が15分ごとに各ニュースサイトのRSSを自動収集し、
          <code style="font-family:var(--ff-mono);font-size:11px;background:var(--paper2);padding:1px 5px;border-radius:3px">data/news.json</code>
          に保存します。<br>
          このページはそのJSONを読むだけなので高速・安定して動作します。
        </p>
      </div>
    </div>
    <div class="source-group">
      <div class="source-group-title">収集ソース一覧</div>
      ${[
        ['社会',       ['NHK','朝日新聞','毎日新聞','読売新聞']],
        ['テクノロジー',['TechCrunch','Ars Technica','WIRED Japan','GIGAZINE','Engadget Japan','Hacker News']],
        ['ビジネス',   ['NHK経済','東洋経済オンライン','Reuters Business','ダイヤモンドOnline']],
        ['エンタメ',   ['ファミ通','電撃オンライン','ORICON NEWS','ナタリー','IGN Japan']],
        ['政治',       ['NHK政治/国際','BBC World','Reuters Politics']],
      ].map(([cat, names]) => `
        <div style="margin-bottom:12px">
          <div style="font-family:var(--ff-mono);font-size:9.5px;letter-spacing:.12em;color:var(--ink3);margin-bottom:6px;text-transform:uppercase">${cat}</div>
          ${names.map(n => `<span style="display:inline-block;background:var(--paper2);border:1px solid var(--paper3);border-radius:3px;font-size:11.5px;padding:2px 9px;margin:0 4px 4px 0;color:var(--ink2)">${n}</span>`).join('')}
        </div>`).join('')}
    </div>
    <div class="source-group">
      <div class="source-group-title">Actions を手動実行する</div>
      <a href="https://github.com/neg42/signal/actions" target="_blank" rel="noopener"
         style="display:inline-flex;align-items:center;gap:6px;background:var(--ink);color:var(--paper);padding:9px 16px;border-radius:4px;font-size:13px;text-decoration:none;font-family:var(--ff-body)">
        → GitHub Actions を開く
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
    filterAndRender();
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
    srchTimer = setTimeout(() => { searchQuery = e.target.value; filterAndRender(); }, 300);
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

// ─── ユーティリティ ──────────────────────────────────
function relTime(dateStr) {
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

// ─── カードアニメーション ─────────────────────────────
document.head.insertAdjacentHTML('beforeend', `<style>
.card-in { animation: fadeUp .3s ease both; }
@keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
.card-img-wrap { overflow: hidden; height: 200px; background: var(--paper2); }
.card-img-wrap img { width:100%;height:100%;object-fit:cover;display:block;transition:opacity .2s; }
.feed.list-view .card-img-wrap { width:160px;height:auto;min-height:130px;flex-shrink:0; }
.feed.list-view .card-img-wrap img { height:100%; }
</style>`);
