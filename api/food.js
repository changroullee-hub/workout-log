// Vercel Serverless Function: /api/food?q=검색어
// 식약처 식품영양성분DB(FoodNtrCpntDbInfo02) 프록시.
// API 키는 브라우저에 노출되지 않고, Vercel 환경변수 FOOD_API_KEY 에서 읽습니다.
// 필드 매핑: FOOD_NM_KR=식품명, AMT_NUM1=에너지(kcal), AMT_NUM3=단백질, AMT_NUM4=지방, AMT_NUM6=탄수화물

export default async function handler(req, res) {
  const q = (req.query.q || "").toString().trim();
  if (!q) {
    res.status(400).json({ error: "검색어(q)가 필요합니다." });
    return;
  }
  const key = process.env.FOOD_API_KEY;
  if (!key) {
    res.status(500).json({ error: "서버에 FOOD_API_KEY 환경변수가 설정되지 않았습니다." });
    return;
  }

  const endpoint = "https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo02/getFoodNtrCpntDbInq02";
  const url = `${endpoint}?serviceKey=${encodeURIComponent(key)}&type=json&pageNo=1&numOfRows=15&FOOD_NM_KR=${encodeURIComponent(q)}`;

  try {
    const r = await fetch(url);
    const text = await r.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      // 식약처가 XML/평문 에러(예: "Forbidden", "SERVICE_KEY_IS_NOT_REGISTERED")를 준 경우
      res.status(502).json({ error: "식약처 응답을 해석할 수 없습니다(키 미등록/제한 가능).", raw: text.slice(0, 300) });
      return;
    }

    // items 위치가 버전마다 달라 유연하게 탐색
    let items = (data && data.body && data.body.items) || (data && data.items) || [];
    if (items && !Array.isArray(items)) {
      items = items.item ? (Array.isArray(items.item) ? items.item : [items.item]) : [items];
    }

    const num = (v) => {
      if (v == null) return 0;
      const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
      return isNaN(n) ? 0 : Math.round(n * 10) / 10;
    };

    const out = (items || []).map((it) => ({
      name: it.FOOD_NM_KR || it.DESC_KOR || "식품",
      maker: it.MAKER_NM || it.BSSH_NM || "",
      basis: it.NUTR_CONT_SRTN || it.SERVING_SIZE || it.Z10500 || "",   // 영양성분 함량 기준량(있으면)
      kcal: num(it.AMT_NUM1),
      protein: num(it.AMT_NUM3),
      fat: num(it.AMT_NUM4),
      carb: num(it.AMT_NUM6),
    })).filter((x) => x.kcal > 0 || x.protein > 0 || x.carb > 0 || x.fat > 0);

    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");
    res.status(200).json({ q, count: out.length, items: out });
  } catch (e) {
    res.status(502).json({ error: "식약처 API 호출 실패: " + e.message });
  }
}
