// Vercel Serverless Function: /api/hotels?city=Prague&in=2027-02-07&out=2027-02-10&adults=2
//  → 그 도시 그 날짜의 호텔 실제 가격 (구글 호텔 검색, SerpApi) 중 평점 4.0 이상 싼 순 3곳
// 키는 브라우저에 노출되지 않고 환경변수 SERPAPI_KEY 에서 읽습니다. (serpapi.com 무료 가입 → API key)

const num = (v) => {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export default async function handler(req, res) {
  const key = process.env.SERPAPI_KEY;
  if (!key) { res.status(500).json({ error: "서버에 SERPAPI_KEY 환경변수가 없어서 호텔 가격을 못 가져와요. (serpapi.com 무료 가입 → API key → Vercel 환경변수)" }); return; }
  const city = (req.query.city || "").toString().slice(0, 60);
  const ci = (req.query.in || "").toString(), co = (req.query.out || "").toString();
  const adults = Math.min(6, Math.max(1, parseInt(req.query.adults, 10) || 2));
  const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!city || !isDate(ci) || !isDate(co) || co <= ci) { res.status(400).json({ error: "city, in, out(YYYY-MM-DD) 가 필요해요." }); return; }

  const p = new URLSearchParams({ engine: "google_hotels", q: `${city} hotels`, check_in_date: ci, check_out_date: co, adults: String(adults), currency: "KRW", gl: "kr", hl: "ko", api_key: key });
  try {
    const r = await fetch("https://serpapi.com/search.json?" + p);
    const d = await r.json();
    if (!r.ok || d.error) { res.status(502).json({ error: "호텔 검색 실패: " + (d.error || r.status) }); return; }
    const nights = Math.round((new Date(co) - new Date(ci)) / 86400000);
    const list = (d.properties || []).map((h) => {
      const night = num(h.rate_per_night && (h.rate_per_night.extracted_lowest ?? h.rate_per_night.lowest));
      const total = num(h.total_rate && (h.total_rate.extracted_lowest ?? h.total_rate.lowest)) || (night ? night * nights : null);
      return { name: h.name || "", night, total, rating: h.overall_rating || null, reviews: h.reviews || null, cls: h.extracted_hotel_class || h.hotel_class || null, link: h.link || "" };
    }).filter((h) => h.total && (h.rating == null || h.rating >= 4)).sort((a, b) => a.total - b.total).slice(0, 3);
    res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate");
    res.status(200).json({ city, checkin: ci, checkout: co, nights, adults, hotels: list });
  } catch (e) {
    res.status(502).json({ error: "호텔 검색 호출 실패: " + e.message });
  }
}
