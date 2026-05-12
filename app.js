/* SIGNAL app.js */

const CATEGORIES = [
  { id: 'all',           label: 'すべて',          icon: '◎' },
  { id: 'tech',          label: 'テクノロジー・AI', icon: '⚡' },
  { id: 'business',      label: 'ビジネス・経済',   icon: '📈' },
  { id: 'entertainment', label: 'エンタメ・ゲーム', icon: '🎮' },
  { id: 'politics',      label: '政治',            icon: '🏛' },
  { id: 'society',       label: '社会',            icon: '📰' },
];
const CAT_COLORS = {
  tech:'#1a3a5c', business:'#b8973a', entertainment:'#6b3a8c',
  politics:'#c0392b', society:'#2d6a4f', all:'#555',
};

let allArticles=[], filteredArticles=[];
let activeCategory='all', searchQuery='', isListView=false;
let newsData={};

// HTMLを完全除去（aタグは中身ごと削除）
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

function ago(d) {
  const m=Math.floor((Date.now()-new Date(d))/60000);
  if(m<1) return 'たった今';
  if(m<60) return m+'分前';
  const h=Math.floor(m/60);
  if(h<24) return h+'時間前';
  return Math.floor(h/24)+'日前';
}

// ─── INIT ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  document.querySelector('.logo').addEventListener('click',()=>{
    setCategory('all','すべてのニュース');
    window.scrollTo({top:0,behavior:'smooth'});
  });
  setupEvents();
  buildNav();
  load();
});

// ─── データ読み込み ───────────────────────────────────
async function load() {
  showLoading();
  try {
    const res = await fetch('./data/news.json?v='+Date.now(),{cache:'no-store'});
    if (!res.ok) throw new Error('HTTP '+res.status);
    const raw = await res.json();

    // 全フィールドのHTMLを除去しながらnewsDataに格納
    newsData = {};
    const cats = ['all','society','tech','business','entertainment','politics','custom'];
    cats.forEach(cat => {
      if (!Array.isArray(raw[cat])) { newsData[cat]=[]; return; }
      newsData[cat] = raw[cat].map(a=>({
        ...a,
        title:  clean(a.title||''),
        description: clean(a.description||''),
        source: clean(a.source||''),
      })).filter(a=>a.title.length>3);
    });

    allArticles = newsData.all||[];

    // allが空またはカテゴリ別のデータがallに含まれていない場合、マージして生成
    if (!allArticles.length) {
      const seen=new Set();
      allArticles = cats.filter(c=>c!=='all'&&c!=='custom')
        .flatMap(c=>newsData[c]||[])
        .filter(a=>{
          if(!a?.title) return false;
          const k=a.title.slice(0,40);
          if(seen.has(k)) return false;
          seen.add(k); return true;
        }).sort((a,b)=>new Date(b.date)-new Date(a.date));
      newsData.all = allArticles;
    }

    buildNav();
    buildTicker();
    if (activeCategory==='all'&&!searchQuery) renderTop();
    else renderList();

    // 更新時刻
    try {
      const mr=await fetch('./data/meta.json?v='+Date.now(),{cache:'no-store'});
      if(mr.ok){
        const meta=await mr.json();
        const t=new Date(meta.updatedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});
        document.getElementById('lastUpdated').textContent='収集: '+t;
      }
    } catch{}
  } catch(e) {
    document.getElementById('feed').innerHTML=`
      <div class="empty-state">
        <h3>データを取得できません</h3>
        <p style="font-size:12px;margin-top:8px;color:var(--ink3)">Actions タブから手動実行してください</p>
        <p style="font-family:var(--ff-mono);font-size:10px;margin-top:8px;color:var(--ink3)">${esc(e.message)}</p>
        <button onclick="load()" style="margin-top:16px;padding:9px 20px;background:var(--ink);color:var(--paper);border:none;border-radius:4px;cursor:pointer">再読み込み</button>
      </div>`;
  }
}

