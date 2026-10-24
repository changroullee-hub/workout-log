// Vercel Serverless Function: /api/gflights?legs=ICN-PRG@2027-02-06,BUD-ICN@2027-02-14
//  → 구글 항공권(SerpApi google_flights) 실시간 최저가 + 구간별 실제 편명·경유 공항
//  - 구간 2개가 A→B, B→A 면 왕복, 그 외는 다구간(멀티시티). 구간마다 가장 싼 편을 골라 다음 구간을 이어서 조회(departure_token)
//  - 가격은 항상 성인 1명 기준으로 받아서(인원 합산 방식 혼동 방지) 화면에서 인원수만큼 곱합니다.
// 키는 브라우저에 노출되지 않고 환경변수 SERPAPI_KEY 에서 읽습니다. (호텔 가격과 같은 키)

// 트래블페이아웃의 도시 코드 → 구글 항공권이 알아듣는 공항 코드
const CITY_AP = { BJS: "PEK,PKX", BUH: "OTP", PAR: "CDG,ORY", TYO: "HND,NRT", REK: "KEF", LON: "LHR,LGW", MIL: "MXP,LIN", ROM: "FCO", OSA: "KIX", SEL: "ICN", STO: "ARN", MOW: "SVO", SAO: "GRU", BUE: "EZE", NYC: "JFK,EWR" };
const ap = (c) => CITY_AP[c] || c;

const pick = (d) => [...(d.best_flights || []), ...(d.other_flights || [])].filter((o) => o.price).sort((a, b) => a.price - b.price)[0];
const seg = (o) => ({
  price: o.price,
  durationMin: o.total_duration || null,
  flights: (o.flights || []).map((f) => ({
    from: f.departure_airport && f.departure_airport.id, to: f.arrival_airport && f.arrival_airport.id,
    fromName: f.departure_airport && f.departure_airport.name, toName: f.arrival_airport && f.arrival_airport.name,
    dep: f.departure_airport && f.departure_airport.time, arr: f.arrival_airport && f.arrival_airport.time,
    airline: f.airline || "", no: f.flight_number || "", min: f.duration || null,
  })),
  layovers: (o.layovers || []).map((l) => ({ code: l.id, name: l.name, min: l.duration, overnight: !!l.overnight })),
});

export default async function handler(req, res) {
  const key = process.env.SERPAPI_KEY;
  if (!key) { res.status(500).json({ error: "서버에 SERPAPI_KEY 환경변수가 없어서 실시간 항공권 가격을 못 가져와요." }); return; }
  const legs = String(req.query.legs || "").split(",").slice(0, 5).map((s) => {
    const m = s.trim().match(/^([A-Z]{3})-([A-Z]{3})@(\d{4}-\d{2}-\d{2})$/); return m ? { a: m[1], b: m[2], date: m[3] } : null;
  });
  if (!legs.length || legs.some((l) => !l)) { res.status(400).json({ error: "legs=ICN-PRG@2027-02-06,BUD-ICN@2027-02-14 형식이 필요해요." }); return; }

  const rt = legs.length === 2 && legs[0].a === legs[1].b && legs[0].b === legs[1].a;
  const base = { engine: "google_flights", adults: "1", currency: "KRW", hl: "ko", gl: "kr", api_key: key };
  if (legs.length === 1) Object.assign(base, { type: "2", departure_id: ap(legs[0].a), arrival_id: ap(legs[0].b), outbound_date: legs[0].date });
  else if (rt) Object.assign(base, { type: "1", departure_id: ap(legs[0].a), arrival_id: ap(legs[0].b), outbound_date: legs[0].date, return_date: legs[1].date });
  else Object.assign(base, { type: "3", multi_city_json: JSON.stringify(legs.map((l) => ({ departure_id: ap(l.a), arrival_id: ap(l.b), date: l.date }))) });

  const call = async (extra) => {
    const r = await fetch("https://serpapi.com/search.json?" + new URLSearchParams({ ...base, ...extra }));
    const d = await r.json();
    if (!r.ok || d.error) {
      const msg = String(d.error || r.status);
      throw new Error(/hasn't returned any results|no results/i.test(msg) ? "구글 항공권에 이 날짜 표가 없어요 (아직 판매 전이거나 운항 없음)" : "구글 항공권 조회 실패: " + msg);
    }
    return d;
  };

  try {
    const out = []; let d = await call({}), price = null, link = (d.search_metadata && d.search_metadata.google_flights_url) || "", insight = d.price_insights || null;
    for (let i = 0; i < legs.length; i++) {
      const o = pick(d);
      if (!o) { if (!i) throw new Error("구글 항공권에 이 날짜 표가 없어요"); break; }
      out.push({ ...seg(o), date: legs[i].date, a: legs[i].a, b: legs[i].b });
      price = o.price; // 다음 구간을 고를수록 전체 여정 가격으로 확정됨
      if (i < legs.length - 1) { if (!o.departure_token) break; d = await call({ departure_token: o.departure_token }); if (d.price_insights && !insight) insight = d.price_insights; }
    }
    res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate");
    res.status(200).json({
      price, partial: out.length < legs.length, legs: out, link,
      level: insight && insight.price_level || "", typical: insight && insight.typical_price_range || null,
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
