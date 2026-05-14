 (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF' 
diff --git a/app.js b/app.js
index cc831c88d5c1643248de8fcf208366f78832c404..96bbee5351dbc8cae450e773f1b1e5461abd503b 100644
--- a/app.js
+++ b/app.js
@@ -1,47 +1,44 @@
 /* SIGNAL app.js — Cloudflare Workers版 */
 
 // Cloudflare WorkerのURL（ニュースデータの取得先）
 const WORKER_URL = 'https://signal-news.negligent42.workers.dev/news';
 
 const CATEGORIES = [
   { id: 'all',           label: 'すべて',    icon: '◎' },
-  { id: 'domestic',      label: '国内',      icon: '🗾' },
-  { id: 'world',         label: '国際',      icon: '🌏' },
+  { id: 'society',       label: '社会',      icon: '🗾' },
+  { id: 'politics',      label: '政治・国際', icon: '🌏' },
   { id: 'business',      label: '経済',      icon: '📈' },
   { id: 'entertainment', label: 'エンタメ',  icon: '🎬' },
   { id: 'sports',        label: 'スポーツ',  icon: '⚽' },
-  { id: 'it',            label: 'IT',        icon: '💻' },
-  { id: 'science',       label: '科学',      icon: '🔬' },
-  { id: 'local',         label: '地域',      icon: '📍' },
-  { id: 'life',          label: 'ライフ',    icon: '🌱' },
+  { id: 'tech',          label: 'テクノロジー', icon: '💻' },
 ];
 
 const CAT_COLORS = {
-  all:'#555', domestic:'#2d6a4f', world:'#1a5c8a',
+  all:'#555', society:'#2d6a4f', politics:'#1a5c8a',
   business:'#b8973a', entertainment:'#6b3a8c', sports:'#1a7a4a',
-  it:'#1a3a5c', science:'#2a6a5c', local:'#8a5a2a', life:'#5a8a3a',
+  tech:'#1a3a5c',
 };
 
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
 
@@ -85,70 +82,70 @@ async function startAutoRefreshCheck() {
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
     const res = await fetch(fetchUrl);
     if (!res.ok) throw new Error('HTTP ' + res.status);
     const raw = await res.json();
 
     newsData = {};
-    const cats = ['all','domestic','world','business','entertainment','sports','it','science','local','life'];
+    const cats = ['all','society','politics','business','entertainment','sports','tech'];
 
     cats.forEach(cat => {
       if (!Array.isArray(raw[cat])) {
         newsData[cat]=[];
         return;
       }
       newsData[cat] = raw[cat].map(a=>({
         ...a,
         title: clean(a.title||''),
         description: validDesc(clean(a.description||'')),
         source: clean(a.source||''),
       })).filter(a=>a.title.length>3);
     });
 
     allArticles = newsData.all || [];
 
     if (!allArticles.length) {
       const seen=new Set();
-      allArticles = ['domestic','world','business','entertainment','sports','it','science','local','life']
+      allArticles = ['society','politics','business','entertainment','sports','tech']
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
 
EOF
)