// ─── トップページ ─────────────────────────────────────
function renderTop() {
  const feed=document.getElementById('feed');
  feed.className='feed top-page';
  const cats=CATEGORIES.filter(c=>c.id!=='all');
  let html='';

  // 最新ニュース上位3件
  const top3=allArticles.slice(0,3);
  if(top3.length){
    html+=`<div class="sec top-sec">
      <div class="sec-hd"><span class="sec-lbl">最新ニュース</span>
        <button class="sec-more" onclick="setCategory('all','すべてのニュース')">すべて見る →</button>
      </div>
      ${top3.map((a,i)=>heroCard(a,i)).join('')}
    </div>`;
  }

  // カテゴリ別
  cats.forEach(cat=>{
    const arts=(newsData[cat.id]||[]).slice(0,5);
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

  feed.innerHTML=html||'<div class="empty-state"><h3>記事を読み込み中です</h3><p>しばらくお待ちください</p></div>';

  feed.querySelectorAll('[data-id]').forEach((el,i)=>{
    el.addEventListener('click',()=>{
      const id=el.dataset.id;
      const art=findById(id);
      if(art) openArticle(art);
    });
    el.style.animationDelay=(i*0.025)+'s';
    el.classList.add('card-in');
  });
}

function findById(id) {
  // allから検索、なければ各カテゴリから
  return allArticles.find(a=>a.id===id)
    || Object.values(newsData).flat().find(a=>a.id===id);
}

function heroCard(a,idx) {
  const cat=CATEGORIES.find(c=>c.id===a.category);
  const color=CAT_COLORS[a.category]||'#555';
  return `<div class="hero-card${idx===0?' hero-first':''}" data-id="${esc(a.id)}">
    <div class="item-cat" style="color:${color}"><span class="dash"></span>${esc(cat?.label||a.category)}</div>
    <div class="hero-ttl">${esc(a.title)}</div>
    <div class="item-meta">${esc(a.source)}<span class="dot">·</span>${ago(a.date)}</div>
  </div>`;
}

function compactCard(a,color) {
  return `<div class="compact-card" data-id="${esc(a.id)}">
    <span class="bullet" style="background:${color}"></span>
    <div class="compact-inner">
      <div class="compact-ttl">${esc(a.title)}</div>
      <div class="item-meta">${esc(a.source)}<span class="dot">·</span>${ago(a.date)}</div>
    </div>
  </div>`;
}

// ─── カテゴリ別リスト ─────────────────────────────────
function renderList() {
  const feed=document.getElementById('feed');
  feed.className='feed list-feed';

  // カテゴリ別データを優先使用（allのフィルタより確実）
  let arts;
  if (activeCategory==='all') {
    arts = searchQuery ? allArticles.filter(matchSearch) : allArticles;
  } else {
    // newsData[activeCategory]を直接使う
    arts = (newsData[activeCategory]||[]);
    if (searchQuery) arts = arts.filter(matchSearch);
  }

  filteredArticles = arts;

  if(!arts.length){
    feed.innerHTML=`<div class="empty-state"><h3>記事が見つかりません</h3>
      <p style="font-size:12px;margin-top:6px;color:var(--ink3)">Actionsを手動実行すると更新されます</p></div>`;
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
    ${a.description?`<div class="std-desc">${esc(a.description)}</div>`:''}
    <div class="std-foot">
      <span class="std-src">${esc(a.source)}</span>
      <span>${ago(a.date)}</span>
    </div>
  </article>`;
}

function showLoading() {
  document.getElementById('feed').innerHTML=
    `<div class="loading-state"><div class="spinner"></div><p>読み込み中…</p></div>`;
}

// ─── 記事モーダル ─────────────────────────────────────
function openArticle(a) {
  const cat=CATEGORIES.find(c=>c.id===a.category);
  const color=CAT_COLORS[a.category]||'#555';
  document.getElementById('articleMetaTop').textContent=a.source+' · '+ago(a.date);
  document.getElementById('articleBody').innerHTML=`
    <div class="item-cat" style="color:${color}"><span class="dash"></span>${esc(cat?.label||a.category)}</div>
    <h1>${esc(a.title)}</h1>
    <div class="art-meta">${esc(a.source)}<span class="dot">·</span>${new Date(a.date).toLocaleString('ja-JP')}</div>
    ${a.description?`<p class="art-body">${esc(a.description)}</p>`:''}
    <a class="art-link" href="${esc(a.url)}" target="_blank" rel="noopener">元記事を読む →</a>`;
  document.getElementById('articleModal').classList.add('active');
  document.getElementById('articleBackdrop').classList.add('active');
}
function closeArticle() {
  ['articleModal','articleBackdrop'].forEach(id=>document.getElementById(id).classList.remove('active'));
}

// ─── カテゴリナビ ─────────────────────────────────────
function buildNav() {
  const list=document.getElementById('categoryList');
  list.innerHTML='';
  CATEGORIES.forEach(cat=>{
    const count = cat.id==='all'
      ? allArticles.length
      : (newsData[cat.id]||[]).length;
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
  const src=activeCategory==='all'?allArticles:(newsData[activeCategory]||allArticles);
  const items=src.slice(0,10).map(a=>`<span class="ticker-item">${esc(a.title)}</span>`).join('');
  track.innerHTML=items+items;
}

// ─── 設定モーダル ─────────────────────────────────────
function openSettings() {
  document.getElementById('sourceCategories').innerHTML=`
    <div class="source-group">
      <div class="source-group-title">収集の仕組み</div>
      <div style="padding:12px;background:#fff;border:1px solid var(--paper3);border-radius:4px;font-size:12.5px;line-height:1.8;color:var(--ink2)">
        GitHub Actionsが15分ごとに<strong>Google News RSS（日本語）</strong>を収集。
        英語記事は自動除外されます。
      </div>
    </div>
    <div class="source-group">
      <div class="source-group-title">収集ソース</div>
      ${[
        ['Google News RSS','社会・政治・経済・テクノロジー・エンタメ（日本語のみ）'],
        ['GIGAZINE','テクノロジー'],
        ['ファミ通 / 電撃 / IGN Japan','エンタメ・ゲーム'],
        ['ORICON NEWS / ナタリー','エンタメ'],
      ].map(([n,c])=>`<div class="source-item">
        <span class="source-badge rss">RSS</span>
        <label>${n}</label>
        <small style="color:var(--ink3);font-size:10px;margin-left:auto">${c}</small>
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
function closeSettings(){
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
  document.getElementById('refreshBtn').addEventListener('click',()=>{closeSettings();load();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeArticle();closeSettings();}});
}

function toggleSidebar() {
  const sb=document.getElementById('sidebar');
  if(window.innerWidth<=768) sb.classList.toggle('mobile-open');
  else{sb.classList.toggle('hidden');document.querySelector('.main').classList.toggle('expanded');}
}

// ─── スタイル ─────────────────────────────────────────
document.head.insertAdjacentHTML('beforeend',`<style>
.card-in{animation:fadeUp .28s ease both}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

.dash{display:inline-block;width:14px;height:2px;background:currentColor;border-radius:1px;margin-right:6px;vertical-align:middle;flex-shrink:0}
.dot{margin:0 4px;opacity:.35}
.item-cat{font-family:var(--ff-mono);font-size:9px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;margin-bottom:6px;display:flex;align-items:center}
.item-meta{font-family:var(--ff-mono);font-size:10px;color:var(--ink3);margin-top:5px}

/* トップページ */
.feed.top-page{display:block;background:var(--paper)}
.sec{border-bottom:1px solid var(--paper3);padding:18px 18px 20px}
.top-sec{border-bottom:2px solid var(--ink)}
.sec-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.sec-lbl{font-family:var(--ff-mono);font-size:9.5px;font-weight:500;letter-spacing:.18em;text-transform:uppercase;color:var(--ink3)}
.sec-more{background:none;border:none;font-family:var(--ff-mono);font-size:10px;color:var(--red);cursor:pointer}
.sec-more:hover{opacity:.7}

.hero-card{padding:12px 0;border-bottom:1px solid var(--paper3);cursor:pointer}
.hero-card:last-child{border-bottom:none}
.hero-card:active{opacity:.7}
.hero-ttl{font-family:var(--ff-head);font-size:14px;font-weight:700;line-height:1.4;color:var(--ink);letter-spacing:-.01em}
.hero-first .hero-ttl{font-size:17px;line-height:1.35}

.compact-card{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--paper3);cursor:pointer}
.compact-card:last-child{border-bottom:none}
.compact-card:active{opacity:.7}
.bullet{width:6px;height:6px;border-radius:50%;flex-shrink:0;margin-top:6px}
.compact-inner{flex:1;min-width:0}
.compact-ttl{font-family:var(--ff-head);font-size:13px;font-weight:700;line-height:1.4;color:var(--ink);letter-spacing:-.01em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}

/* リストフィード */
.feed.list-feed{display:block;background:var(--paper)}
.std-card{border-bottom:1px solid var(--paper3);padding:16px 18px;cursor:pointer}
.std-card:active{background:rgba(0,0,0,.03)}
.std-ttl{font-family:var(--ff-head);font-size:16px;font-weight:700;line-height:1.38;color:var(--ink);margin-bottom:5px;letter-spacing:-.01em}
.std-desc{font-size:12.5px;color:var(--ink3);line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:6px}
.std-foot{display:flex;justify-content:space-between;font-family:var(--ff-mono);font-size:10.5px;color:var(--ink3)}
.std-src{color:var(--ink2);font-weight:500}

/* 記事モーダル */
#articleBody h1{font-family:var(--ff-head);font-size:19px;font-weight:700;line-height:1.3;margin:10px 0 12px;color:var(--ink);letter-spacing:-.02em}
.art-meta{font-family:var(--ff-mono);font-size:10.5px;color:var(--ink3);margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--paper3)}
.art-body{font-size:13.5px;line-height:1.85;color:var(--ink2);margin-bottom:20px}
.art-link{display:inline-flex;align-items:center;background:var(--ink);color:var(--paper);padding:10px 20px;border-radius:4px;font-size:13px;text-decoration:none;margin-top:4px}
.art-link:hover{opacity:.8}

/* ローディング/空 */
.loading-state{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:80px 20px;color:var(--ink3);font-family:var(--ff-mono);font-size:12px}
.empty-state{text-align:center;padding:60px 20px;color:var(--ink3)}
.empty-state h3{font-family:var(--ff-head);font-size:20px;color:var(--ink);margin-bottom:8px}
</style>`);
