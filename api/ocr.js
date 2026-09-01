// Vercel Serverless Function: POST /api/ocr
// 카드 결제 알림 이미지를 Claude 비전으로 판독 → { items: [{date, amount, merchant, category, memo}, ...] }
// 한 이미지에 여러 건이 있으면 모두 반환. 키는 환경변수 ANTHROPIC_API_KEY.

export const config = { api: { bodyParser: { sizeLimit: "8mb" } } };

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST만 허용됩니다." }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "서버에 ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다." }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const image = body && body.image;
  const media_type = (body && body.media_type) || "image/jpeg";
  if (!image) { res.status(400).json({ error: "이미지 데이터가 없습니다." }); return; }

  const today = new Date().toISOString().slice(0, 10);
  const year = today.slice(0, 4);
  const prompt =
`이 이미지는 한국 카드 결제/사용 내역 알림 캡처입니다. (문자·카카오 알림톡·하이패스·앱 푸시 등)
한 화면에 결제 건이 여러 개면 '모두' 빠짐없이 추출하세요. JSON만 출력, 설명·코드블록 금지.

각 건마다:
- date: 결제일 "YYYY-MM-DD" (연도 안 보이면 ${year}, 날짜 전혀 없으면 "${today}")
- time: 시각 "HH:MM" (있으면)
- amount: 금액(원) 정수. 콤마·원·+ 제거. USD 등 외화 표시면 그 숫자 그대로(원화 아님 표시). 취소/환불·0원은 amount 그대로(0이면 0).
- currency: "KRW" 또는 "USD" 등 (원화면 KRW)
- merchant: 가맹점/사용처 이름 (예: 아이파킹주식회사, 올리빈, 할리스커피, 상서-안성, ANTHROPIC). 없으면 ""
- category: ["데이트비","중개소 운영비","감정 영업비","생활비","기타"] 중 가맹점 성격에 가장 가까운 하나. 애매하면 "기타". (예: 카페·주차·톨비·마트=생활비)
- memo: 카드사·승인유형(일시불) 등 짧게

주의: '누적/합계/이번달 이용내역' 같은 요약 숫자는 결제 건이 아니므로 제외. 실제 개별 결제만.
형식: {"items":[{"date":"","time":"","amount":0,"currency":"KRW","merchant":"","category":"","memo":""}]}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type, data: image } },
          { type: "text", text: prompt },
        ] }],
      }),
    });
    const data = await r.json();
    if (data.error) { res.status(502).json({ error: "AI 호출 오류: " + (data.error.message || JSON.stringify(data.error)) }); return; }

    let text = (data.content || []).map((c) => c.text || "").join("").trim();
    text = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const s = text.indexOf("{"), e = text.lastIndexOf("}");
    if (s >= 0 && e > s) text = text.slice(s, e + 1);

    let parsed;
    try { parsed = JSON.parse(text); }
    catch (err) { res.status(502).json({ error: "AI 응답을 해석하지 못했습니다.", raw: text.slice(0, 200) }); return; }

    let items = Array.isArray(parsed.items) ? parsed.items : (parsed.amount !== undefined ? [parsed] : []);
    items = items.map((it) => ({
      date: it.date || today,
      time: it.time || "",
      amount: Number(String(it.amount).replace(/[^0-9.\-]/g, "")) || 0,
      currency: it.currency || "KRW",
      merchant: it.merchant || "",
      category: it.category || "기타",
      memo: it.memo || "",
    }));
    res.status(200).json({ items });
  } catch (e) {
    res.status(502).json({ error: "AI 호출 실패: " + e.message });
  }
}
