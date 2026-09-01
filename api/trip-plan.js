// Vercel Serverless Function: POST /api/trip-plan
// 항공권 이미지(들) → 모든 항공편 + 여행이름 + 목적지도시. 키는 ANTHROPIC_API_KEY (공용)

export const config = { api: { bodyParser: { sizeLimit: "12mb" } } };

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST만 허용됩니다." }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "서버에 ANTHROPIC_API_KEY 환경변수가 없습니다." }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const images = (body && body.images) || [];
  if (!images.length) { res.status(400).json({ error: "이미지가 없습니다." }); return; }

  const year = new Date().toISOString().slice(0, 4);
  const content = images.slice(0, 6).map((im) => ({
    type: "image",
    source: { type: "base64", media_type: im.media_type || "image/jpeg", data: im.data },
  }));
  content.push({ type: "text", text:
`이 이미지들은 항공권(탑승권/E-티켓)입니다. 여러 장이면 모두 종합하세요.
모든 항공편을 추출하고 여행 정보를 추론해 JSON만 출력하세요. 설명·코드블록 금지.
중요: 이미지에 실제로 보이는 값만 채우세요. 안 보이면 빈 문자열 "". 좌석·게이트 등은 추측하지 마세요.

- flights: 배열. 각 항공편은 {airline, flightNo, depAp, arrAp, depCity, arrCity, depDate, depTime, arrDate, arrTime, gate}
    · depAp/arrAp = 공항 IATA 3자리 코드 (예: ICN, KIX, NRT)
    · depCity/arrCity = 도시명(한글, 나라 포함. 예 "서울, 대한민국" / "타슈켄트, 우즈베키스탄")
    · 날짜 YYYY-MM-DD (연도 없으면 ${year}), 시간 HH:MM (현지시간)
    · gate = 명확히 보일 때만, 아니면 ""
    · 왕복이면 가는 편과 오는 편을 모두 포함. 경유편도 각각 포함.
- destinationCity: 이 여행의 목적지 도시명(한글). 보통 첫 출발편의 도착 도시. (예: 타슈켄트)
- tripName: 여행 이름 추천 (예: "중앙아시아 여행").

형식:
{"tripName":"","destinationCity":"","flights":[{"airline":"","flightNo":"","depAp":"","arrAp":"","depCity":"","arrCity":"","depDate":"","depTime":"","arrDate":"","arrTime":"","gate":""}]}`
  });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1500, messages: [{ role: "user", content }] }),
    });
    const data = await r.json();
    if (data.error) { res.status(502).json({ error: "AI 호출 오류: " + (data.error.message || "") }); return; }
    let text = (data.content || []).map((c) => c.text || "").join("").trim();
    text = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const s = text.indexOf("{"), e = text.lastIndexOf("}");
    if (s >= 0 && e > s) text = text.slice(s, e + 1);
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (err) { res.status(502).json({ error: "AI 응답 해석 실패", raw: text.slice(0, 200) }); return; }
    if (!Array.isArray(parsed.flights)) parsed.flights = [];
    res.status(200).json(parsed);
  } catch (e) {
    res.status(502).json({ error: "AI 호출 실패: " + e.message });
  }
}
