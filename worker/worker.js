// Stock Lens API：只呼叫固定的上游（Yahoo / SEC / Google News / Google 翻譯），不是開放代理
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const SEC_UA = "StockLens research stocklens.app@outlook.com";
const ORIGINS = ["https://mrkingwayne.github.io", "http://localhost:8765"];
const TTL = 1800;
const FIX = [["特朗普","川普"],["英偉達","輝達"],["美聯儲","聯準會"],["數據中心","資料中心"],["芯片","晶片"],["人工智能","人工智慧"],["軟件","軟體"],["網絡","網路"],["視頻","影片"],["信息","資訊"],["普京","普丁"]];
const THEMES = [["AI 人工智慧",/\bAI\b|artificial intelligence|generative|LLM|chatbot/i],["資料中心",/data ?cent/i],["半導體/晶片",/chip|semiconductor|GPU|wafer|foundry/i],["國防/軍工",/defen[cs]e|military|Pentagon|missile|fighter jet|F-35|army|navy|drone/i],["電動車",/\bEV\b|electric vehicle/i],["自駕/機器人",/robotaxi|self-driving|autonomous|FSD|robot|humanoid|Optimus/i],["能源/電力",/energy|power grid|nuclear|solar|utility|electricity|oil|gas/i],["雲端/軟體",/cloud|software|SaaS|AWS|Azure/i],["減重藥/生技",/GLP-1|obesity|FDA|drug|trial|biotech/i],["加密貨幣",/bitcoin|crypto|blockchain/i],["關稅/貿易",/tariff|trade war|export (ban|control)|China/i],["財報",/earnings|quarter|revenue|guidance|EPS/i],["訂單/合約",/contract|order|backlog|deal|award/i],["併購",/acqui|merger|buyout|takeover/i],["裁員/重組",/layoff|job cuts|restructur/i],["股票回購/股利",/buyback|repurchase|dividend/i],["分析師評等",/upgrade|downgrade|price target|analyst|rating/i]];
const REV_TAGS = ["RevenueFromContractWithCustomerExcludingAssessedTax","Revenues","SalesRevenueNet","RevenueFromContractWithCustomerIncludingAssessedTax","SalesRevenueGoodsNet"];
const raw = v => v == null ? null : (typeof v === "object" ? (v.raw ?? null) : v);
const day = s => new Date(s * 1000).toISOString().slice(0, 10);

