import { useState, useEffect, useCallback, useRef } from "react";
import {
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Area, AreaChart,
} from "recharts";

// ─── Theme ────────────────────────────────────────────────────────────────────
const C = {
  bg:       "#080b10",
  surface:  "#0e1117",
  card:     "#121720",
  border:   "#1c2030",
  accent:   "#e8c76a",
  accentDim:"#e8c76a18",
  green:    "#3dd68c",
  red:      "#f0506e",
  redDim:   "#f0506e18",
  text:     "#dde3f0",
  sub:      "#8892a4",
  grid:     "#141820",
  gold:     "#c9a227",
};

const DEFAULT_TICKERS = ["AAPL","MSFT","NVDA","GOOGL","TSLA","AMZN","META","JPM"];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt    = (n, d=2) => n != null ? Number(n).toFixed(d) : "—";
const fmtBig = n => {
  if (!n) return "—";
  if (n >= 1e12) return `$${(n/1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n/1e6).toFixed(2)}M`;
  return `$${n.toLocaleString()}`;
};
const fmtVol = n => {
  if (!n) return "—";
  if (n >= 1e9) return `${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n/1e6).toFixed(2)}M`;
  return `${(n/1e3).toFixed(1)}K`;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Yahoo Finance ────────────────────────────────────────────────────────────
async function fetchYahoo(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1y&corsDomain=finance.yahoo.com`;
  const res  = await fetch(url);
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
  const url  = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1wk&range=2y&corsDomain=finance.yahoo.com`;
  const res  = await fetch(url);
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

// ─── Anthropic proxy call ─────────────────────────────────────────────────────
// In production (Vercel), calls /api/analyze which injects the API key server-side.
// In local dev, falls back to direct Anthropic call if VITE_ANTHROPIC_API_KEY is set.
async function callClaude(messages, tools = []) {
  const isDev = import.meta.env.DEV;
  const devKey = import.meta.env.VITE_ANTHROPIC_API_KEY;

  if (isDev && devKey) {
    // Local dev: direct call with key from .env.local
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": devKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "web-search-2025-03-05",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        tools,
        messages,
      }),
    });
    return res.json();
  }

  // Production: call our secure Vercel proxy
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      tools,
      messages,
    }),
  });
  return res.json();
}

// ─── UI primitives ────────────────────────────────────────────────────────────
function Loader({ size=16 }) {
  return <span style={{
    display:"inline-block", width:size, height:size,
    border:`2px solid ${C.border}`, borderTop:`2px solid ${C.accent}`,
    borderRadius:"50%", animation:"spin 0.7s linear infinite", flexShrink:0,
  }}/>;
}

function PctBadge({ v }) {
  if (v == null) return <span style={{color:C.sub,fontSize:13}}>—</span>;
  const pos = v >= 0;
  return (
    <span style={{
      color:pos?C.green:C.red, fontFamily:"'IBM Plex Mono',monospace",
      fontSize:13, fontWeight:600, display:"inline-flex", alignItems:"center", gap:2,
    }}>
      {pos?"▲":"▼"} {Math.abs(v).toFixed(2)}%
    </span>
  );
}

function Sparkline({ data, positive }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data), range = max-min||1;
  const w=72, h=24;
  const pts = data.map((v,i)=>`${(i/(data.length-1))*w},${h-((v-min)/range)*h}`).join(" ");
  return (
    <svg width={w} height={h}>
      <polyline points={pts} fill="none" stroke={positive?C.green:C.red} strokeWidth="1.5" strokeLinejoin="round" opacity={0.85}/>
    </svg>
  );
}

const ChartTip = ({active,payload,label}) => {
  if (!active||!payload?.length) return null;
  return (
    <div style={{background:C.surface,border:`1px solid ${C.border}`,padding:"8px 14px",borderRadius:8}}>
      <div style={{color:C.sub,fontSize:11,marginBottom:3}}>{label}</div>
      <div style={{color:C.text,fontFamily:"'IBM Plex Mono',monospace",fontSize:14,fontWeight:700}}>
        ${payload[0].value?.toFixed(2)}
      </div>
    </div>
  );
};

