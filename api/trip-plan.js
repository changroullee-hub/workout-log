// Vercel Serverless Function: POST /api/trip-plan
// 항공권 이미지(들) → 모든 항공편 + 여행이름 + 목적지도시. 키는 ANTHROPIC_API_KEY (공용)

export const config = { api: { bodyParser: { sizeLimit: "12mb" } } };

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST만 허용됩니다." }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "서버에 ANTHROPIC_API_KEY 환경변수가 없습니다." }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const images = (body && body.images) || (body && body.image ? [{ data: body.image, media_type: body.media_type }] : []);
  if (!images.length) { res.status(400).json({ error: "이미지가 없습니다." }); return; }

  const year = new Date().toISOString().slice(0, 4);
  const content = images.slice(0, 6).map((im) => ({
    type: "image",
    source: { type: "base64", media_type: im.media_type || "image/jpeg", data: im.data },
  }));
  content.push({ type: "text", text:
`이 이미지는 여행 이동수단 티켓/예약서(항공권 또는 기차표)입니다. 러시아어·현지어여도 읽으세요.
이미지에 실제로 적힌 구간만 추출하고, 없는 도시·구간은 절대 지어내지 마세요.

★ 매우 중요 — 반드시 '출발 시각(HH:MM)이 명확히 적힌 실제 운항/운행 구간'만 넣으세요.
  - e티켓 번호·PNR/예약번호·좌석배정 표처럼 출발시각이 없는 행은 완전히 무시(버리기).
    예) "595-4818150337", "A7TAYI", "YE5V2S" 같은 번호만 있는 항목은 절대 flights/trains에 넣지 말 것.
  - 출발시각(depTime)이 비어 있으면 그 구간은 아예 제외하세요.

- flights: 항공편 배열. {airline, flightNo, depAp, arrAp, depCity, arrCity, depDate, depTime, arrDate, arrTime, gate}
    · '출발 2026-10-03 12:10, 인천공항 → 도착 15:40, 타슈케트공항' 처럼 시각·공항·도시가 함께 있는 구간만.
- trains: 기차 배열. {op, trainNo, depSt, arrSt, depCity, arrCity, depDate, depTime, arrDate, arrTime, car}
- 공통: depCity/arrCity = 도시명(한글, 나라 정확히. 예 "부하라, 우즈베키스탄"·"타슈케트, 우즈베키스탄"·"알마티, 카자흐스탄"). 도시-나라를 틀리지 말 것.
    · 날짜 YYYY-MM-DD(연도 없으면 ${year}), 시간 HH:MM(현지).
- destinationCity: 첫 출발편의 최종 도착 도시(한글). 모르면 "".
- tripName: 목적지 기반으로만(확실치 않으면 "").

형식: {"tripName":"","destinationCity":"","flights":[],"trains":[]}`
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
