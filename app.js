async function startAutoRefreshCheck() {
  const maxChecks = 12;
  let checks = 0;

  const check = async () => {
    checks++;

    try {
      const sep = WORKER_URL.includes('?') ? '&' : '?';
      const res = await fetch(WORKER_URL + sep + 'meta=1&queue=0&bust=' + Date.now(), {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
        },
      });

      if (!res.ok) return;

      const data = await res.json();
      const newUpdatedAt = data.meta?.updatedAt;

      if (newUpdatedAt && lastUpdatedAt && newUpdatedAt !== lastUpdatedAt) {
        showToast('新しいニュースを反映しました', 'success');
        await load({ queueRefresh: false });
        return;
      }
    } catch {}

    if (checks < maxChecks) {
      setTimeout(check, 20 * 1000);
    }
  };

  setTimeout(check, 20 * 1000);

  setInterval(async () => {
    try {
      const sep = WORKER_URL.includes('?') ? '&' : '?';
      const res = await fetch(WORKER_URL + sep + 'meta=1&queue=0&bust=' + Date.now(), {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
        },
      });

      if (!res.ok) return;

      const data = await res.json();
      const newUpdatedAt = data.meta?.updatedAt;

      if (newUpdatedAt && lastUpdatedAt && newUpdatedAt !== lastUpdatedAt) {
        showToast('新しいニュースがあります', 'info');
        await load({ queueRefresh: false });
      }
    } catch {}
  }, 15 * 60 * 1000);
}
