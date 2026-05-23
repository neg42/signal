async function load(options = {}) {
  showLoading();

  try {
    const queueRefresh = options.queueRefresh !== false;
    const isManual = window._manualRefresh;

    window._manualRefresh = false;

    const sep = WORKER_URL.includes('?') ? '&' : '?';
    const fetchUrl = WORKER_URL + sep
      + 'queue=' + (queueRefresh ? '1' : '0')
      + '&bust=' + Date.now();

    const res = await fetch(fetchUrl, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
    });

    if (!res.ok) throw new Error('HTTP ' + res.status);

    const raw = await res.json();

    raw.domestic = raw.domestic || raw.society || [];
    raw.world = raw.world || raw.international || raw.politics || [];
    raw.it = raw.it || raw.tech || [];
    raw.science = raw.science || [];
    raw.local = raw.local || [];
    raw.life = raw.life || [];
    raw.entertainment = raw.entertainment || [];
    raw.business = raw.business || [];
    raw.sports = raw.sports || [];
    raw.all = raw.all || [];

    newsData = {};
    const cats = ['all','domestic','world','business','entertainment','sports','it','science','local','life'];

    cats.forEach(cat => {
      if (!Array.isArray(raw[cat])) {
        newsData[cat] = [];
        return;
      }

      newsData[cat] = raw[cat].map(a => ({
        ...a,
        title: clean(a.title || ''),
        description: validDesc(clean(a.description || '')),
        source: clean(a.source || ''),
      })).filter(a => a.title.length > 3);
    });

    allArticles = newsData.all || [];

    if (!allArticles.length) {
      const seen = new Set();

      allArticles = ['domestic','world','business','entertainment','sports','it','science','local','life']
        .flatMap(c => newsData[c] || [])
        .filter(a => {
          if (!a?.title) return false;

          const k = a.title.replace(/\s+/g, '').slice(0, 50);
          if (seen.has(k)) return false;

          seen.add(k);
          return true;
        })
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

      newsData.all = allArticles;
    } else {
      allArticles.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    }

    if (raw.meta) metaData = raw.meta;

    breakingNews = raw.breaking || [];
    renderBreaking();

    buildNav();
    buildTicker();

    if (activeCategory === 'all' && !searchQuery) renderTop();
    else renderList();

    if (metaData?.updatedAt) {
      const t = new Date(metaData.updatedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
      document.getElementById('lastUpdated').textContent = '収集: ' + t;
      lastUpdatedAt = metaData.updatedAt;
    }

    if (isManual) {
      showToast('更新完了', 'success');
    }
  } catch (e) {
    console.error('[SIGNAL] load failed:', e);

    document.getElementById('feed').innerHTML = `
      <div class="empty-state">
        <h3>データを取得できません</h3>
        <p style="font-size:12px;margin-top:8px;color:var(--ink3)">エラー内容: ${esc(e.message)}</p>
        <p style="font-family:var(--ff-mono);font-size:10px;margin-top:12px;color:var(--ink3);text-align:left;white-space:pre-wrap;max-width:90%;margin-left:auto;margin-right:auto">${esc((e.stack || '').slice(0, 400))}</p>
        <button onclick="load()" style="margin-top:16px;padding:9px 20px;background:var(--ink);color:var(--paper);border:none;border-radius:4px;cursor:pointer">再読み込み</button>
      </div>`;
  }
}
