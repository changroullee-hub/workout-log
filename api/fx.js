// Vercel Serverless Function: /api/fx  → 오늘 환율 (1원당 각국 통화). 무료 open.er-api.com, 키 필요 없음. 12시간 캐시.

export default async function handler(req, res) {
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/KRW");
    const d = await r.json();
    if (!r.ok || d.result !== "success" || !d.rates) { res.status(502).json({ error: "환율을 못 가져왔어요." }); return; }
    res.setHeader("Cache-Control", "s-maxage=43200, stale-while-revalidate");
    res.status(200).json({ base: "KRW", updated: d.time_last_update_utc || "", rates: d.rates });
  } catch (e) {
    res.status(502).json({ error: "환율 조회 실패: " + e.message });
  }
}
