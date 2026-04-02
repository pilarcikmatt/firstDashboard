// ─── Updated Yahoo Finance Functions ──────────────────────────────────────────
async function fetchYahoo(ticker) {
  // Instead of calling Yahoo directly, call your own backend proxy
  const res  = await fetch(`/api/stock?ticker=${ticker}&type=quote`);
  
  if (!res.ok) {
    throw new Error(`Proxy error: ${res.status}`);
  }
  
  const data = await res.json();
  const r    = data?.chart?.result?.[0];
  if (!r) throw new Error("No data");
  
  const meta   = r.meta;
  const closes = r.indicators?.quote?.[0]?.close || [];
  const valid  = closes.filter(Boolean);
  const price  = meta.regularMarketPrice ?? valid[valid.length-1];
  const prev   = meta.previousClose ?? meta.chartPreviousClose;
  
  return {
    ticker,
    name:         meta.longName || meta.shortName || ticker,
    price,
    dayChangePct: prev ? ((price - prev) / prev * 100) : null,
    change3dPct:  valid[valid.length-4]  ? ((price - valid[valid.length-4])  / valid[valid.length-4]  * 100) : null,
    change1mPct:  valid[valid.length-22] ? ((price - valid[valid.length-22]) / valid[valid.length-22] * 100) : null,
    change1yPct:  valid[0]               ? ((price - valid[0])               / valid[0]               * 100) : null,
    volume:    meta.regularMarketVolume,
    marketCap: meta.marketCap,
    sparkline: valid.slice(-20),
    currency:  meta.currency || "USD",
    exchange:  meta.exchangeName,
  };
}

async function fetchChart2Y(ticker) {
  // Use the proxy for charts as well
  const res  = await fetch(`/api/stock?ticker=${ticker}&type=chart`);
  
  if (!res.ok) {
    throw new Error(`Proxy error: ${res.status}`);
  }

  const data = await res.json();
  const r    = data?.chart?.result?.[0];
  if (!r) throw new Error("No data");
  const closes = r.indicators?.quote?.[0]?.close || [];
  return (r.timestamp || [])
    .map((ts,i) => ({
      date:  new Date(ts*1000).toLocaleDateString("en-US",{month:"short",year:"2-digit"}),
      price: closes[i],
    }))
    .filter(d => d.price != null);
}

// ... inside StockDashboard component ...
const loadStock = useCallback(async (ticker, delay=0) => {
  if (delay) await sleep(delay);
  setLoadingMap(p=>({...p,[ticker]:true}));
  try {
    const d = await fetchYahoo(ticker);
    setStockData(p=>({...p,[ticker]:d}));
  } catch (e) {
    // UPDATED: Added error logging so you can see failures in Inspect -> Console
    console.error(`Failed to load ${ticker}:`, e);
  }
  finally { setLoadingMap(p=>({...p,[ticker]:false})); }
}, []);