async function cached(key, ttl, fn) {
  const c = caches.default, req = new Request("https://cache.stocklens/" + encodeURIComponent(key));
  const hit = await c.match(req); if (hit) return hit.json();
  const v = await fn(); if (v != null) await c.put(req, new Response(JSON.stringify(v), { headers: { "Cache-Control": "max-age=" + ttl } }));
  return v;
}
async function crumb() {
  return cached("yahoo-crumb", 3600, async () => {
    const r = await fetch("https://fc.yahoo.com/", { headers: { "User-Agent": UA }, redirect: "manual" });
    const ck = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get("set-cookie")]).filter(Boolean).map(x => x.split(";")[0]).join("; ");
    const c = await (await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { "User-Agent": UA, Cookie: ck } })).text();
    if (!c || c.includes("<") || c.length > 30) return null;
    return { ck, c };
  });
}
async function summary(t) {
  const cr = await crumb(); if (!cr) return {};
  const m = "assetProfile,summaryDetail,financialData,defaultKeyStatistics,price,earningsHistory,calendarEvents,earningsTrend,incomeStatementHistoryQuarterly";
  const r = await fetch(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${t}?modules=${m}&crumb=${encodeURIComponent(cr.c)}`, { headers: { "User-Agent": UA, Cookie: cr.ck } });
  if (!r.ok) return {};
  return ((await r.json()).quoteSummary?.result || [])[0] || {};
}
async function chart(t) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${t}?range=2y&interval=1d`, { headers: { "User-Agent": UA } });
  if (!r.ok) return null;
  const x = (await r.json()).chart?.result?.[0]; if (!x || !x.timestamp) return null;
  const q = x.indicators.quote[0], off = x.meta.gmtoffset || 0;
  const c = x.timestamp.map((s, i) => ({ t: day(s + off), o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] || 0 })).filter(k => k.c != null && k.o != null);
  return { meta: x.meta, candles: c.slice(-295) };
}
async function cikOf(t) {
  const map = await cached("sec-tickers", 86400, async () => {
    const d = await (await fetch("https://www.sec.gov/files/company_tickers.json", { headers: { "User-Agent": SEC_UA } })).json();
    const o = {}; for (const v of Object.values(d)) o[v.ticker.toUpperCase()] = v.cik_str; return o;
  });
  return map[t] || map[t.replace("-", ".")] || null;
}
async function sec(t) {
  const out = { cik: null, rev_q: [], rev_y: [], rpo: [], backlog: [], rev_tag: null };
  const cik = await cikOf(t); if (!cik) return out; out.cik = cik;
  const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`, { headers: { "User-Agent": SEC_UA } });
  if (!r.ok) return out;
  const d = await r.json(), g = d.facts?.["us-gaap"] || {};
  let best = null;
  for (const tag of REV_TAGS) { const u = g[tag]?.units?.USD || []; if (!u.length) continue; const last = u.reduce((a, x) => x.end > a ? x.end : a, ""); if (!best || last > best[1]) best = [tag, last, u]; }
  if (best) {
    const [tag, , u] = best; out.rev_tag = tag; const q = {}, y = {};
    for (const x of u) { if (!x.start) continue; const dd = (new Date(x.end) - new Date(x.start)) / 864e5; if (dd >= 80 && dd <= 100) q[x.end] = x.val; else if (dd >= 350 && dd <= 380) y[x.end] = [x.val, x.start]; }
    for (const [e, [v, s]] of Object.entries(y)) { if (q[e] != null) continue; const qs = Object.entries(q).filter(([k]) => k > s && k < e); if (qs.length === 3) q[e] = v - qs.reduce((a, [, b]) => a + b, 0); }
    out.rev_q = Object.keys(q).sort().slice(-12).map(k => ({ end: k, val: q[k] }));
    out.rev_y = Object.keys(y).sort().slice(-6).map(k => ({ end: k, val: y[k][0] }));
  }
  const seen = {}; for (const x of g.RevenueRemainingPerformanceObligation?.units?.USD || []) if (!x.start) seen[x.end] = x.val;
  out.rpo = Object.keys(seen).sort().slice(-8).map(k => ({ end: k, val: seen[k] }));
  for (const facts of Object.values(d.facts || {})) for (const [tag, v] of Object.entries(facts)) {
    if (!/backlog/i.test(tag)) continue; const s = {}; for (const x of v.units?.USD || []) if (!x.start) s[x.end] = x.val;
    const ks = Object.keys(s).sort(); if (ks.length) out.backlog.push({ tag, label: v.label, series: ks.slice(-8).map(k => ({ end: k, val: s[k] })) });
  }
  out.backlog = out.backlog.sort((a, b) => b.series.at(-1).end.localeCompare(a.series.at(-1).end)).slice(0, 3);
  return out;
}
const unesc = s => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
function parseRss(x) {
  return [...x.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const g = k => unesc((m[1].match(new RegExp(`<${k}[^>]*>([\\s\\S]*?)</${k}>`)) || [])[1] || "");
    const pd = new Date(g("pubDate")); let link = g("link");
    try { const u = new URL(link); if (u.hostname.endsWith("bing.com") && u.searchParams.get("url")) link = u.searchParams.get("url"); } catch (e) {}
    return { title: g("title").replace(/\s+-\s+[^-]+$/, ""), src: g("source") || g("News:Source"), url: link, date: isNaN(pd) ? "" : pd.toISOString().slice(0, 10) };
  });
}
async function news(q, n) {
  let items = [];
  try {
    const r = await fetch("https://news.google.com/rss/search?" + new URLSearchParams({ q: q + " when:30d", hl: "en-US", gl: "US", ceid: "US:en" }), { headers: { "User-Agent": UA } });
    if (r.ok) items = parseRss(await r.text());
  } catch (e) {}
  if (!items.length) {
    const r = await fetch("https://www.bing.com/news/search?" + new URLSearchParams({ q, format: "rss", qft: 'interval="9"' }), { headers: { "User-Agent": UA } });
    if (r.ok) items = parseRss(await r.text());
  }
  return items.sort((a, b) => b.date.localeCompare(a.date)).slice(0, n);
}
async function zh(lines) {
  const out = new Array(lines.length).fill(null), idx = lines.map((l, i) => [l, i]).filter(([l]) => l);
  for (let i = 0; i < idx.length; i += 12) {
    const ch = idx.slice(i, i + 12);
    try {
      const r = await fetch("https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=zh-TW&" + ch.map(([l]) => "q=" + encodeURIComponent(l.slice(0, 1500))).join("&"), { headers: { "User-Agent": UA } });
      const j = await r.json();
      j.forEach((v, k) => { let s = typeof v === "string" ? v : v[0]; for (const [a, b] of FIX) s = s.split(a).join(b); out[ch[k][1]] = s; });
    } catch (e) {}
  }
  return out;
}
async function build(t) {
  const ch = await chart(t); if (!ch || ch.candles.length < 30) return null;
  const [S, SE] = await Promise.all([summary(t).catch(() => ({})), sec(t).catch(() => ({ rev_q: [], rev_y: [], rpo: [], backlog: [] }))]);
  const ap = S.assetProfile || {}, sd = S.summaryDetail || {}, fd = S.financialData || {}, ks = S.defaultKeyStatistics || {}, pr = S.price || {};
  const profile = { longName: pr.longName || ch.meta.longName, shortName: pr.shortName || ch.meta.shortName || t, sector: ap.sector, industry: ap.industry, country: ap.country, website: ap.website,
    fullTimeEmployees: ap.fullTimeEmployees, marketCap: raw(pr.marketCap) ?? raw(sd.marketCap), trailingPE: raw(sd.trailingPE), forwardPE: raw(sd.forwardPE) ?? raw(ks.forwardPE),
    priceToSalesTrailing12Months: raw(sd.priceToSalesTrailing12Months), targetMeanPrice: raw(fd.targetMeanPrice), targetHighPrice: raw(fd.targetHighPrice), targetLowPrice: raw(fd.targetLowPrice),
    numberOfAnalystOpinions: raw(fd.numberOfAnalystOpinions), recommendationKey: fd.recommendationKey, revenueGrowth: raw(fd.revenueGrowth), earningsGrowth: raw(fd.earningsGrowth),
    grossMargins: raw(fd.grossMargins), operatingMargins: raw(fd.operatingMargins), profitMargins: raw(fd.profitMargins), totalRevenue: raw(fd.totalRevenue), beta: raw(sd.beta),
    fiftyTwoWeekHigh: raw(sd.fiftyTwoWeekHigh) ?? ch.meta.fiftyTwoWeekHigh, fiftyTwoWeekLow: raw(sd.fiftyTwoWeekLow) ?? ch.meta.fiftyTwoWeekLow, currency: pr.currency || ch.meta.currency,
    exchange: pr.exchangeName || ch.meta.exchangeName, quoteType: pr.quoteType || ch.meta.instrumentType };
  const earnings = (S.earningsHistory?.history || []).map(h => ({ date: h.quarter?.fmt || "", est: raw(h.epsEstimate), act: raw(h.epsActual), surp: raw(h.surprisePercent) != null ? raw(h.surprisePercent) * 100 : null })).reverse();
  const nx = S.calendarEvents?.earnings; if (nx?.earningsDate?.[0]) earnings.unshift({ date: nx.earningsDate[0].fmt, est: raw(nx.earningsAverage), act: null, surp: null });
  const quarterly = (S.incomeStatementHistoryQuarterly?.incomeStatementHistory || []).map(q => ({ end: q.endDate?.fmt, rev: raw(q.totalRevenue), gp: raw(q.grossProfit), op: raw(q.operatingIncome), ni: raw(q.netIncome), eps: null }));
  if (quarterly[0] && earnings.find(e => e.act != null)) quarterly[0].eps = earnings.find(e => e.act != null).act;
  const est = { revenue_estimate: {}, earnings_estimate: {} };
  for (const tr of S.earningsTrend?.trend || []) { est.revenue_estimate[tr.period] = { avg: raw(tr.revenueEstimate?.avg), growth: raw(tr.revenueEstimate?.growth), numberOfAnalysts: raw(tr.revenueEstimate?.numberOfAnalysts) }; est.earnings_estimate[tr.period] = { avg: raw(tr.earningsEstimate?.avg), growth: raw(tr.earningsEstimate?.growth) }; }
  const cname = (profile.shortName || t).replace(/,? (Inc|Corp|Corporation|Company|Co|Ltd|plc|N\.V\.|Holdings?)\.?$/i, "").trim();
  const [nw, ow] = await Promise.all([news(`"${t}" stock`, 12).catch(() => []), news(`"${cname}" (contract OR order OR backlog OR guidance OR deal)`, 8).catch(() => [])]);
  const all = [...nw, ...ow], titles = all.map(x => x.title);
  const themes = THEMES.map(([name, re]) => ({ name, count: titles.filter(x => re.test(x)).length })).filter(x => x.count).sort((a, b) => b.count - a.count).slice(0, 8);
  const summ = (ap.longBusinessSummary || "").slice(0, 1400);
  const tr = await zh([...titles, summ, profile.sector || "", profile.industry || ""]);
  all.forEach((x, i) => x.zh = tr[i]); const n = titles.length;
  return { ticker: t, source: "worker", updated: new Date().toISOString(), profile, summary: summ, summary_zh: tr[n], sector_zh: tr[n + 1], industry_zh: tr[n + 2], candles: ch.candles, earnings, quarterly, estimates: est, sec: SE, news: nw, order_news: ow, themes };
}
export default {
  async fetch(req, env, ctx) {
    const o = req.headers.get("Origin"), cors = { "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0], "Access-Control-Allow-Methods": "GET", "Vary": "Origin" };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(req.url), t = (url.searchParams.get("t") || "").toUpperCase().replace(".", "-");
    if (url.pathname !== "/api/stock" || !/^[A-Z0-9^-]{1,10}$/.test(t)) return new Response(JSON.stringify({ error: "用法：/api/stock?t=NVDA" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    const cache = caches.default, key = new Request("https://cache.stocklens/stock/v2/" + t);
    let r = await cache.match(key);
    if (!r) {
      let d = null; try { d = await build(t); } catch (e) { return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { ...cors, "Content-Type": "application/json" } }); }
      if (!d) return new Response(JSON.stringify({ error: "找不到代號 " + t }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
      r = new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=" + TTL } });
      ctx.waitUntil(cache.put(key, r.clone()));
    }
    const out = new Response(r.body, r); for (const [k, v] of Object.entries(cors)) out.headers.set(k, v); return out;
  }
};
