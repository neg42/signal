/* SIGNAL app.js — Cloudflare Workers版 */

// Cloudflare WorkerのURL（ニュースデータの取得先）
const WORKER_URL = 'https://signal-news.negligent42.workers.dev/news';

const CATEGORIES = [
  { id: 'all',           label: 'すべて',    icon: '◎' },
  { id: 'society',       label: '社会',      icon: '🗾' },
  { id: 'politics',      label: '政治・国際', icon: '🌏' },
  { id: 'business',      label: '経済',      icon: '📈' },
  { id: 'entertainment', label: 'エンタメ',  icon: '🎬' },
  { id: 'sports',        label: 'スポーツ',  icon: '⚽' },
  { id: 'tech',          label: 'テクノロジー', icon: '💻' },
];

const CAT_COLORS = {
  all:'#555', society:'#2d6a4f', politics:'#1a5c8a',
  business:'#b8973a', entertainment:'#6b3a8c', sports:'#1a7a4a',
  tech:'#1a3a5c',
};


const CATEGORY_ALIASES = {
  all: ['all'],
  society: ['society', 'domestic', 'local', 'life'],
  politics: ['politics', 'world'],
  business: ['business'],
  entertainment: ['entertainment'],
  sports: ['sports'],
  tech: ['tech', 'it', 'science'],
};

function normalizeCategory(cat='') {
  const key = String(cat||'').toLowerCase();
  for (const [normalized, aliases] of Object.entries(CATEGORY_ALIASES)) {
    if (aliases.includes(key)) return normalized;
  }
  return key || 'all';
}

let allArticles=[], filteredArticles=[];
let activeCategory='all', searchQuery='', isListView=false;
let newsData={}, metaData={};
let breakingNews=[];
let blockedSources = new Set(JSON.parse(localStorage.getItem('signal_blocked_sources')||'[]'));

