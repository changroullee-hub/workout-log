// Vercel Serverless Function: /api/flights
//  ?group=short|mid      short = 비행 1~4시간대, mid = 5~9시간대
//  &origin=ALL|ICN|GMP|CJJ  (ALL = 세 공항 중 최저가)
//  &month=YYYY-MM        출발 월 (없으면 이번 달)
//  &oneway=0|1           0 = 왕복(기본), 1 = 편도
//  &direct=0|1           1 = 직항만
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
};
const ORIGINS = ["ICN","GMP","CJJ"];

async function cheapest(token, origin, dest, q) {
  const p = new URLSearchParams({
    origin, destination: dest, departure_at: q.month, currency: "krw", market: "kr",
    one_way: q.oneway ? "true" : "false", direct: q.direct ? "true" : "false",
    sorting: "price", limit: "1", token,
  });
  const r = await fetch("https://api.travelpayouts.com/aviasales/v3/prices_for_dates?" + p);
  if (r.status === 401) throw new Error("TOKEN");
  if (!r.ok) return null;
  const d = await r.json();
  const t = d && d.success && Array.isArray(d.data) ? d.data[0] : null;
  if (!t || !t.price) return null;
  return {
    origin: t.origin_airport || origin, destAp: t.destination_airport || dest,
    price: t.price, airline: t.airline || "", flightNo: t.flight_number || "",
    departAt: t.departure_at || "", returnAt: t.return_at || "",
    transfers: t.transfers ?? null, returnTransfers: t.return_transfers ?? null,
    durationMin: t.duration_to || t.duration || null,
    link: t.link ? "https://www.aviasales.com" + t.link : "",
  };
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

  const group = (req.query.group || "short").toString();
  const list = DESTS[group];
  if (!list) { res.status(400).json({ error: "group 은 short 또는 mid 여야 합니다." }); return; }
  const o = (req.query.origin || "ALL").toString().toUpperCase();
  const origins = o === "ALL" ? ORIGINS : ORIGINS.includes(o) ? [o] : null;
  if (!origins) { res.status(400).json({ error: "origin 은 ALL, ICN, GMP, CJJ 중 하나여야 합니다." }); return; }
  const now = new Date();
  let month = (req.query.month || "").toString();
  if (!/^\d{4}-\d{2}$/.test(month)) month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const q = { month, oneway: req.query.oneway === "1", direct: req.query.direct === "1" };

  try {
    const jobs = [];
    list.forEach((d, di) => origins.forEach((og) => jobs.push(async () => { const r = await cheapest(token, og, d[2], q); return r && { di, ...r }; })));
    const found = await pool(jobs, 12);
    // 목적지별로 출발공항 중 최저가 하나만
    const best = {};
    found.forEach((r) => { if (r && (!best[r.di] || r.price < best[r.di].price)) best[r.di] = r; });
    const results = list.map((d, di) => { const { di: _, ...b } = best[di] || { price: null }; return { country: d[0], city: d[1], code: d[2], hours: d[3], ...b }; });
    res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate");
    res.status(200).json({ group, month, origins, oneway: q.oneway, direct: q.direct, results });
  } catch (e) {
    if (e.message === "TOKEN") { res.status(502).json({ error: "Travelpayouts 토큰이 올바르지 않습니다." }); return; }
    res.status(502).json({ error: "항공권 시세 조회 실패: " + e.message });
  }
}
