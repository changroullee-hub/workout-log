// Vercel Serverless Function: /api/flights
//  ?group=short|mid|long short = 비행 1~4시간대, mid = 5~9시간대, long = 10시간 이상(대부분 경유)
//  ?legs=ICN-IST@2026-11-20,IST-TIA@2026-11-22,TIA-ICN@2026-11-25&flex=1
//     → 구간별 편도 최저가 (경유 여행 추천 탭용). 각 구간은 목표일 ±flex일 안에서,
//       앞 구간 출발일보다 하루 이상 뒤인 항공편만 고릅니다(날짜 순서 보장).
//     &hub=IST  → 마지막 귀국편이 비면 '마지막 도시→허브→한국' 2구간으로 대신 찾습니다.
//  &origin=ALL|ICN|GMP|CJJ  (ALL = 세 공항 중 최저가)
//  &month=YYYY-MM        출발 월 (없으면 이번 달)
//  &oneway=0|1           0 = 왕복(기본), 1 = 편도
//  &direct=0|1           1 = 직항만
//  &nights=3-5           왕복일 때 여행 박수 범위 (없으면 전체)
// Travelpayouts(아비아세일즈) Data API — 최근 48시간 내 실제 검색된 최저가 캐시입니다(실시간 예약가 아님).
// 키는 브라우저에 노출되지 않고 환경변수 TRAVELPAYOUTS_TOKEN 에서 읽습니다.

