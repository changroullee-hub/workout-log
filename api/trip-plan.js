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
`이 이미지들은 여행 이동수단 티켓(항공권 또는 기차표, 여러 장 가능)입니다. 러시아어·현지어여도 읽으세요.
각 구간이 '항공'인지 '기차'인지 스스로 판별해서 아래 JSON으로만 출력하세요. 설명·코드블록 금지.
중요: 실제로 보이는 값만. 안 보이면 빈 문자열 "". 좌석 등은 추측 금지.

- flights: 항공편 배열. 각 {airline, flightNo, depAp, arrAp, depCity, arrCity, depDate, depTime, arrDate, arrTime, gate}
    · depAp/arrAp = 공항 IATA 3자리 코드
- trains: 기차 배열. 각 {op, trainNo, depSt, arrSt, depCity, arrCity, depDate, depTime, arrDate, arrTime, car}
    · op = 운영사/열차종류(있으면), trainNo = 열차번호(예 711ФА)
    · depSt/arrSt = 출발역/도착역명(원문 그대로 가능)
    · car = 호차(칸) — 명확히 보일 때만
- 공통: depCity/arrCity = 도시명(한글, 나라 포함. 예 "부하라, 우즈베키스탄" / "사마르칸트, 우즈베키스탄")
    · 날짜 YYYY-MM-DD (연도 없으면 ${year}), 시간 HH:MM (현지)
- destinationCity: 이 여행의 목적지 도시(한글). 보통 첫 구간의 도착 도시.
- tripName: 여행 이름 추천.

항공권이면 flights에, 기차표면 trains에 넣으세요. 형식:
{"tripName":"","destinationCity":"","flights":[],"trains":[]}`
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
    if (!Array.isArray(parsed.trains)) parsed.trains = [];
    res.status(200).json(parsed);
  } catch (e) {
    res.status(502).json({ error: "AI 호출 실패: " + e.message });
  }
}
