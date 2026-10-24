// Vercel Serverless Function: /api/climate?lat=50.08&lon=14.43&from=2027-02-06&to=2027-02-14  (또는 city=Prague)
//  → 그 기간의 최근 3년 실제 날씨 평균(최고·최저기온, 비 온 날 비율). Open-Meteo 무료 API라 키가 필요 없어요.

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const shift = (d, k) => { const t = new Date(d + "T00:00:00Z"); t.setUTCFullYear(t.getUTCFullYear() - k); return t.toISOString().slice(0, 10); };
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);

export default async function handler(req, res) {
  let lat = parseFloat(req.query.lat), lon = parseFloat(req.query.lon);
  const city = String(req.query.city || "").slice(0, 60);
  let from = String(req.query.from || ""), to = String(req.query.to || "");
  if (!isDate(from) || !isDate(to) || to < from) { res.status(400).json({ error: "from, to(YYYY-MM-DD) 가 필요해요." }); return; }
  // 3주 넘는 기간은 앞 3주만
  if ((new Date(to) - new Date(from)) / 86400000 > 21) to = new Date(Date.parse(from) + 21 * 86400000).toISOString().slice(0, 10);
  try {
    let name = city;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      if (!city) { res.status(400).json({ error: "lat·lon 또는 city 가 필요해요." }); return; }
      const g = await (await fetch("https://geocoding-api.open-meteo.com/v1/search?" + new URLSearchParams({ name: city, count: "1", language: "en" }))).json();
      const p = g.results && g.results[0];
      if (!p) { res.status(404).json({ error: "도시 위치를 못 찾았어요." }); return; }
      lat = p.latitude; lon = p.longitude; name = p.name;
    }
    // 지금보다 일주일 이상 지난 같은 기간만 (최근 3년)
    const limit = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10), wins = [];
    for (let k = 1; k <= 6 && wins.length < 3; k++) { const a = shift(from, k), b = shift(to, k); if (b < limit) wins.push([a, b]); }
    const days = (await Promise.all(wins.map(async ([a, b]) => {
      const r = await fetch("https://archive-api.open-meteo.com/v1/archive?" + new URLSearchParams({ latitude: String(lat), longitude: String(lon), start_date: a, end_date: b, daily: "temperature_2m_max,temperature_2m_min,precipitation_sum", timezone: "auto" }));
      const d = await r.json(); if (!r.ok || !d.daily) return [];
      return d.daily.time.map((t, i) => ({ hi: d.daily.temperature_2m_max[i], lo: d.daily.temperature_2m_min[i], p: d.daily.precipitation_sum[i] })).filter((x) => x.hi != null && x.lo != null);
    }))).flat();
    if (!days.length) { res.status(502).json({ error: "날씨 기록을 못 가져왔어요." }); return; }
    res.setHeader("Cache-Control", "s-maxage=2592000, stale-while-revalidate");
    res.status(200).json({
      name, lat, lon, years: wins.length,
      hi: Math.round(avg(days.map((x) => x.hi))), lo: Math.round(avg(days.map((x) => x.lo))),
      rain: Math.round((days.filter((x) => (x.p || 0) >= 1).length / days.length) * 100),
    });
  } catch (e) {
    res.status(502).json({ error: "날씨 조회 실패: " + e.message });
  }
}