// 목적지 목록: [국가, 도시, 아비아세일즈 도시코드, 인천 기준 대략 비행시간(h)]
// 도시코드(TYO·OSA·SEL 등)를 쓰면 그 도시의 공항 전체(HND/NRT 등)가 함께 잡힙니다.
const DESTS = {
  short: [
    ["일본","도쿄","TYO",2.3],["일본","오사카","OSA",1.8],["일본","후쿠오카","FUK",1.3],["일본","삿포로","SPK",2.8],["일본","오키나와","OKA",2.3],["일본","나고야","NGO",1.9],
    ["중국","베이징","BJS",2.2],["중국","상하이","SHA",2],["중국","칭다오","TAO",1.5],["중국","옌지","YNJ",2.2],["중국","장자제","DYG",3.5],
    ["대만","타이베이","TPE",2.5],["홍콩","홍콩","HKG",3.7],["마카오","마카오","MFM",3.8],
    ["몽골","울란바토르","ULN",3.5],["러시아","블라디보스토크","VVO",2.5],
    ["필리핀","마닐라","MNL",4],["필리핀","세부","CEB",4.5],["필리핀","보라카이(칼리보)","KLO",4.3],
    ["베트남","하노이","HAN",4.5],["베트남","다낭","DAD",4.5],
    ["괌(미국)","괌","GUM",4.2],["사이판(미국)","사이판","SPN",4.2],
  ],
  mid: [
    ["베트남","호치민","SGN",5.3],["베트남","나트랑","NHA",5],["베트남","푸꾸옥","PQC",5.7],
    ["태국","방콕","BKK",5.8],["태국","푸껫","HKT",6.5],["태국","치앙마이","CNX",5.7],
    ["라오스","비엔티안","VTE",5.3],["캄보디아","프놈펜","PNH",5.5],["미얀마","양곤","RGN",6.3],
    ["싱가포르","싱가포르","SIN",6.3],["말레이시아","쿠알라룸푸르","KUL",6.5],["말레이시아","코타키나발루","BKI",5.3],
    ["인도네시아","발리","DPS",7],["인도네시아","자카르타","JKT",7],["팔라우","코로르","ROR",5],
    ["카자흐스탄","알마티","ALA",6.5],["우즈베키스탄","타슈켄트","TAS",7.3],["키르기스스탄","비슈케크","FRU",6],
    ["인도","델리","DEL",8.5],["네팔","카트만두","KTM",7.5],["스리랑카","콜롬보","CMB",8.8],
    ["미국","하와이(호놀룰루)","HNL",8.3],["호주","케언즈","CNS",8],
  ],
  // 10시간 이상: 직항 없는 곳은 경유 기준 대략 총 소요시간
  long: [
    ["미국","로스앤젤레스","LAX",11],["미국","샌프란시스코","SFO",10.5],["미국","시애틀","SEA",10],["미국","라스베이거스","LAS",11],["미국","뉴욕","NYC",14],["미국","시카고","CHI",13],
    ["캐나다","밴쿠버","YVR",10],["캐나다","토론토","YTO",13],["멕시코","칸쿤","CUN",18],
    ["영국","런던","LON",14],["프랑스","파리","PAR",14],["이탈리아","로마","ROM",13.5],["이탈리아","밀라노","MIL",13.5],["스페인","바르셀로나","BCN",14],["스페인","마드리드","MAD",14],
    ["독일","프랑크푸르트","FRA",13.5],["네덜란드","암스테르담","AMS",13.5],["스위스","취리히","ZRH",13.5],["오스트리아","비엔나","VIE",13],["체코","프라하","PRG",13],["헝가리","부다페스트","BUD",13],
    ["포르투갈","리스본","LIS",17],["그리스","아테네","ATH",15],["핀란드","헬싱키","HEL",13.5],["튀르키예","이스탄불","IST",12.5],["크로아티아","자그레브","ZAG",15],
    ["아랍에미리트","두바이","DXB",10],["카타르","도하","DOH",10.5],["이집트","카이로","CAI",15],["모로코","마라케시","RAK",19],["남아공","케이프타운","CPT",20],["케냐","나이로비","NBO",16],
    ["몰디브","말레","MLE",11],["호주","시드니","SYD",10.5],["호주","멜버른","MEL",11],["호주","브리즈번","BNE",10],["뉴질랜드","오클랜드","AKL",11.5],
    ["조지아","트빌리시","TBS",11],["요르단","암만","AMM",13],["알바니아","티라나","TIA",15],["폴란드","바르샤바","WAW",12.5],["덴마크","코펜하겐","CPH",14],["노르웨이","오슬로","OSL",14],
    ["아일랜드","더블린","DUB",15],["아이슬란드","레이캬비크","REK",17],["미국","보스턴","BOS",14.5],["미국","마이애미","MIA",17],["쿠바","하바나","HAV",21],["탄자니아","잔지바르","ZNZ",16],
    ["페루","리마","LIM",22],["칠레","산티아고","SCL",25],["브라질","상파울루","SAO",26],["아르헨티나","부에노스아이레스","BUE",28],
  ],
};
// 경유 항공권의 첫 구간 항공사 → 대표 환승지 (추정용)
const HUB = {
  TK:"이스탄불",EK:"두바이",QR:"도하",EY:"아부다비",SV:"리야드",WY:"무스카트",GF:"바레인",ET:"아디스아바바",MS:"카이로",
  SQ:"싱가포르",TR:"싱가포르",CX:"홍콩",HX:"홍콩",UO:"홍콩",BR:"타이베이",CI:"타이베이",JX:"타이베이",IT:"타이베이",
  JL:"도쿄",NH:"도쿄",MM:"오사카",CA:"베이징",MU:"상하이",FM:"상하이",CZ:"광저우",HU:"하이커우",MF:"샤먼",ZH:"선전",SC:"칭다오","3U":"청두",
  TG:"방콕",FD:"방콕",VN:"하노이·호치민",VJ:"하노이·호치민",MH:"쿠알라룸푸르",AK:"쿠알라룸푸르",D7:"쿠알라룸푸르",PR:"마닐라","5J":"마닐라",GA:"자카르타",AI:"델리",UL:"콜롬보",
  LH:"프랑크푸르트·뮌헨",AF:"파리",KL:"암스테르담",BA:"런던",AY:"헬싱키",LO:"바르샤바",LX:"취리히",OS:"비엔나",AZ:"로마",IB:"마드리드",HY:"타슈켄트",KC:"알마티",
  AC:"밴쿠버·토론토",UA:"미국 경유",DL:"미국 경유",AA:"미국 경유",AS:"시애틀",QF:"시드니",VA:"브리즈번",NZ:"오클랜드",
};
const ORIGINS = ["ICN","GMP","CJJ"];

async function cheapest(token, origin, dest, q) {
  const p = new URLSearchParams({
    origin, destination: dest, departure_at: q.month, currency: "krw", market: "kr",
    one_way: q.oneway ? "true" : "false", direct: q.direct ? "true" : "false",
    sorting: "price", limit: String(q.limit || 5), token,
  });
  const r = await fetch("https://api.travelpayouts.com/aviasales/v3/prices_for_dates?" + p);
  if (r.status === 401) throw new Error("TOKEN");
  if (!r.ok) return null;
  const d = await r.json();
  const rows = d && d.success && Array.isArray(d.data) ? d.data : [];
  return rows.filter((t) => t && t.price).map((t) => ({
    origin: t.origin_airport || origin, destAp: t.destination_airport || dest,
    price: t.price, airline: t.airline || "", flightNo: t.flight_number || "",
    departAt: t.departure_at || "", returnAt: t.return_at || "",
    transfers: t.transfers ?? null, returnTransfers: t.return_transfers ?? null,
    durationMin: t.duration_to || t.duration || null,
    hub: t.transfers > 0 ? HUB[t.airline] || "" : "",
    link: t.link ? "https://www.aviasales.com" + t.link : "",
  }));
}

