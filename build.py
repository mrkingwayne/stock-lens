#!/usr/bin/env python3
"""Stock Lens 資料建置：yfinance(價格/財報/預估) + SEC EDGAR XBRL(營收/RPO/backlog) + Google News RSS(新聞)，翻成繁中，輸出 site/data/{T}.json"""
import json, os, re, sys, time, math, html, urllib.request, urllib.parse, xml.etree.ElementTree as ET, datetime as dt
import yfinance as yf
BASE = os.path.dirname(os.path.abspath(__file__)); OUT = os.environ.get("STOCKLENS_OUT") or os.path.join(BASE, "site", "data"); os.makedirs(OUT, exist_ok=True)
SEC_UA = {"User-Agent": "StockLens research stocklens.app@outlook.com"}
CF = os.path.join(BASE, "tcache.json"); TC = json.load(open(CF)) if os.path.exists(CF) else {}
FIX = [("特朗普","川普"),("英偉達","輝達"),("美聯儲","聯準會"),("數據中心","資料中心"),("芯片","晶片"),("人工智能","人工智慧"),("軟件","軟體"),("網絡","網路"),("視頻","影片"),("信息","資訊"),("普京","普丁")]
def get(u, h=None, t=25):
    return urllib.request.urlopen(urllib.request.Request(u, headers=h or {"User-Agent": "Mozilla/5.0"}), timeout=t).read()
def _c5(chunk):
    q = "&".join("q=" + urllib.parse.quote(x) for x in chunk)
    r = json.loads(get("https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=zh-TW&" + q))
    return [x if isinstance(x, str) else x[0] for x in r]
def zh_many(lines):
    need = [l for l in dict.fromkeys(lines) if l and l not in TC]
    for i in range(0, len(need), 12):
        ch = need[i:i+12]
        try:
            r = _c5(ch)
            if len(r) == len(ch):
                for a, b in zip(ch, r):
                    for x, y in FIX: b = b.replace(x, y)
                    TC[a] = b.strip()
        except Exception as e: print("  c5 fail", e)
    from deep_translator import GoogleTranslator
    need = [l for l in dict.fromkeys(lines) if l and l not in TC]
    i = 0
    while i < len(need):
        chunk = []; n = 0
        while i < len(need) and n + len(need[i]) < 3500: chunk.append(need[i].replace("\n", " ")); n += len(need[i]) + 1; i += 1
        if not chunk: chunk = [need[i][:3500]]; i += 1
        try:
            r = GoogleTranslator(source="en", target="zh-TW").translate("\n".join(chunk)).split("\n")
            if len(r) == len(chunk):
                for a, b in zip(chunk, r):
                    for x, y in FIX: b = b.replace(x, y)
                    TC[a] = b.strip()
        except Exception as e: print("  translate fail", e); time.sleep(2)
    return [TC.get(l) for l in lines]
_TK = None
def cik_of(t):
    global _TK
    if _TK is None:
        d = json.loads(get("https://www.sec.gov/files/company_tickers.json", SEC_UA)); _TK = {v["ticker"].upper(): v["cik_str"] for v in d.values()}
    return _TK.get(t.replace(".", "-")) or _TK.get(t)
def f(x):
    try:
        x = float(x); return None if math.isnan(x) or math.isinf(x) else x
    except Exception: return None
