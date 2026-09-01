// Vercel Serverless Function: POST /api/ticket?type=flight|train
// 항공권/기차표 이미지를 Claude 비전으로 판독. 키는 환경변수 ANTHROPIC_API_KEY (OCR과 공용)

export const config = { api: { bodyParser: { sizeLimit: "6mb" } } };

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST만 허용됩니다." }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "서버에 ANTHROPIC_API_KEY 환경변수가 없습니다." }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const image = body && body.image;
  const media_type = (body && body.media_type) || "image/jpeg";
  if (!image) { res.status(400).json({ error: "이미지 데이터가 없습니다." }); return; }

  const type = (req.query.type || "flight").toString();
  const year = new Date().toISOString().slice(0, 4);

  const prompt = type === "train"
    ? `이 이미지는 기차표(승차권)입니다. 아래를 추출해 JSON만 출력하세요. 설명·코드블록 금지.
- op: 운영사/노선 (예: KTX, SRT, 신칸센, 무궁화)
- trainNo: 열차번호
- depSt: 출발역, arrSt: 도착역
- depDate: 출발일 YYYY-MM-DD (연도 없으면 ${year}), depTime: 출발시간 HH:MM (현지)
- arrDate: 도착일 YYYY-MM-DD, arrTime: 도착시간 HH:MM (현지)
- car: 열차칸(호차), seat: 좌석번호
모르는 값은 "". 형식: {"op":"","trainNo":"","depSt":"","arrSt":"","depDate":"","depTime":"","arrDate":"","arrTime":"","car":"","seat":""}`
    : `이 이미지는 항공권(탑승권/E-티켓)입니다. 아래를 추출해 JSON만 출력하세요. 설명·코드블록 금지.
- airline: 항공사, flightNo: 편명 (예: KE001)
- depAp: 출발 공항코드(IATA 3자, 예 ICN), arrAp: 도착 공항코드(예 KIX)
- depDate: 출발일 YYYY-MM-DD (연도 없으면 ${year}), depTime: 출발시간 HH:MM (현지)
- arrDate: 도착일 YYYY-MM-DD, arrTime: 도착시간 HH:MM (현지)
- gate: 게이트, seat: 좌석
모르는 값은 "". 형식: {"airline":"","flightNo":"","depAp":"","arrAp":"","depDate":"","depTime":"","arrDate":"","arrTime":"","gate":"","seat":""}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type, data: image } },
          { type: "text", text: prompt },
        ] }],
      }),
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
    res.status(200).json(parsed);
  } catch (e) {
    res.status(502).json({ error: "AI 호출 실패: " + e.message });
  }
}