function clean(html='') {
  return String(html)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
    .replace(/<style[\s\S]*?<\/style>/gi,'')
    .replace(/<script[\s\S]*?<\/script>/gi,'')
    .replace(/<a[^>]*>[\s\S]*?<\/a>/gi,'')
    .replace(/<[^>]+>/g,' ')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
    .replace(/&[a-z#0-9]+;/gi,' ')
    .replace(/\s+/g,' ').trim();
}

function esc(s='') {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const BAD_DESC_RE = /Google ?ニュース|世界中のニュース提供元|集約した広範囲|news\.google\.com|<img|<a |src=|href=/;

function validDesc(text) {
  if (!text || text.length < 20) return '';
  if (BAD_DESC_RE.test(text)) return '';
  return text;
}

function ago(d) {
  const m=Math.floor((Date.now()-new Date(d))/60000);
  if(m<1) return 'たった今';
  if(m<60) return m+'分前';
  const h=Math.floor(m/60);
  if(h<24) return h+'時間前';
  return Math.floor(h/24)+'日前';
}

function applyBlockFilter(arts) {
  if (!blockedSources.size) return arts;
  return arts.filter(a => !blockedSources.has(a.source));
}

document.addEventListener('DOMContentLoaded',()=>{
  document.querySelector('.logo').addEventListener('click',()=>{
    setCategory('all','すべてのニュース');
    window.scrollTo({top:0,behavior:'smooth'});
  });
  setupEvents();
  buildNav();
  load();
  startAutoRefreshCheck();
});

let lastUpdatedAt = null;


async function fetchJsonWithTimeout(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}


async function startAutoRefreshCheck() {
  await new Promise(r => setTimeout(r, 5 * 60 * 1000));
  setInterval(async () => {
    try {
      const res = await fetch(WORKER_URL + '?meta=1', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const newUpdatedAt = data.meta?.updatedAt;
      if (newUpdatedAt && lastUpdatedAt && newUpdatedAt !== lastUpdatedAt) {
        showToast('新しいニュースがあります', 'info');
        await load();
      }
    } catch {}
  }, 15 * 60 * 1000);
}

async function load() {
  showLoading();
  try {
    const isManual = window._manualRefresh;
    window._manualRefresh = false;
    const fetchUrl = isManual ? WORKER_URL + '?bust=' + Date.now() : WORKER_URL;
    let raw;
    try {
      raw = await fetchJsonWithTimeout(fetchUrl, 12000);
    } catch (err) {
      console.warn('[SIGNAL] worker fetch failed, fallback to local data:', err);
      raw = await fetchJsonWithTimeout('./data/news.json', 12000);
    }

    newsData = {};
    const cats = ['all','society','politics','business','entertainment','sports','tech'];

    cats.forEach(cat => {
      const merged = CATEGORY_ALIASES[cat].flatMap(alias => Array.isArray(raw[alias]) ? raw[alias] : []);
      newsData[cat] = merged.map(a=>({
        ...a,
        category: normalizeCategory(a.category || cat),
        title: clean(a.title||''),
        description: validDesc(clean(a.description||'')),
        source: clean(a.source||''),
      })).filter(a=>a.title.length>3);
    });

    allArticles = newsData.all || [];

    if (!allArticles.length) {
      const seen=new Set();
      allArticles = ['society','politics','business','entertainment','sports','tech']
        .flatMap(c=>newsData[c]||[])
        .filter(a=>{
          if(!a?.title) return false;
          const k=a.title.slice(0,40);
          if(seen.has(k)) return false;
          seen.add(k);
          return true;
        }).sort((a,b)=>(b.score||0)-(a.score||0));
      newsData.all = allArticles;
    } else {
      allArticles.sort((a,b)=>(b.score||0)-(a.score||0));
    }

    if (raw.meta) metaData = raw.meta;
    breakingNews = raw.breaking || [];
    renderBreaking();

    buildNav();
    buildTicker();

    if (activeCategory==='all'&&!searchQuery) renderTop();
    else renderList();

    if (metaData?.updatedAt) {
      const t = new Date(metaData.updatedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});
      document.getElementById('lastUpdated').textContent = '収集: ' + t;
      lastUpdatedAt = metaData.updatedAt;
    }
  } catch(e) {
    console.error('[SIGNAL] load failed:', e);
    document.getElementById('feed').innerHTML=`
      <div class="empty-state">
        <h3>データを取得できません</h3>
        <p style="font-size:12px;margin-top:8px;color:var(--ink3)">エラー内容: ${esc(e.message)}</p>
        <p style="font-family:var(--ff-mono);font-size:10px;margin-top:12px;color:var(--ink3);text-align:left;white-space:pre-wrap;max-width:90%;margin-left:auto;margin-right:auto">${esc((e.stack||'').slice(0,400))}</p>
        <button onclick="load()" style="margin-top:16px;padding:9px 20px;background:var(--ink);color:var(--paper);border:none;border-radius:4px;cursor:pointer">再読み込み</button>
      </div>`;
  }
}

function renderTop() {
  const feed=document.getElementById('feed');
  feed.className='feed top-page';
  const cats=CATEGORIES.filter(c=>c.id!=='all');
  let html='';

  const visibleAll = applyBlockFilter(allArticles);
  const top3 = visibleAll.slice(0,3);

  if(top3.length){
    html+=`<div class="sec top-sec">
      <div class="sec-hd"><span class="sec-lbl">最新ニュース</span>
        <button class="sec-more" onclick="setCategory('all','すべてのニュース')">すべて見る →</button>
      </div>
      ${top3.map((a,i)=>heroCard(a,i)).join('')}
    </div>`;
  }

  cats.forEach(cat=>{
    const arts = applyBlockFilter(newsData[cat.id]||[]).slice(0,5);
    if(!arts.length) return;
    const color=CAT_COLORS[cat.id]||'#555';
    html+=`<div class="sec cat-sec">
      <div class="sec-hd">
        <span class="sec-lbl" style="color:${color}">${cat.icon} ${cat.label}</span>
        <button class="sec-more" onclick="setCategory('${cat.id}','${cat.label}')">もっと見る →</button>
      </div>
      ${arts.map(a=>compactCard(a,color)).join('')}
    </div>`;
  });

  feed.innerHTML=html||'<div class="empty-state"><h3>記事を読み込み中</h3></div>';

  feed.querySelectorAll('[data-id]').forEach((el,i)=>{
    el.addEventListener('click',()=>{
      const art=findById(el.dataset.id);
      if(art) openArticle(art);
    });
    el.style.animationDelay=(i*0.025)+'s';
    el.classList.add('card-in');
  });
}

function findById(id) {
  return allArticles.find(a=>a.id===id) || Object.values(newsData).flat().find(a=>a.id===id);
}

function heroCard(a,idx) {
  const cat=CATEGORIES.find(c=>c.id===a.category);
  const color=CAT_COLORS[a.category]||'#555';
  return `<div class="hero-card${idx===0?' hero-first':''}" data-id="${esc(a.id)}">
    <div class="item-cat" style="color:${color}"><span class="dash"></span>${esc(cat?.label||a.category)}</div>
    <div class="hero-ttl">${esc(a.title)}</div>
    ${a.description ? `<div class="hero-desc">${esc(a.description)}</div>` : ''}
    <div class="item-meta">${esc(a.source)}<span class="dot">·</span>${ago(a.date)}</div>
  </div>`;
}

function compactCard(a,color) {
  return `<div class="compact-card" data-id="${esc(a.id)}">
    <span class="bullet" style="background:${color}"></span>
    <div class="compact-inner">
      <div class="compact-ttl">${esc(a.title)}</div>
      ${a.description ? `<div class="compact-desc">${esc(a.description)}</div>` : ''}
      <div class="item-meta">${esc(a.source)}<span class="dot">·</span>${ago(a.date)}</div>
    </div>
  </div>`;
}

function renderList() {
  const feed=document.getElementById('feed');
  feed.className='feed list-feed';

  let arts;
  if (activeCategory==='all') {
    arts = searchQuery ? allArticles.filter(matchSearch) : allArticles;
  } else {
    arts = (newsData[activeCategory]||[]);
    if (searchQuery) arts = arts.filter(matchSearch);
  }

  arts = applyBlockFilter(arts);
  filteredArticles = arts;

  if(!arts.length){
    feed.innerHTML=`<div class="empty-state"><h3>記事が見つかりません</h3>
      <p style="font-size:12px;margin-top:6px;color:var(--ink3)">媒体フィルタを確認するか、Actionsを手動実行してください</p></div>`;
    return;
  }

  feed.innerHTML=arts.map(a=>stdCard(a)).join('');
  feed.querySelectorAll('.std-card').forEach((el,i)=>{
    el.style.animationDelay=(i*0.02)+'s';
    el.classList.add('card-in');
    el.addEventListener('click',()=>openArticle(arts[i]));
  });
}

function matchSearch(a) {
  const q=searchQuery.toLowerCase();
  return a.title.toLowerCase().includes(q)||(a.description||'').toLowerCase().includes(q);
}

function stdCard(a) {
  const cat=CATEGORIES.find(c=>c.id===a.category);
  const color=CAT_COLORS[a.category]||'#555';
  return `<article class="std-card">
    <div class="item-cat" style="color:${color}"><span class="dash"></span>${esc(cat?.label||a.category)}</div>
    <div class="std-ttl">${esc(a.title)}</div>
    ${a.description ? `<div class="std-desc">${esc(a.description)}</div>` : ''}
    <div class="std-foot">
      <span class="std-src">${esc(a.source)}</span>
      <span>${ago(a.date)}</span>
    </div>
  </article>`;
}

function showLoading() {
  document.getElementById('feed').innerHTML=`<div class="loading-state"><div class="spinner"></div><p>読み込み中…</p></div>`;
}

function openArticle(a) {
  const cat=CATEGORIES.find(c=>c.id===a.category);
  const color=CAT_COLORS[a.category]||'#555';
  document.getElementById('articleMetaTop').textContent=a.source+' · '+ago(a.date);
  document.getElementById('articleBody').innerHTML=`
    <div class="item-cat" style="color:${color}"><span class="dash"></span>${esc(cat?.label||a.category)}</div>
    <h1>${esc(a.title)}</h1>
    <div class="art-meta">${esc(a.source)}<span class="dot">·</span>${new Date(a.date).toLocaleString('ja-JP')}</div>
    ${a.description ? `<p class="art-body">${esc(a.description)}</p>` : '<p class="art-body" style="color:var(--ink3);font-style:italic">本文は元記事でご確認ください</p>'}
    <a class="art-link" href="${esc(a.url)}" target="_blank" rel="noopener">元記事を読む →</a>`;
  document.getElementById('articleModal').classList.add('active');
  document.getElementById('articleBackdrop').classList.add('active');
}

function closeArticle() {
  ['articleModal','articleBackdrop'].forEach(id=>document.getElementById(id).classList.remove('active'));
}

function buildNav() {
  const list=document.getElementById('categoryList');
  list.innerHTML='';
  CATEGORIES.forEach(cat=>{
    const arts = cat.id==='all' ? allArticles : (newsData[cat.id]||[]);
    const count = applyBlockFilter(arts).length;
    const li=document.createElement('li');
    li.innerHTML=`<a class="${activeCategory===cat.id?'active':''}" data-cat="${cat.id}">
      <span class="cat-icon">${cat.icon}</span>
      <span>${cat.label}</span>
      ${count>0?`<span class="cat-count">${count}</span>`:''}
    </a>`;
    li.querySelector('a').addEventListener('click',()=>setCategory(cat.id,cat.label));
    list.appendChild(li);
  });
}

function setCategory(id,label) {
  activeCategory=id;
  document.getElementById('topbarTitle').textContent=id==='all'?'すべてのニュース':label;
  buildNav();
  buildTicker();
  if(id==='all'&&!searchQuery) renderTop();
  else renderList();
  window.scrollTo({top:0,behavior:'smooth'});
  if(window.innerWidth<=768) toggleSidebar();
}

function buildTicker() {
  const track=document.getElementById('tickerTrack');
  const src = activeCategory==='all' ? allArticles : (newsData[activeCategory]||allArticles);
  const visible = applyBlockFilter(src);
  const items=visible.slice(0,10).map(a=>`<span class="ticker-item">${esc(a.title)}</span>`).join('');
  track.innerHTML=items+items;
}

function renderBreaking() {
  let band = document.getElementById('breakingBand');
  if (!breakingNews || breakingNews.length === 0) {
    if (band) band.style.display = 'none';
    return;
  }

  if (!band) {
    const tickerOuter = document.querySelector('.ticker-outer');
    if (!tickerOuter) return;
    band = document.createElement('div');
    band.id = 'breakingBand';
    tickerOuter.insertAdjacentElement('afterend', band);
  }

  band.style.display = 'flex';
  band.innerHTML = `
    <div class="breaking-label">速報</div>
    <div class="breaking-list">
      ${breakingNews.slice(0,5).map(b => `
        <a class="breaking-item" href="${esc(b.url)}" target="_blank" rel="noopener">
          <span class="breaking-source">${esc(b.source)}</span>
          <span class="breaking-title">${esc(b.title)}</span>
          <span class="breaking-time">${esc(b.time)}</span>
        </a>
      `).join('')}
    </div>
  `;
}

function openSettings() {
  const sources = metaData.sources || [];
  const sourceList = sources.length
    ? sources.map(([name, count]) => {
        const blocked = blockedSources.has(name);
        return `<div class="src-row ${blocked?'blocked':''}">
          <input type="checkbox" id="src-${esc(name)}" data-src="${esc(name)}" ${blocked?'':'checked'}/>
          <label for="src-${esc(name)}">${esc(name)}</label>
          <span class="src-count">${count}</span>
        </div>`;
      }).join('')
    : '<p style="color:var(--ink3);font-size:12px;padding:8px 0">まだ媒体情報がありません</p>';

  document.getElementById('sourceCategories').innerHTML = `
    <div class="source-group">
      <div class="source-group-title">最新ニュースを取得</div>
      <div class="refresh-actions">
        <button class="refresh-action-btn primary" onclick="closeSettings();window._manualRefresh=true;load();">
          <span class="icon">🔄</span>
          <div>
            <div class="btn-title">今すぐ最新ニュースを取得</div>
            <div class="btn-sub">Cloudflareサーバーから最新データを取得します</div>
          </div>
        </button>
      </div>
      <div style="padding:10px 12px;background:var(--paper2);border-radius:4px;font-size:11.5px;line-height:1.7;color:var(--ink3);margin-top:10px">
        💡 アクセスのたびに自動で最新ニュースを取得します。キャッシュは10分間保持されます。
      </div>
    </div>
    <div class="source-group">
      <div class="source-group-title">媒体フィルタ <small style="font-weight:400;color:var(--ink3);margin-left:8px">チェックを外すと非表示</small></div>
      <div style="display:flex;gap:6px;margin-bottom:10px">
        <button class="src-mini-btn" onclick="selectAllSources()">すべて表示</button>
        <button class="src-mini-btn" onclick="clearAllSources()">すべて非表示</button>
        <button class="src-mini-btn" onclick="resetBlocks()">リセット</button>
      </div>
      <div class="src-list">${sourceList}</div>
    </div>`;

  document.querySelectorAll('input[data-src]').forEach(cb=>{
    cb.addEventListener('change',()=>{
      const src = cb.dataset.src;
      if (cb.checked) blockedSources.delete(src);
      else blockedSources.add(src);
      saveBlocks();
      cb.closest('.src-row').classList.toggle('blocked', !cb.checked);
    });
  });

  document.getElementById('settingsModal').classList.add('active');
  document.getElementById('modalBackdrop').classList.add('active');
}

function closeSettings(){
  ['settingsModal','modalBackdrop'].forEach(id=>document.getElementById(id).classList.remove('active'));
  buildNav();
  buildTicker();
  if (activeCategory==='all'&&!searchQuery) renderTop();
  else renderList();
}

function saveGhToken() {
  const val = document.getElementById('ghTokenInput')?.value?.trim();
  if (!val) { alert('トークンを入力してください'); return; }
  if (!val.startsWith('ghp_') && !val.startsWith('github_pat_')) {
    alert('トークンの形式が正しくありません。\nghp_ または github_pat_ で始まる値を入力してください。');
    return;
  }
  localStorage.setItem('signal_gh_token', val);
  const status = document.getElementById('tokenStatus');
  if (status) status.textContent = '✅ トークン保存済み';
  showToast('トークンを保存しました', 'success');
}

function clearGhToken() {
  localStorage.removeItem('signal_gh_token');
  const input = document.getElementById('ghTokenInput');
  if (input) input.value = '';
  const status = document.getElementById('tokenStatus');
  if (status) status.textContent = '未設定';
  showToast('トークンを削除しました');
}

async function triggerGitHubActions() {
  const token = localStorage.getItem('signal_gh_token');
  if (!token) {
    showToast('トークンを設定してください', 'error');
    document.getElementById('ghTokenInput')?.focus();
    return;
  }

  const btn = document.getElementById('triggerActionsBtn');
  const icon = document.getElementById('triggerIcon');
  const sub  = document.getElementById('triggerSub');
  if (btn) btn.disabled = true;
  if (icon) icon.textContent = '⏳';
  if (sub)  sub.textContent = '収集を開始しています…';

  try {
    const res = await fetch(
      'https://api.github.com/repos/neg42/signal/actions/workflows/update-news.yml/dispatches',
      {
        method: 'POST',
        headers: {
          'Authorization': 'token ' + token,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main' }),
      }
    );

    if (res.status === 204) {
      if (icon) icon.textContent = '✅';
      if (sub)  sub.textContent = '収集開始！2〜3分後に自動で画面が更新されます';
      showToast('ニュース収集を開始しました', 'success');
      setTimeout(async () => {
        await load();
        showToast('ニュースを更新しました', 'success');
      }, 3 * 60 * 1000);
    } else if (res.status === 401) {
      throw new Error('トークンが無効です。再設定してください');
    } else if (res.status === 403) {
      throw new Error('権限がありません。トークンのscopeにrepoを追加してください');
    } else {
      throw new Error('APIエラー: HTTP ' + res.status);
    }
  } catch(e) {
    if (icon) icon.textContent = '❌';
    if (sub)  sub.textContent = e.message;
    showToast(e.message, 'error');
    if (btn) btn.disabled = false;
  }
}

window.triggerGitHubActions = triggerGitHubActions;
window.saveGhToken = saveGhToken;
window.clearGhToken = clearGhToken;

function setupEvents() {
  document.getElementById('menuBtn').addEventListener('click',toggleSidebar);
  document.getElementById('sidebarClose').addEventListener('click',toggleSidebar);
  document.getElementById('viewGrid').addEventListener('click',()=>{
    isListView=false;
    document.getElementById('viewGrid').classList.add('active');
    document.getElementById('viewList').classList.remove('active');
    if(activeCategory==='all'&&!searchQuery) renderTop(); else renderList();
  });
  document.getElementById('viewList').addEventListener('click',()=>{
    isListView=true;
    document.getElementById('viewList').classList.add('active');
    document.getElementById('viewGrid').classList.remove('active');
    renderList();
  });
  let st;
  document.getElementById('searchInput').addEventListener('input',e=>{
    clearTimeout(st);
    st=setTimeout(()=>{
      searchQuery=e.target.value;
      if(searchQuery) renderList();
      else if(activeCategory==='all') renderTop();
      else renderList();
    },300);
  });
  document.getElementById('openSettings').addEventListener('click',openSettings);
  document.getElementById('closeSettings').addEventListener('click',closeSettings);
  document.getElementById('modalBackdrop').addEventListener('click',closeSettings);
  document.getElementById('closeArticle').addEventListener('click',closeArticle);
  document.getElementById('articleBackdrop').addEventListener('click',closeArticle);
  document.getElementById('refreshBtn').addEventListener('click', async () => {
    closeSettings();
    window._manualRefresh = true;
    showToast('最新データを取得中...');
    await load();
    showToast('更新完了', 'success');
  });
  document.getElementById('fetchNewBtn')?.addEventListener('click', () => {
    window.open('https://github.com/neg42/signal/actions/workflows/update-news.yml', '_blank');
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeArticle();closeSettings();}});
}

function toggleSidebar() {
  const sb=document.getElementById('sidebar');
  if(window.innerWidth<=768) sb.classList.toggle('mobile-open');
  else{sb.classList.toggle('hidden');document.querySelector('.main').classList.toggle('expanded');}
}

function saveBlocks() {
  localStorage.setItem('signal_blocked_sources', JSON.stringify([...blockedSources]));
}

function selectAllSources() {
  blockedSources.clear();
  saveBlocks();
  document.querySelectorAll('input[data-src]').forEach(cb=>{
    cb.checked = true;
    cb.closest('.src-row')?.classList.remove('blocked');
  });
}

function clearAllSources() {
  document.querySelectorAll('input[data-src]').forEach(cb=>{
    blockedSources.add(cb.dataset.src);
    cb.checked = false;
    cb.closest('.src-row')?.classList.add('blocked');
  });
  saveBlocks();
}

function resetBlocks() {
  blockedSources.clear();
  saveBlocks();
  closeSettings();
  openSettings();
}

window.selectAllSources = selectAllSources;
window.clearAllSources = clearAllSources;
window.resetBlocks = resetBlocks;
window.load = load;
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.closeArticle = closeArticle;
window.setCategory = setCategory;

function showToast(msg, type='info') {
  const existing = document.getElementById('signal-toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'signal-toast';
  t.className = 'signal-toast' + (type==='success'?' toast-success':type==='info'?' toast-info':type==='error'?' toast-error':'');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(()=>t.classList.add('show'), 10);
  setTimeout(()=>{
    t.classList.remove('show');
    setTimeout(()=>t.remove(), 300);
  }, 2200);
}

document.head.insertAdjacentHTML('beforeend',`<style>
.card-in{animation:fadeUp .28s ease both}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.dash{display:inline-block;width:14px;height:2px;background:currentColor;border-radius:1px;margin-right:6px;vertical-align:middle;flex-shrink:0}
.dot{margin:0 4px;opacity:.35}
.item-cat{font-family:var(--ff-mono);font-size:9px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;margin-bottom:6px;display:flex;align-items:center}
.item-meta{font-family:var(--ff-mono);font-size:10px;color:var(--ink3);margin-top:5px}
.feed.top-page{display:block;background:var(--paper)}
.sec{border-bottom:1px solid var(--paper3);padding:18px 18px 20px}
.top-sec{border-bottom:2px solid var(--ink)}
.sec-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.sec-lbl{font-family:var(--ff-mono);font-size:9.5px;font-weight:500;letter-spacing:.18em;text-transform:uppercase;color:var(--ink3)}
.sec-more{background:none;border:none;font-family:var(--ff-mono);font-size:10px;color:var(--red);cursor:pointer}
.sec-more:hover{opacity:.7}
.hero-card{padding:14px 0;border-bottom:1px solid var(--paper3);cursor:pointer}
.hero-card:last-child{border-bottom:none}
.hero-card:active{opacity:.7}
.hero-ttl{font-family:var(--ff-head);font-size:15px;font-weight:700;line-height:1.4;color:var(--ink);letter-spacing:-.01em;margin-bottom:6px}
.hero-first .hero-ttl{font-size:18px;line-height:1.35}
.hero-desc{font-size:12.5px;color:var(--ink3);line-height:1.6;margin-bottom:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.compact-card{display:flex;gap:10px;align-items:flex-start;padding:11px 0;border-bottom:1px solid var(--paper3);cursor:pointer}
.compact-card:last-child{border-bottom:none}
.compact-card:active{opacity:.7}
.bullet{width:6px;height:6px;border-radius:50%;flex-shrink:0;margin-top:6px}
.compact-inner{flex:1;min-width:0}
.compact-ttl{font-family:var(--ff-head);font-size:13.5px;font-weight:700;line-height:1.4;color:var(--ink);letter-spacing:-.01em;margin-bottom:4px}
.compact-desc{font-size:11.5px;color:var(--ink3);line-height:1.55;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.feed.list-feed{display:block;background:var(--paper)}
.std-card{border-bottom:1px solid var(--paper3);padding:16px 18px;cursor:pointer}
.std-card:active{background:rgba(0,0,0,.03)}
.std-ttl{font-family:var(--ff-head);font-size:16px;font-weight:700;line-height:1.38;color:var(--ink);margin-bottom:6px;letter-spacing:-.01em}
.std-desc{font-size:12.5px;color:var(--ink3);line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:8px}
.std-foot{display:flex;justify-content:space-between;font-family:var(--ff-mono);font-size:10.5px;color:var(--ink3)}
.std-src{color:var(--ink2);font-weight:500}
#articleBody h1{font-family:var(--ff-head);font-size:19px;font-weight:700;line-height:1.3;margin:10px 0 12px;color:var(--ink);letter-spacing:-.02em}
.art-meta{font-family:var(--ff-mono);font-size:10.5px;color:var(--ink3);margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--paper3)}
.art-body{font-size:13.5px;line-height:1.85;color:var(--ink2);margin-bottom:20px}
.art-link{display:inline-flex;align-items:center;background:var(--ink);color:var(--paper);padding:10px 20px;border-radius:4px;font-size:13px;text-decoration:none;margin-top:4px}
.loading-state{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:80px 20px;color:var(--ink3);font-family:var(--ff-mono);font-size:12px}
.empty-state{text-align:center;padding:60px 20px;color:var(--ink3)}
.empty-state h3{font-family:var(--ff-head);font-size:20px;color:var(--ink);margin-bottom:8px}
.breaking-band,#breakingBand{display:flex;align-items:stretch;background:#c0392b;border-bottom:2px solid #96281b;overflow:hidden;max-height:none}
.breaking-label{padding:0 14px;font-family:var(--ff-mono);font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#fff;background:#96281b;display:flex;align-items:center;justify-content:center;white-space:nowrap;flex-shrink:0;min-height:36px}
.breaking-list{display:flex;flex-direction:column;flex:1;overflow:hidden}
.breaking-item{display:flex;align-items:center;gap:10px;padding:6px 14px;text-decoration:none;border-bottom:1px solid rgba(255,255,255,.15);transition:background .15s}
.breaking-item:last-child{border-bottom:none}
.breaking-item:hover{background:rgba(0,0,0,.15)}
.breaking-source{font-family:var(--ff-mono);font-size:9px;font-weight:700;color:rgba(255,255,255,.75);white-space:nowrap;flex-shrink:0;background:rgba(0,0,0,.2);padding:1px 6px;border-radius:2px}
.breaking-title{font-family:var(--ff-body);font-size:12.5px;font-weight:600;color:#fff;flex:1;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}
.breaking-time{font-family:var(--ff-mono);font-size:10px;color:rgba(255,255,255,.6);white-space:nowrap;flex-shrink:0}
.src-mini-btn{background:var(--paper2);border:1px solid var(--paper3);color:var(--ink2);font-size:11px;padding:5px 10px;border-radius:4px;cursor:pointer;font-family:var(--ff-body)}
.src-mini-btn:hover{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.src-list{max-height:280px;overflow-y:auto;border:1px solid var(--paper3);border-radius:4px}
.src-row{display:flex;align-items:center;gap:10px;padding:7px 11px;border-bottom:1px solid var(--paper2);background:#fff}
.src-row:last-child{border-bottom:none}
.src-row.blocked{opacity:.4;background:var(--paper2)}
.src-row label{flex:1;font-size:12.5px;color:var(--ink2);cursor:pointer}
.src-row input[type=checkbox]{accent-color:var(--red);width:14px;height:14px;cursor:pointer}
.src-count{font-family:var(--ff-mono);font-size:10px;color:var(--ink3);background:var(--paper2);padding:1px 6px;border-radius:10px;min-width:24px;text-align:center}
.refresh-actions{display:flex;flex-direction:column;gap:8px}
.refresh-action-btn{display:flex;align-items:center;gap:12px;padding:12px 14px;background:#fff;border:1px solid var(--paper3);border-radius:6px;cursor:pointer;text-align:left;font-family:var(--ff-body);transition:all .15s;width:100%}
.refresh-action-btn:hover{border-color:var(--ink2);background:var(--paper)}
.refresh-action-btn.primary{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.refresh-action-btn.primary:hover{opacity:.9;background:var(--ink)}
.refresh-action-btn .icon{font-size:18px;flex-shrink:0}
.refresh-action-btn .btn-title{font-size:13px;font-weight:600;margin-bottom:2px}
.refresh-action-btn .btn-sub{font-size:11px;color:var(--ink3);font-family:var(--ff-mono)}
.refresh-action-btn.primary .btn-sub{color:rgba(247,245,240,.6)}
.signal-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--ink);color:var(--paper);padding:10px 20px;border-radius:24px;font-size:13px;font-family:var(--ff-body);box-shadow:0 8px 24px rgba(0,0,0,.25);z-index:1000;opacity:0;transition:all .3s ease;pointer-events:none}
.signal-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.signal-toast.toast-success{background:#2d6a4f}
.signal-toast.toast-info{background:#1a3a5c}
.signal-toast.toast-error{background:#c0392b}
</style>`);