// ─── Markdown renderer ────────────────────────────────────────────────────────
function renderMd(text) {
  return text.split("\n").map((line,i) => {
    if (!line.trim()) return <div key={i} style={{height:6}}/>;
    if (line.startsWith("## ")) return (
      <div key={i} style={{
        fontFamily:"'DM Serif Display',serif", fontSize:17,
        color:C.accent, marginTop:24, marginBottom:10,
        borderBottom:`1px solid ${C.border}`, paddingBottom:6,
      }}>{line.slice(3)}</div>
    );
    const parts = line.split(/\*\*(.*?)\*\*/g);
    const content = parts.length > 1
      ? parts.map((p,j) => j%2===1
          ? <strong key={j} style={{color:C.text,fontWeight:700}}>{p}</strong>
          : <span key={j}>{p}</span>)
      : line;
    return <div key={i} style={{color:C.sub,fontSize:13.5,lineHeight:1.8,marginBottom:1}}>{content}</div>;
  });
}

// ─── Advisor Panel ────────────────────────────────────────────────────────────
function AdvisorPanel({ tickers, stockData }) {
  const [newsAge,  setNewsAge]  = useState(7);
  const [analysis, setAnalysis] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  const runAnalysis = async () => {
    setLoading(true); setAnalysis(null); setError(null);

    const summary = tickers.map(t => {
      const d = stockData[t];
      if (!d) return `${t}: no data`;
      return `${t} (${d.name}): $${fmt(d.price)}, today ${fmt(d.dayChangePct)}%, 1M ${fmt(d.change1mPct)}%, 1Y ${fmt(d.change1yPct)}%, mktcap ${fmtBig(d.marketCap)}`;
    }).join("\n");

    const prompt = `You are a senior managing director at Goldman Sachs with 25+ years on Wall Street. You have deep expertise in equity research, macro strategy, and sector dynamics across tech, financials, and consumer.

Today is ${new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}.

The client's watchlist (live market data):
${summary}

Use your web search tool to find the most recent news (last ${newsAge} days) on these stocks and the macro environment. Then deliver a sharp, opinionated analysis. No hedging. Speak as a senior banker to a sophisticated institutional client.

Use these exact section headers:

## Market Pulse
Current macro backdrop in 2-3 punchy sentences. What is the dominant market narrative right now?

## 🟢 BUY — Short Term (1–4 weeks)
Pick 2-3 names. For each: bold the ticker, one-line catalyst thesis, key upcoming trigger, entry zone, price target, stop-loss.

## 🔵 BUY — Long Term (6–18 months)
Pick 2-3 names. For each: bold the ticker, structural thesis, competitive moat, 2 risk factors, 12-month price target with upside %.

## 🔴 Reduce / Avoid
1-2 names to trim or avoid right now. Be direct.

## ⚠ Key Risk Factors
3 specific risks (macro, regulatory, or stock-specific) to watch.

## Bottom Line
One definitive sentence. The single most important action for this client today.`;

    try {
      const data = await callClaude(
        [{ role:"user", content:prompt }],
        [{ type:"web_search_20250305", name:"web_search" }]
      );

      if (data.error) throw new Error(data.error.message || "API error");
      const text = data.content?.filter(b=>b.type==="text").map(b=>b.text).join("") || "";
      if (!text) throw new Error("Empty response");
      setAnalysis(text);
    } catch(e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
      {/* Header */}
      <div style={{
        padding:"20px 28px", borderBottom:`1px solid ${C.border}`,
        background:`linear-gradient(135deg,${C.card} 0%,#0d1322 100%)`,
        display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12,
      }}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <div style={{
            width:44,height:44,borderRadius:12,flexShrink:0,
            background:`linear-gradient(135deg,${C.gold},${C.accent})`,
            display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,
          }}>🏦</div>
          <div>
            <div style={{fontFamily:"'DM Serif Display',serif",fontSize:19,color:C.text}}>Wall Street Advisor</div>
            <div style={{fontSize:12,color:C.sub,marginTop:2}}>Senior MD · Web search · Secure proxy</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:C.sub}}>
            News freshness:
            <select value={newsAge} onChange={e=>setNewsAge(Number(e.target.value))} style={{
              background:C.bg,border:`1px solid ${C.border}`,color:C.accent,
              padding:"5px 10px",borderRadius:7,fontSize:12,
              fontFamily:"'IBM Plex Mono',monospace",cursor:"pointer",
            }}>
              {[3,7,14,30].map(d=><option key={d} value={d}>Last {d} days</option>)}
            </select>
          </label>
          <button onClick={runAnalysis} disabled={loading||tickers.length===0} style={{
            background:loading?C.border:`linear-gradient(135deg,${C.gold},${C.accent})`,
            border:"none",color:loading?"#555":"#000",fontWeight:700,fontSize:14,
            padding:"9px 22px",borderRadius:9,cursor:loading?"not-allowed":"pointer",
            display:"flex",alignItems:"center",gap:8,fontFamily:"'DM Sans',sans-serif",
          }}>
            {loading?<><Loader size={14}/> Analyzing…</>:"▶ Run Analysis"}
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{padding:"24px 28px",maxHeight:600,overflowY:"auto",minHeight:220}}>
        {!analysis && !loading && !error && (
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"56px 0",gap:14,color:C.sub}}>
            <div style={{fontSize:38}}>📊</div>
            <div style={{fontSize:15,color:C.sub,textAlign:"center",maxWidth:420}}>
              Click <strong style={{color:C.accent}}>Run Analysis</strong> to get a senior banker's
              take on your {tickers.length}-stock watchlist
            </div>
            <div style={{display:"flex",gap:16,marginTop:8,fontSize:12,flexWrap:"wrap",justifyContent:"center"}}>
              {["📡 Live Yahoo Finance prices","🌐 Real-time web search","🔒 API key secured server-side"].map(f=>(
                <span key={f} style={{background:C.card,border:`1px solid ${C.border}`,padding:"5px 12px",borderRadius:20}}>{f}</span>
              ))}
            </div>
          </div>
        )}
        {loading && (
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"56px 0",gap:16,color:C.sub}}>
            <Loader size={32}/>
            <div style={{fontSize:14}}>Searching markets, scanning news, building thesis…</div>
            <div style={{fontSize:12,opacity:.5}}>Takes ~15–20 seconds</div>
          </div>
        )}
        {error && (
          <div style={{margin:"32px auto",maxWidth:480,padding:"16px 20px",background:C.redDim,border:`1px solid ${C.red}40`,borderRadius:10,color:C.red,fontSize:13}}>
            <strong>Error:</strong> {error}
            <div style={{marginTop:8,fontSize:12,color:C.sub}}>
              Make sure ANTHROPIC_API_KEY is set in your Vercel environment variables.
            </div>
          </div>
        )}
        {analysis && (
          <div style={{animation:"fadeUp .4s ease forwards"}}>
            <div style={{
              display:"flex",alignItems:"center",gap:10,marginBottom:20,
              padding:"10px 16px",background:C.accentDim,
              borderRadius:9,border:`1px solid ${C.gold}35`,
            }}>
              <span style={{fontSize:16}}>⚡</span>
              <span style={{fontSize:12,color:C.accent}}>
                Generated {new Date().toLocaleString()} · Live prices + web search · News window: {newsAge} days
              </span>
            </div>
            {renderMd(analysis)}
            <div style={{
              marginTop:28,padding:"12px 16px",
              background:C.redDim,borderRadius:9,border:`1px solid ${C.red}30`,
              fontSize:11,color:C.sub,lineHeight:1.6,
            }}>
              ⚠ <strong style={{color:C.sub}}>Not financial advice.</strong> AI-generated analysis for informational purposes only. Always conduct your own due diligence.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function StockDashboard() {
  const [tickers,      setTickers]      = useState(DEFAULT_TICKERS);
  const [stockData,    setStockData]    = useState({});
  const [loadingMap,   setLoadingMap]   = useState({});
  const [selected,     setSelected]     = useState(null);
  const [chartData,    setChartData]    = useState(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [addInput,     setAddInput]     = useState("");
  const [lastRefresh,  setLastRefresh]  = useState(null);
  const [tab,          setTab]          = useState("dashboard");

  const loadStock = useCallback(async (ticker, delay=0) => {
    if (delay) await sleep(delay);
    setLoadingMap(p=>({...p,[ticker]:true}));
    try {
      const d = await fetchYahoo(ticker);
      setStockData(p=>({...p,[ticker]:d}));
    } catch {}
    finally { setLoadingMap(p=>({...p,[ticker]:false})); }
  }, []);

  const loadChart = useCallback(async (ticker) => {
    setChartLoading(true); setChartData(null);
    try { setChartData(await fetchChart2Y(ticker)); }
    catch { setChartData([]); }
    finally { setChartLoading(false); }
  }, []);

  useEffect(() => {
    tickers.forEach((t,i) => loadStock(t, i*150));
    setLastRefresh(new Date());
  }, []);

  const handleAdd = () => {
    const t = addInput.trim().toUpperCase().replace(/[^A-Z.]/g,"");
    if (t && !tickers.includes(t)) { setTickers(p=>[...p,t]); loadStock(t); }
    setAddInput("");
  };
  const handleRemove = (e,t) => {
    e.stopPropagation();
    setTickers(p=>p.filter(x=>x!==t));
    if (selected===t) { setSelected(null); setChartData(null); }
  };
  const handleSelect = t => { setSelected(t); loadChart(t); };
  const handleRefresh = () => {
    tickers.forEach((t,i)=>loadStock(t,i*150));
    setLastRefresh(new Date());
    if (selected) loadChart(selected);
  };

  const chartStart = chartData?.[0]?.price;
  const chartEnd   = chartData?.[chartData?.length-1]?.price;
  const chartGain  = chartStart ? ((chartEnd-chartStart)/chartStart*100) : null;
  const chartMin   = chartData?.length ? Math.floor(Math.min(...chartData.map(d=>d.price))*0.96) : undefined;
  const chartMax   = chartData?.length ? Math.ceil(Math.max(...chartData.map(d=>d.price))*1.04) : undefined;

  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"'DM Sans','Segoe UI',sans-serif",padding:"28px 24px 48px"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=IBM+Plex+Mono:wght@400;600;700&family=DM+Serif+Display&display=swap');
        @keyframes spin   { to{transform:rotate(360deg)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        .srow{cursor:pointer;transition:background .12s;}
        .srow:hover{background:#161c28!important;}
        .srow.sel{background:#111a28!important;box-shadow:inset 3px 0 0 ${C.accent};}
        .rm{opacity:0;transition:opacity .15s;}
        .srow:hover .rm{opacity:1;}
        ::-webkit-scrollbar{width:5px} ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px}
        input,select,button{outline:none;}
      `}</style>

      {/* Top Bar */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:28,flexWrap:"wrap",gap:14}}>
        <div>
          <div style={{display:"flex",alignItems:"baseline",gap:12}}>
            <span style={{fontFamily:"'DM Serif Display',serif",fontSize:30,fontWeight:400,letterSpacing:"-0.5px"}}>MarketDesk</span>
            <span style={{
              fontSize:10,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",
              color:C.accent,background:C.accentDim,border:`1px solid ${C.gold}40`,
              padding:"2px 8px",borderRadius:20,
            }}>LIVE</span>
          </div>
          <div style={{fontSize:12,color:C.sub,marginTop:3}}>
            {lastRefresh?`Updated ${lastRefresh.toLocaleTimeString()}`:"Loading…"} · Yahoo Finance
          </div>
        </div>

        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <div style={{display:"flex",background:C.card,border:`1px solid ${C.border}`,borderRadius:9,padding:3,gap:2}}>
            {[["dashboard","📈 Dashboard"],["advisor","🏦 Advisor"]].map(([id,label])=>(
              <button key={id} onClick={()=>setTab(id)} style={{
                padding:"7px 18px",borderRadius:7,fontSize:13,fontWeight:600,cursor:"pointer",
                border:tab===id?`1px solid ${C.gold}40`:"1px solid transparent",
                background:tab===id?C.accentDim:"transparent",
                color:tab===id?C.accent:C.sub,fontFamily:"'DM Sans',sans-serif",transition:"all .15s",
              }}>{label}</button>
            ))}
          </div>
          <div style={{display:"flex",border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
            <input value={addInput} onChange={e=>setAddInput(e.target.value.toUpperCase())}
              onKeyDown={e=>e.key==="Enter"&&handleAdd()} placeholder="Ticker…" maxLength={6}
              style={{background:C.card,border:"none",color:C.text,padding:"8px 12px",
                fontFamily:"'IBM Plex Mono',monospace",fontSize:13,width:100}}/>
            <button onClick={handleAdd} style={{
              background:C.accentDim,border:"none",color:C.accent,padding:"8px 14px",
              cursor:"pointer",fontWeight:700,fontSize:15,borderLeft:`1px solid ${C.border}`,
            }}>＋</button>
          </div>
          <button onClick={handleRefresh} style={{
            background:C.card,border:`1px solid ${C.border}`,color:C.sub,
            padding:"8px 14px",borderRadius:8,cursor:"pointer",fontSize:13,
            fontFamily:"'DM Sans',sans-serif",
          }}>↻ Refresh</button>
        </div>
      </div>

      {/* Dashboard Tab */}
      {tab==="dashboard" && (
        <div style={{display:"grid",gridTemplateColumns:selected?"1fr 400px":"1fr",gap:18,alignItems:"start"}}>
          {/* Table */}
          <div style={{background:C.surface,borderRadius:13,border:`1px solid ${C.border}`,overflow:"hidden"}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead>
                <tr style={{borderBottom:`1px solid ${C.border}`}}>
                  {["","Stock","Price","Today","3 Days","1 Month","1 Year","Vol","Trend"].map((h,i)=>(
                    <th key={i} style={{
                      padding:i===0?"12px 0 12px 14px":"12px 14px",
                      textAlign:i<=1?"left":"right",
                      color:C.sub,fontSize:10,fontWeight:600,
                      textTransform:"uppercase",letterSpacing:"0.1em",whiteSpace:"nowrap",
                    }}>{h}</th>
                  ))}
                  <th style={{width:32}}/>
                </tr>
              </thead>
              <tbody>
                {tickers.map((ticker,idx) => {
                  const d   = stockData[ticker];
                  const ldg = loadingMap[ticker];
                  const sel = selected===ticker;
                  const pos = (d?.dayChangePct??0)>=0;
                  return (
                    <tr key={ticker} className={`srow${sel?" sel":""}`}
                      onClick={()=>handleSelect(ticker)}
                      style={{
                        background:idx%2===0?"transparent":"#0c0f15",
                        borderBottom:`1px solid ${C.grid}`,
                        animation:"fadeUp .3s ease forwards",
                        animationDelay:`${idx*.05}s`,opacity:0,
                      }}>
                      <td style={{padding:"0 0 0 14px",width:4}}>
                        <div style={{width:3,height:34,borderRadius:2,background:d?(pos?C.green:C.red):C.border}}/>
                      </td>
                      <td style={{padding:"13px 14px"}}>
                        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:14,fontWeight:700,color:sel?C.accent:C.text}}>{ticker}</div>
                        <div style={{fontSize:11,color:C.sub,maxWidth:130,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginTop:2}}>{d?.name||"—"}</div>
                      </td>
                      <td style={{padding:"13px 14px",textAlign:"right"}}>
                        {ldg?<Loader size={14}/>:<span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:14,fontWeight:600}}>{d?`$${fmt(d.price)}`:"—"}</span>}
                      </td>
                      <td style={{padding:"13px 14px",textAlign:"right"}}>{ldg?"·":<PctBadge v={d?.dayChangePct}/>}</td>
                      <td style={{padding:"13px 14px",textAlign:"right"}}>{ldg?"·":<PctBadge v={d?.change3dPct}/>}</td>
                      <td style={{padding:"13px 14px",textAlign:"right"}}>{ldg?"·":<PctBadge v={d?.change1mPct}/>}</td>
                      <td style={{padding:"13px 14px",textAlign:"right"}}>{ldg?"·":<PctBadge v={d?.change1yPct}/>}</td>
                      <td style={{padding:"13px 14px",textAlign:"right",color:C.sub,fontSize:12,fontFamily:"'IBM Plex Mono',monospace"}}>{fmtVol(d?.volume)}</td>
                      <td style={{padding:"13px 14px",textAlign:"right"}}><Sparkline data={d?.sparkline} positive={pos}/></td>
                      <td style={{padding:"0 10px 0 0"}}>
                        <button className="rm" onClick={e=>handleRemove(e,ticker)} style={{
                          background:"none",border:"none",color:C.sub,cursor:"pointer",fontSize:17,padding:"4px",lineHeight:1,
                        }}>×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {tickers.length===0&&<div style={{padding:48,textAlign:"center",color:C.sub}}>Add a ticker above to get started</div>}
          </div>

          {/* Chart Panel */}
          {selected && (
            <div style={{
              background:C.surface,border:`1px solid ${C.border}`,borderRadius:13,
              padding:22,display:"flex",flexDirection:"column",gap:18,
              animation:"fadeUp .25s ease forwards",
            }}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div>
                  <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:22,fontWeight:700,color:C.accent}}>{selected}</div>
                  <div style={{fontSize:12,color:C.sub,marginTop:3}}>{stockData[selected]?.name}</div>
                  {stockData[selected]&&(
                    <div style={{marginTop:8,display:"flex",gap:8,alignItems:"baseline"}}>
                      <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:26,fontWeight:700}}>${fmt(stockData[selected].price)}</span>
                      <PctBadge v={stockData[selected].dayChangePct}/>
                    </div>
                  )}
                </div>
                <button onClick={()=>{setSelected(null);setChartData(null);}} style={{
                  background:"none",border:"none",color:C.sub,cursor:"pointer",fontSize:20,padding:4,
                }}>×</button>
              </div>

              {stockData[selected]&&(
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  {[
                    {l:"Market Cap",v:fmtBig(stockData[selected].marketCap)},
                    {l:"Volume",v:fmtVol(stockData[selected].volume)},
                    {l:"2Y Return",v:chartGain!=null?`${chartGain>=0?"+":""}${chartGain.toFixed(1)}%`:"—",c:chartGain>=0?C.green:C.red},
                    {l:"1Y Return",v:`${(stockData[selected].change1yPct??0)>=0?"+":""}${fmt(stockData[selected].change1yPct)}%`,c:(stockData[selected].change1yPct??0)>=0?C.green:C.red},
                  ].map(({l,v,c})=>(
                    <div key={l} style={{background:C.bg,borderRadius:8,padding:"10px 14px",border:`1px solid ${C.border}`}}>
                      <div style={{fontSize:10,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4}}>{l}</div>
                      <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:15,fontWeight:700,color:c||C.text}}>{v}</div>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <div style={{fontSize:10,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:12}}>2-Year Price History</div>
                {chartLoading?(
                  <div style={{height:200,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12}}>
                    <Loader size={24}/><div style={{color:C.sub,fontSize:12}}>Loading chart…</div>
                  </div>
                ):chartData?.length?(
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={chartData} margin={{top:4,right:4,bottom:0,left:-10}}>
                      <defs>
                        <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={chartGain>=0?C.green:C.red} stopOpacity={0.25}/>
                          <stop offset="95%" stopColor={chartGain>=0?C.green:C.red} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                      <XAxis dataKey="date" tick={{fill:C.sub,fontSize:10,fontFamily:"IBM Plex Mono"}} tickLine={false} axisLine={false} interval={7}/>
                      <YAxis domain={[chartMin,chartMax]} tick={{fill:C.sub,fontSize:10,fontFamily:"IBM Plex Mono"}} tickLine={false} axisLine={false} tickFormatter={v=>`$${v}`}/>
                      <Tooltip content={<ChartTip/>}/>
                      {chartStart&&<ReferenceLine y={chartStart} stroke={C.border} strokeDasharray="4 3"/>}
                      <Area type="monotone" dataKey="price"
                        stroke={chartGain>=0?C.green:C.red} strokeWidth={2} fill="url(#ag)" dot={false}
                        activeDot={{r:4,fill:chartGain>=0?C.green:C.red,stroke:C.bg,strokeWidth:2}}/>
                    </AreaChart>
                  </ResponsiveContainer>
                ):(
                  <div style={{height:200,display:"flex",alignItems:"center",justifyContent:"center",color:C.sub,fontSize:12}}>Could not load chart data</div>
                )}
              </div>
              <div style={{fontSize:10,color:C.sub,textAlign:"center",borderTop:`1px solid ${C.border}`,paddingTop:12}}>
                Yahoo Finance · {stockData[selected]?.exchange} · {stockData[selected]?.currency}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Advisor Tab */}
      {tab==="advisor"&&<AdvisorPanel tickers={tickers} stockData={stockData}/>}
    </div>
  );
}