REV_TAGS = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueGoodsNet"]
def sec_block(t):
    out = {"cik": None, "rev_q": [], "rev_y": [], "rpo": [], "backlog": [], "rev_tag": None}
    c = cik_of(t)
    if not c: return out
    out["cik"] = c
    d = json.loads(get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{c:010d}.json", SEC_UA, 40)); g = d.get("facts", {}).get("us-gaap", {})
    best = None
    for tag in REV_TAGS:
        u = g.get(tag, {}).get("units", {}).get("USD", [])
        if not u: continue
        last = max(x["end"] for x in u)
        if best is None or last > best[1]: best = (tag, last, u)
    if best:
        tag, _, u = best; out["rev_tag"] = tag
        def dur(x): return (dt.date.fromisoformat(x["end"]) - dt.date.fromisoformat(x["start"])).days
        q = {}; y = {}; nine = {}
        for x in u:
            if "start" not in x: continue
            dd = dur(x)
            if 80 <= dd <= 100: q[x["end"]] = x["val"]
            elif 350 <= dd <= 380: y[x["end"]] = (x["val"], x.get("fy"), x["start"])
        # Q4 = 年度 - 前三季
        for e, (v, fy, s) in y.items():
            if e in q: continue
            qs = [qv for qe, qv in q.items() if s < qe < e]
            if len(qs) == 3: q[e] = v - sum(qs)
        out["rev_q"] = [{"end": k, "val": q[k]} for k in sorted(q)][-12:]
        out["rev_y"] = [{"end": k, "val": y[k][0]} for k in sorted(y)][-6:]
    for tag in ["RevenueRemainingPerformanceObligation"]:
        u = g.get(tag, {}).get("units", {}).get("USD", [])
        seen = {}
        for x in u:
            if "start" not in x or x.get("frame", "").endswith("I"): seen[x["end"]] = x["val"]
        out["rpo"] = [{"end": k, "val": seen[k]} for k in sorted(seen)][-8:]
    for tx, facts in d.get("facts", {}).items():
        for tag, v in facts.items():
            if "backlog" in tag.lower() or "orderbacklog" in tag.lower():
                u = v.get("units", {}).get("USD", [])
                if not u: continue
                seen = {x["end"]: x["val"] for x in u if "start" not in x}
                if seen: out["backlog"].append({"tag": tag, "label": v.get("label"), "series": [{"end": k, "val": seen[k]} for k in sorted(seen)][-8:]})
    out["backlog"] = sorted(out["backlog"], key=lambda b: b["series"][-1]["end"], reverse=True)[:3]
    return out
def news(q, n=10):
    u = "https://news.google.com/rss/search?" + urllib.parse.urlencode({"q": q + " when:30d", "hl": "en-US", "gl": "US", "ceid": "US:en"})
    r = ET.fromstring(get(u)); items = []
    for it in r.iter("item"):
        ti = html.unescape(it.findtext("title") or ""); src = it.findtext("source") or ""
        ti = re.sub(r"\s+-\s+[^-]+$", "", ti)
        try: pd_ = dt.datetime.strptime(it.findtext("pubDate"), "%a, %d %b %Y %H:%M:%S %Z").strftime("%Y-%m-%d")
        except Exception: pd_ = ""
        items.append({"title": ti, "src": src, "url": it.findtext("link"), "date": pd_})
    items.sort(key=lambda x: x["date"], reverse=True)
    return items[:n]
THEMES = [("AI 人工智慧", r"\bAI\b|artificial intelligence|generative|LLM|chatbot"), ("資料中心", r"data ?cent"), ("半導體/晶片", r"chip|semiconductor|GPU|wafer|foundry"),
    ("國防/軍工", r"defen[cs]e|military|Pentagon|missile|fighter jet|F-35|army|navy"), ("電動車", r"\bEV\b|electric vehicle"), ("自駕/機器人", r"robotaxi|self-driving|autonomous|FSD|robot|humanoid|Optimus"),
    ("能源/電力", r"energy|power grid|nuclear|solar|utility|electricity|oil|gas"), ("雲端/軟體", r"cloud|software|SaaS|AWS|Azure"), ("減重藥/生技", r"GLP-1|obesity|FDA|drug|trial|biotech"),
    ("加密貨幣", r"bitcoin|crypto|blockchain"), ("關稅/貿易", r"tariff|trade war|export (ban|control)|China"), ("財報", r"earnings|quarter|revenue|guidance|EPS"),
    ("訂單/合約", r"contract|order|backlog|deal|award"), ("併購", r"acqui|merger|buyout|takeover"), ("裁員/重組", r"layoff|job cuts|restructur"), ("股票回購/股利", r"buyback|repurchase|dividend"),
    ("分析師評等", r"upgrade|downgrade|price target|analyst|rating")]
def build(t):
    t = t.upper().strip(); tk = yf.Ticker(t)
    h = tk.history(period="14mo", interval="1d", auto_adjust=False)
    if h is None or h.empty: raise RuntimeError("no price")
    candles = [{"t": i.strftime("%Y-%m-%d"), "o": round(r.Open, 4), "h": round(r.High, 4), "l": round(r.Low, 4), "c": round(r.Close, 4), "v": int(r.Volume or 0)} for i, r in h.iterrows() if f(r.Close)]
    try: info = tk.info or {}
    except Exception: info = {}
    keys = ["longName", "shortName", "sector", "industry", "country", "website", "fullTimeEmployees", "marketCap", "trailingPE", "forwardPE", "priceToSalesTrailing12Months", "pegRatio",
            "targetMeanPrice", "targetHighPrice", "targetLowPrice", "numberOfAnalystOpinions", "recommendationKey", "revenueGrowth", "earningsGrowth", "grossMargins", "operatingMargins", "profitMargins",
            "totalRevenue", "beta", "fiftyTwoWeekHigh", "fiftyTwoWeekLow", "currency", "exchange", "quoteType", "dividendYield"]
    prof = {k: info.get(k) for k in keys}
    summ = (info.get("longBusinessSummary") or "")[:1400]
    earn = []
    try:
        ed = tk.earnings_dates
        if ed is not None:
            for i, r in ed.head(10).iterrows(): earn.append({"date": i.strftime("%Y-%m-%d"), "est": f(r.get("EPS Estimate")), "act": f(r.get("Reported EPS")), "surp": f(r.get("Surprise(%)"))})
    except Exception as e: print("  earn", e)
    qis = []
    try:
        q = tk.quarterly_income_stmt
        for c in q.columns:
            g = lambda k: f(q.loc[k, c]) if k in q.index else None
            qis.append({"end": c.strftime("%Y-%m-%d"), "rev": g("Total Revenue"), "gp": g("Gross Profit"), "op": g("Operating Income"), "ni": g("Net Income"), "eps": g("Diluted EPS")})
    except Exception as e: print("  qis", e)
    est = {}
    for name in ["revenue_estimate", "earnings_estimate"]:
        try:
            df = getattr(tk, name)
            if df is not None and not df.empty: est[name] = {str(i): {k: f(v) for k, v in r.items()} for i, r in df.iterrows()}
        except Exception: pass
    try: sec = sec_block(t)
    except Exception as e: print("  sec", e); sec = {"cik": None, "rev_q": [], "rev_y": [], "rpo": [], "backlog": []}
    nm = prof.get("shortName") or t
    cname = re.sub(r",? (Inc|Corp|Corporation|Company|Co|Ltd|plc|N\.V\.|Holdings?)\.?$", "", nm or "", flags=re.I).strip()
    nw = news(f'"{t}" stock', 12) if True else []
    try: ow = news(f'"{cname}" (contract OR order OR backlog OR guidance OR deal)', 8)
    except Exception: ow = []
    allt = [x["title"] for x in nw + ow]
    themes = []
    for nme, pat in THEMES:
        hits = [x for x in allt if re.search(pat, x, re.I)]
        if hits: themes.append({"name": nme, "count": len(hits)})
    themes.sort(key=lambda x: -x["count"])
    tr = zh_many(allt + [summ, prof.get("sector") or "", prof.get("industry") or ""])
    for x, z in zip(nw + ow, tr): x["zh"] = z
    summ_zh, sec_zh, ind_zh = tr[len(allt):]
    return {"ticker": t, "updated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "profile": prof, "summary": summ, "summary_zh": summ_zh, "sector_zh": sec_zh, "industry_zh": ind_zh,
            "candles": candles, "earnings": earn, "quarterly": qis, "estimates": est, "sec": sec, "news": nw, "order_news": ow, "themes": themes[:8]}
def universe():
    s = set()
    try:
        for line in get("https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv").decode().splitlines()[1:]: s.add(line.split(",")[0].replace(".", "-"))
    except Exception as e: print("sp500", e)
    s |= set(open(os.path.join(BASE, "extra_tickers.txt")).read().split())
    return sorted(s)
if __name__ == "__main__":
    ts = sys.argv[1:] or universe(); ok = []
    for i, t in enumerate(ts):
        try:
            d = build(t); json.dump(d, open(os.path.join(OUT, t + ".json"), "w"), ensure_ascii=False, separators=(",", ":")); ok.append(t); print(i, t, "ok", len(d["candles"]))
        except Exception as e: print(i, t, "FAIL", e)
        if i % 20 == 0: json.dump(TC, open(CF, "w"), ensure_ascii=False)
        time.sleep(0.3)
    json.dump(TC, open(CF, "w"), ensure_ascii=False)
    idx_f = os.path.join(OUT, "index.json"); idx = json.load(open(idx_f)) if os.path.exists(idx_f) else {}
    for t in ok:
        d = json.load(open(os.path.join(OUT, t + ".json"))); idx[t] = d["profile"].get("shortName") or t
    json.dump({k: idx[k] for k in sorted(idx)}, open(idx_f, "w"), ensure_ascii=False)
