// 「這間公司在做什麼」：SEC 最新 10-K（Item 1 業務說明 + iXBRL 分部營收）＋ Yahoo 同類股
const SEC_UA2 = "StockLens research stocklens.app@outlook.com";
const AX = { "us-gaap:StatementBusinessSegmentsAxis": "seg", "srt:ProductOrServiceAxis": "prod", "srt:StatementGeographicalAxis": "geo" };
const REV = /^us-gaap:(Revenues|RevenueFromContractWithCustomerExcludingAssessedTax|RevenueFromContractWithCustomerIncludingAssessedTax|SalesRevenueNet)$/;
const human = m => m.replace(/^[a-z-]+:/, "").replace(/Member$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/\bAnd\b/g, "&").replace(/^I (Phone|Pad)/, "i$1").replace(/Homeand/, "Home and").trim();
const ent = s => s.replace(/&nbsp;|&#160;|&#xa0;/gi, " ").replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"').replace(/&#8212;|&mdash;/g, "—").replace(/&#8211;|&ndash;/g, "–").replace(/&#\d+;/g, " ").replace(/&[a-z]+;/g, " ");
const GL = { US: "美國", "United States": "美國", TW: "台灣", Taiwan: "台灣", CN: "中國", China: "中國", "China Including Hong Kong": "中國（含香港）", Gaming: "遊戲", Automotive: "汽車", "Professional Visualization": "專業視覺化", "Data Center": "資料中心", Compute: "運算", Networking: "網通", "Compute & Networking": "運算與網通", Graphics: "繪圖", "Client & Gaming": "客戶端與遊戲", Datacenter: "資料中心", Embedded: "嵌入式", "Other Region": "其他地區", "Sales & Services": "銷售與服務", "OEM & Other": "OEM 與其他", Product: "產品", Products: "產品", Service: "服務", Services: "服務", Europe: "歐洲", "Asia Pacific": "亞太", "Middle East": "中東", "Other Countries": "其他國家", Americas: "美洲", Japan: "日本", "Greater China": "大中華區", "Rest Of Asia Pacific": "亞太其他地區", Mac: "Mac", iPhone: "iPhone", iPad: "iPad", "Wearables Home and Accessories": "穿戴、居家與配件", Aeronautics: "航空", Space: "太空", "Missiles & Fire Control": "飛彈與火控", "Rotary & Mission Systems": "旋翼與任務系統", International: "國際", Other: "其他", "Non US": "美國以外", NonUS: "美國以外", SG: "新加坡", KR: "韓國", JP: "日本", DE: "德國", GB: "英國", IE: "愛爾蘭", IN: "印度", CA: "加拿大", MX: "墨西哥", "Energy Generation & Storage": "能源發電與儲存", "Automotive Sales": "汽車銷售", "Automotive Leasing": "汽車租賃", "Automotive Regulatory Credits": "汽車碳權" };
export async function latest10K(cik) {
  const d = await (await fetch(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`, { headers: { "User-Agent": SEC_UA2 } })).json();
  const r = d.filings.recent;
  for (let i = 0; i < r.form.length; i++) if (["10-K", "20-F", "40-F"].includes(r.form[i]) && r.primaryDocument[i])
    return { form: r.form[i], date: r.filingDate[i], period: r.reportDate[i], url: `https://www.sec.gov/Archives/edgar/data/${cik}/${r.accessionNumber[i].replace(/-/g, "")}/${r.primaryDocument[i]}` };
  return null;
}
function segments(doc) {
  const ctx = {};
  for (const m of doc.matchAll(/<xbrli:context id="([^"]+)">([\s\S]*?)<\/xbrli:context>/g)) {
    const b = m[2], mem = [...b.matchAll(/<xbrldi:explicitMember dimension="([^"]+)">([^<]+)</g)];
    const s = (b.match(/<xbrli:startDate>([^<]+)/) || [])[1], e = (b.match(/<xbrli:endDate>([^<]+)/) || [])[1];
    if (!s || !e) continue; const days = (new Date(e) - new Date(s)) / 864e5; if (days < 350 || days > 380) continue;
    if (mem.length === 0) ctx[m[1]] = { ax: "total", e };
    else if (mem.length === 2 && mem.some(x => x[1] === "srt:ConsolidationItemsAxis" && /OperatingSegmentsMember/.test(x[2]))) { const o = mem.find(x => AX[x[1]]); if (o) ctx[m[1]] = { ax: AX[o[1]], mem: o[2], e }; }
    else if (mem.length === 1 && AX[mem[0][1]]) ctx[m[1]] = { ax: AX[mem[0][1]], mem: mem[0][2], e };
  }
  const out = { seg: {}, prod: {}, geo: {}, total: {} };
  for (const m of doc.matchAll(/<ix:nonFraction([^>]*)>([\s\S]*?)<\/ix:nonFraction>/g)) {
    const a = m[1], name = (a.match(/name="([^"]+)"/) || [])[1]; if (!name || !REV.test(name)) continue;
    const c = ctx[(a.match(/contextRef="([^"]+)"/) || [])[1]]; if (!c) continue;
    let v = parseFloat(m[2].replace(/<[^>]+>/g, "").replace(/[,\s$]/g, "")); if (isNaN(v)) continue;
    const sc = +((a.match(/scale="(-?\d+)"/) || [])[1] || 0); v *= 10 ** sc; if (/sign="-"/.test(a)) v = -v;
    const k = c.ax === "total" ? "total" : c.mem;
    (out[c.ax][c.e] ||= {})[k] = Math.max(out[c.ax][c.e][k] || 0, v);
  }
  const res = {};
  for (const ax of ["seg", "prod", "geo"]) {
    const ends = Object.keys(out[ax]).sort(); if (!ends.length) continue; const e = ends.at(-1);
    const items = Object.entries(out[ax][e]).map(([m, v]) => ({ name: human(m), val: v })).filter(x => x.val > 0 && !/Elimination|Intersegment|Corporate|Reconcil|Operating Segments$/i.test(x.name)).sort((a, b) => b.val - a.val);
    const tot = (out.total[e] || {}).total, sum = items.reduce((a, x) => a + x.val, 0);
    let it2 = items; if (tot && sum > tot * 1.05 && items.length > 2) it2 = items.filter(x => !/^(Products?|Product & Service)$/i.test(x.name));
    if (it2.length >= 2) res[ax] = { end: e, items: it2.slice(0, 10), total: (out.total[e] || {}).total || null };
  }
  return res;
}
function item1(doc) {
  let t = doc.replace(/<ix:header>[\s\S]*?<\/ix:header>/, "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|div|tr|li|h\d)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
  t = ent(t).replace(/[ \t]+/g, " ").replace(/\n\s*/g, "\n");
  const hs = [...t.matchAll(/item\s*1\.?\s*[\n ]?\s*business\b/gi)].map(m => m.index);
  let best = null;
  for (const h of hs) { const e = t.slice(h).search(/item\s*1a\.?\s*[\n ]?\s*risk\s*factors/i); if (e > 3000) { best = t.slice(h, h + e); break; } }
  if (!best) return null;
  const paras = best.split("\n").map(x => x.trim()).filter(Boolean);
  const long = paras.filter(p => p.length > 150 && !/forward-looking statements|incorporated (herein )?by reference/i.test(p));
  const pick = (re, n) => { const i = paras.findIndex(p => p.length < 60 && re.test(p)); if (i < 0) return []; return paras.slice(i + 1).filter(p => p.length > 120).slice(0, n); };
  const cap = a => a.map(p => p.slice(0, 900));
  return {
    overview: cap(long.slice(0, 3)),
    markets: cap(pick(/^(our )?(markets?|products?|products and services|segments?|our businesses|business segments)( and .*)?$/i, 2)),
    customers: cap(pick(/^(our )?customers?( and .*)?$|^sales and marketing$|^customer concentration/i, 2).concat(long.filter(p => /customer/i.test(p) && /(\d+%|percent)/.test(p)).slice(0, 1))).slice(0, 2),
    competition: cap(pick(/^competition$|^competitive (environment|landscape|conditions)$/i, 2)),
  };
}
export async function biz(t, cik, crumbFn, UA, zh, cached) {
  const out = { tenk: null, overview: [], markets: [], customers: [], competition: [], segments: {}, peers: [] };
  try {
    const r = await fetch(`https://query2.finance.yahoo.com/v6/finance/recommendationsbysymbol/${t}`, { headers: { "User-Agent": UA } });
    out.peers = ((await r.json()).finance?.result?.[0]?.recommendedSymbols || []).map(x => x.symbol).slice(0, 6);
  } catch (e) {}
  if (!cik) return out;
  const k = await latest10K(cik); if (!k) return out; out.tenk = k;
  const doc = await (await fetch(k.url, { headers: { "User-Agent": SEC_UA2 } })).text();
  out.segments = segments(doc);
  const it = item1(doc) || {};
  for (const f of ["overview", "markets", "customers", "competition"]) out[f] = (it[f] || []).map(en => ({ en }));
  const all = [...out.overview, ...out.markets, ...out.customers, ...out.competition];
  const names = []; for (const ax of Object.values(out.segments)) for (const i of ax.items) names.push(i);
  const tr = await zh([...all.map(x => x.en), ...names.map(x => x.name)]);
  all.forEach((x, i) => x.zh = tr[i]); names.forEach((x, i) => { const k = x.name.replace(/ Segment$/, ""); x.zh = GL[k] || (k !== x.name && GL[k]) || (tr[all.length + i] || "").replace(/(部分|板塊|領域)$/, "部門").replace(/^我們$/, "美國") || k; x.name = k; });
  return out;
}
