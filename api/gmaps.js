// Vercel Serverless Function: /api/gmaps
//  ?action=search&q=검색어           → 장소 검색 (이름·주소·좌표)
//  ?action=route&from=lat,lng&to=lat,lng → 자동차 소요시간·거리
// 키는 브라우저에 노출되지 않고 환경변수 GOOGLE_MAPS_API_KEY 에서 읽습니다.

export default async function handler(req, res) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) { res.status(500).json({ error: "서버에 GOOGLE_MAPS_API_KEY 환경변수가 없습니다." }); return; }
  const action = (req.query.action || "").toString();

  try {
    if (action === "search") {
      const q = (req.query.q || "").toString().trim();
      if (!q) { res.status(400).json({ error: "검색어(q)가 필요합니다." }); return; }
      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&language=ko&key=${key}`;
      const r = await fetch(url);
      const d = await r.json();
      if (d.status && d.status !== "OK" && d.status !== "ZERO_RESULTS") {
        res.status(502).json({ error: "구글 오류: " + d.status + (d.error_message ? " / " + d.error_message : "") });
        return;
      }
      const results = (d.results || []).slice(0, 8).map((p) => ({
        name: p.name || "",
        address: p.formatted_address || "",
        lat: p.geometry && p.geometry.location ? p.geometry.location.lat : null,
        lng: p.geometry && p.geometry.location ? p.geometry.location.lng : null,
        placeId: p.place_id || "",
      }));
      res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");
      res.status(200).json({ results });
      return;
    }

    if (action === "matrix") {
      const points = (req.query.points || "").toString(); // "lat,lng|lat,lng|..."
      if (!points) { res.status(400).json({ error: "points 좌표가 필요합니다." }); return; }
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(points)}&destinations=${encodeURIComponent(points)}&mode=driving&language=ko&key=${key}`;
      const r = await fetch(url);
      const d = await r.json();
      if (d.status && d.status !== "OK") {
        res.status(502).json({ error: "구글 오류: " + d.status + (d.error_message ? " / " + d.error_message : "") });
        return;
      }
      // 초 단위 소요시간 매트릭스 (계산 불가 셀은 큰 값)
      const matrix = (d.rows || []).map((row) =>
        (row.elements || []).map((e) => (e.status === "OK" ? e.duration.value : 9999999))
      );
      res.setHeader("Cache-Control", "s-maxage=604800, stale-while-revalidate");
      res.status(200).json({ matrix });
      return;
    }

    if (action === "route") {
      const from = (req.query.from || "").toString();
      const to = (req.query.to || "").toString();
      if (!from || !to) { res.status(400).json({ error: "from·to 좌표가 필요합니다." }); return; }
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(from)}&destinations=${encodeURIComponent(to)}&mode=driving&language=ko&key=${key}`;
      const r = await fetch(url);
      const d = await r.json();
      const el = d.rows && d.rows[0] && d.rows[0].elements && d.rows[0].elements[0];
      if (!el || el.status !== "OK") { res.status(502).json({ error: "경로 계산 불가", status: el && el.status }); return; }
      res.setHeader("Cache-Control", "s-maxage=604800, stale-while-revalidate");
      res.status(200).json({
        durationMin: Math.round(el.duration.value / 60),
        distanceKm: Math.round(el.distance.value / 100) / 10,
      });
      return;
    }

    res.status(400).json({ error: "action 은 search 또는 route 여야 합니다." });
  } catch (e) {
    res.status(502).json({ error: "구글맵 호출 실패: " + e.message });
  }
}