// 동시 요청 수를 n개로 제한해서 병렬 처리
async function pool(jobs, n) {
  const out = new Array(jobs.length); let i = 0;
  async function worker() { while (i < jobs.length) { const k = i++; try { out[k] = await jobs[k](); } catch (e) { if (e.message === "TOKEN") throw e; out[k] = null; } } }
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, worker));
  return out;
}

export default async function handler(req, res) {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  if (!token) { res.status(500).json({ error: "서버에 TRAVELPAYOUTS_TOKEN 환경변수가 없습니다. (travelpayouts.com 가입 → API 토큰)" }); return; }

  const now = new Date();
  let month = (req.query.month || "").toString();
  if (!/^\d{4}-\d{2}$/.test(month)) month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // 구간별 편도 최저가: legs=ICN-IST@YYYY-MM-DD,...
  if (req.query.legs) {
    const legs = req.query.legs.toString().toUpperCase().split(",").map((x) => { const [r, date] = x.split("@"); const [a, b] = (r || "").split("-"); return { a, b, date }; })
      .filter((x) => /^[A-Z]{3}$/.test(x.a || "") && /^[A-Z]{3}$/.test(x.b || "") && /^\d{4}-\d{2}-\d{2}$/.test(x.date || "")).slice(0, 6);
    if (!legs.length) { res.status(400).json({ error: "legs 형식: ICN-IST@2026-11-20,IST-TIA@2026-11-22" }); return; }
    const flex = Math.min(3, Math.max(0, parseInt(req.query.flex, 10) || 0));
    const addDay = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
    try {
      // 목표일 ±flex 창이 걸친 달(1~2개)을 한꺼번에 받아 두고
      const jobs = [];
      legs.forEach((l, li) => { new Set([addDay(l.date, -flex).slice(0, 7), addDay(l.date, flex).slice(0, 7)]).forEach((m) =>
        jobs.push(async () => ({ li, opts: (await cheapest(token, l.a, l.b, { month: m, oneway: true, direct: false, limit: 100 })) || [] }))); });
      const found = await pool(jobs, 8);
      const opts = legs.map(() => []);
      found.forEach((r) => { if (r) opts[r.li].push(...r.opts); });
      // 앞 구간부터 순서대로: 창 안 + 앞 구간 다음날 이후 중 최저가
      let prev = ""; const mins = [];
      const out = legs.map((l, li) => {
        const lo = addDay(l.date, -flex), hi = addDay(l.date, flex), min = prev ? addDay(prev, 1) : ""; mins[li] = min;
        const ok = opts[li].filter((x) => { const d = (x.departAt || "").slice(0, 10); return d >= lo && d <= hi && (!min || d >= min); }).sort((x, y) => x.price - y.price);
        const pick = ok[0];
        if (pick) prev = pick.departAt.slice(0, 10); else prev = l.date > prev ? l.date : prev;
        // 창 안에 없으면 참고용으로 가장 가까운 날짜의 가격
        let near = null;
        if (!pick) { const later = opts[li].filter((x) => (x.departAt || "").slice(0, 10) >= (min || "")); later.sort((x, y) => Math.abs(new Date(x.departAt) - new Date(l.date)) - Math.abs(new Date(y.departAt) - new Date(l.date)) || x.price - y.price); near = later[0] || null; }
        return { from: l.a, to: l.b, target: l.date, ...(pick || { price: null }), near };
      });
      // 귀국편이 없으면 허브 경유 2구간(마지막 도시→허브, 허브→한국)으로 이어 붙이기
      const li = legs.length - 1, last = legs[li], hub = (req.query.hub || "").toString().toUpperCase();
      if (!out[li].price && ORIGINS.includes(last.b) && /^[A-Z]{3}$/.test(hub) && hub !== last.a && hub !== last.b) {
        const lo = addDay(last.date, -flex), hi = addDay(last.date, flex), min = mins[li];
        const months = [...new Set([lo.slice(0, 7), addDay(hi, 1).slice(0, 7)])];
        const [p1, p2] = await Promise.all([[last.a, hub], [hub, last.b]].map(async ([a, b]) => (await Promise.all(months.map((m) => cheapest(token, a, b, { month: m, oneway: true, direct: false, limit: 100 })))).flat().filter(Boolean)));
        let best = null;
        p1.forEach((x) => { const d1 = (x.departAt || "").slice(0, 10); if (d1 < lo || d1 > hi || (min && d1 < min)) return;
          p2.forEach((y) => { const d2 = (y.departAt || "").slice(0, 10); if (d2 < d1 || d2 > addDay(d1, 1) || new Date(y.departAt) <= new Date(x.departAt)) return;
            if (!best || x.price + y.price < best.price) best = { price: x.price + y.price, departAt: x.departAt, transfers: (x.transfers || 0) + (y.transfers || 0) + 1, airline: [x.airline, y.airline].filter(Boolean).join("+"), via: hub, parts: [{ from: last.a, to: hub, ...x }, { from: hub, to: last.b, ...y }] }; }); });
        if (best) out[li] = { from: last.a, to: last.b, target: last.date, ...best, near: null };
      }
      res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate");
      res.status(200).json({ flex, legs: out });
    } catch (e) {
      if (e.message === "TOKEN") { res.status(502).json({ error: "Travelpayouts 토큰이 올바르지 않습니다." }); return; }
      res.status(502).json({ error: "구간 가격 조회 실패: " + e.message });
    }
    return;
  }

  const group = (req.query.group || "short").toString();
  const list = DESTS[group];
  if (!list) { res.status(400).json({ error: "group 은 short, mid, long 중 하나여야 합니다." }); return; }
  const o = (req.query.origin || "ALL").toString().toUpperCase();
  const origins = o === "ALL" ? ORIGINS : ORIGINS.includes(o) ? [o] : null;
  if (!origins) { res.status(400).json({ error: "origin 은 ALL, ICN, GMP, CJJ 중 하나여야 합니다." }); return; }
  const q = { month, oneway: req.query.oneway === "1", direct: req.query.direct === "1", limit: 30 };
  const nm = /^(\d+)-(\d+)$/.exec((req.query.nights || "").toString());
  const nightsOf = (x) => x.returnAt ? Math.round((new Date(x.returnAt.slice(0, 10)) - new Date(x.departAt.slice(0, 10))) / 86400000) : null;
  const nightsOk = (x) => q.oneway || !nm || ((n) => n != null && n >= +nm[1] && n <= +nm[2])(nightsOf(x));

  try {
    const jobs = [];
    list.forEach((d, di) => origins.forEach((og) => jobs.push(async () => ({ di, opts: (await cheapest(token, og, d[2], q)) || [] }))));
    const found = await pool(jobs, 16);
    // 목적지별로 출발공항 전체의 후보를 모아 최저가 + 직항 최저가 + 경유 방법(환승지별 최저가 최대 3개)
    const opts = {};
    found.forEach((r) => { if (r) (opts[r.di] = opts[r.di] || []).push(...r.opts); });
    const results = list.map((d, di) => {
      const all = (opts[di] || []).filter(nightsOk).map((x) => ({ ...x, nights: nightsOf(x) })).sort((a, b) => a.price - b.price);
      // 왕복 최저가 날짜 추천: 출발일이 겹치지 않게 상위 3개
      const dates = []; const dset = new Set();
      all.forEach((x) => { const k = (x.departAt || "").slice(0, 10); if (k && !dset.has(k) && dates.length < 3) { dset.add(k); dates.push(x); } });
      const direct = all.find((x) => x.transfers === 0) || null;
      const vias = []; const seen = new Set();
      all.forEach((x) => { const k = x.hub || x.airline; if (x.transfers > 0 && !seen.has(k) && vias.length < 3) { seen.add(k); vias.push(x); } });
      return { country: d[0], city: d[1], code: d[2], hours: d[3], ...(all[0] || { price: null }), direct, vias, dates };
    });
    res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate");
    res.status(200).json({ group, month, origins, oneway: q.oneway, direct: q.direct, results });
  } catch (e) {
    if (e.message === "TOKEN") { res.status(502).json({ error: "Travelpayouts 토큰이 올바르지 않습니다." }); return; }
    res.status(502).json({ error: "항공권 시세 조회 실패: " + e.message });
  }
}
