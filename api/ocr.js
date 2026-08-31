// Vercel Serverless Function: POST /api/ocr
// 카드 결제 알림 이미지를 Claude 비전으로 판독 → {date, amount, merchant, category, memo}
// API 키는 브라우저에 노출되지 않고 Vercel 환경변수 ANTHROPIC_API_KEY 에서 읽습니다.

export const config = { api: { bodyParser: { sizeLimit: "6mb" } } };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST만 허용됩니다." });
    return;
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    res.status(500).json({ error: "서버에 ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const image = body && body.image;
  const media_type = (body && body.media_type) || "image/jpeg";
  if (!image) { res.status(400).json({ error: "이미지 데이터가 없습니다." }); return; }

  const today = new Date().toISOString().slice(0, 10);
  const year = today.slice(0, 4);
  const prompt =
`이 이미지는 한국 신용/체크카드의 결제 승인 알림(문자 또는 앱 푸시) 캡처입니다.
아래 항목을 추출해서 JSON만 출력하세요. 설명·코드블록 없이 JSON 한 줄만.
- date: 결제일 "YYYY-MM-DD". 연도가 안 보이면 ${year}년으로, 날짜가 전혀 없으면 "${today}".
- amount: 결제 금액(원). 콤마·원·+ 기호 빼고 정수 숫자만. 취소/환불이면 음수.
- merchant: 가맹점(사용처) 이름. 없으면 "".
- category: 아래 중 가맹점 성격에 가장 가까운 하나를 추정. 애매하면 "기타".
  ["데이트비","중개소 운영비","감정 영업비","생활비","기타"]
- memo: 카드사명·승인유형(일시불/할부) 등 참고용 짧은 메모. 없으면 "".
형식: {"date":"","amount":0,"merchant":"","category":"","memo":""}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type, data: image } },
            { type: "text", text: prompt },
          ],
        }],
      }),
    });

    const data = await r.json();
    if (data.error) { res.status(502).json({ error: "AI 호출 오류: " + (data.error.message || JSON.stringify(data.error)) }); return; }

    let text = (data.content || []).map((c) => c.text || "").join("").trim();
    text = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    // 혹시 앞뒤 잡텍스트가 있으면 첫 { ~ 마지막 } 만 추출
    const s = text.indexOf("{"), e = text.lastIndexOf("}");
    if (s >= 0 && e > s) text = text.slice(s, e + 1);

    let parsed;
    try { parsed = JSON.parse(text); }
    catch (err) { res.status(502).json({ error: "AI 응답을 해석하지 못했습니다.", raw: text.slice(0, 200) }); return; }

    parsed.amount = parseInt(String(parsed.amount).replace(/[^0-9\-]/g, "")) || 0;
    if (!parsed.category) parsed.category = "기타";
    res.status(200).json(parsed);
  } catch (e) {
    res.status(502).json({ error: "AI 호출 실패: " + e.message });
  }
}
