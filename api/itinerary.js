// Vercel Serverless Function: POST /api/itinerary
//  body: { title, pax, legs:[{from,to,via?,depart:"YYYY-MM-DDTHH:MM..", arrive?:"YYYY-MM-DD"}], stops:[{name,nights,note}] }
//  → 실제 항공 날짜에 맞춘 날짜별 여행 동선 + 도시별 숙박(체크인/아웃, 추천 동네) JSON
// 키는 브라우저에 노출되지 않고 환경변수 ANTHROPIC_API_KEY 에서 읽습니다.

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["days", "stays", "tips"],
  properties: {
    days: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["date", "city", "title", "plan", "move"],
        properties: {
          date: { type: "string", description: "YYYY-MM-DD" },
          city: { type: "string", description: "그날 밤 자는 도시(한국어). 기내박이면 '기내'" },
          title: { type: "string", description: "그날 한 줄 요약" },
          plan: { type: "array", items: { type: "string" }, description: "오전·오후·저녁 순서의 할 일 3~5개" },
          move: { type: "string", description: "그날 도시 간 이동(항공·기차·버스와 소요시간). 없으면 빈 문자열" },
        },
      },
    },
    stays: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["city", "city_en", "checkin", "checkout", "area"],
        properties: {
          city: { type: "string", description: "도시(한국어)" },
          city_en: { type: "string", description: "호텔 검색용 영문 도시명, 예: Prague" },
          checkin: { type: "string", description: "YYYY-MM-DD" },
          checkout: { type: "string", description: "YYYY-MM-DD" },
          area: { type: "string", description: "숙소 잡기 좋은 동네와 이유 한 줄" },
        },
      },
    },
    tips: { type: "array", items: { type: "string" }, description: "교통패스·예약 팁 등 2~4개" },
  },
};

export default async function handler(req, res) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "서버에 ANTHROPIC_API_KEY 환경변수가 없습니다." }); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST 로 보내주세요." }); return; }

  const b = req.body || {};
  const legs = Array.isArray(b.legs) ? b.legs.slice(0, 8) : [];
  const stops = Array.isArray(b.stops) ? b.stops.slice(0, 6) : [];
  if (!legs.length) { res.status(400).json({ error: "항공 구간(legs)이 필요합니다." }); return; }
  const s = (v, n) => String(v || "").slice(0, n);

  const flights = legs.map((l, i) => `${i + 1}. ${s(l.from, 3)}→${l.via ? s(l.via, 3) + "→" : ""}${s(l.to, 3)} 출발 ${s(l.depart, 16)}${l.arrive ? ` (현지 도착 ${s(l.arrive, 10)})` : ""}`).join("\n");
  const plan = stops.map((st) => `- ${s(st.name, 80)}: ${Number(st.nights) || ""}박 — ${s(st.note, 200)}`).join("\n");
  const prompt = `두 사람(커플)이 가는 여행의 날짜별 동선을 짜 주세요.

코스: ${s(b.title, 100)}
인원: 성인 ${Number(b.pax) || 2}명

확정된 항공편(날짜는 현지 기준 출발):
${flights}

코스 설명(도시별 권장 일정, 육로 이동 포함):
${plan}

규칙:
- 첫 비행 출발일부터 마지막 비행(한국행) 출발일까지 하루도 빠짐없이 days 를 만드세요. 날짜는 항공편과 정확히 맞추세요.
- 비행 구간 사이의 도시들은 코스 설명대로 기차·버스로 이동한다고 보고, 이동하는 날은 move 에 수단과 대략 소요시간을 쓰세요.
- 각 날짜의 city 는 그날 밤 자는 도시입니다. 한국행 비행기를 타는 날과 기내에서 자는 날은 '기내'로 쓰세요.
- stays 는 실제로 숙박하는 도시별로 연속된 박을 묶어 체크인·체크아웃 날짜를 쓰세요(체크아웃 = 다음 도시로 떠나는 날). '기내'는 넣지 마세요.
- plan 은 현실적인 동선 순서(가까운 곳끼리)로, 유명 명소와 현지 음식 하나쯤을 섞어 3~5개.
- 모든 문장은 짧은 한국어로.`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2026-10-21",
        "anthropic-beta": "server-side-fallback-2026-07-01",
      },
      body: JSON.stringify({
        model: "claude-opus-5-5",
        max_tokens: 16000,
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        fallbacks: "default",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const d = await r.json();
    if (!r.ok) { res.status(502).json({ error: "동선 생성 실패: " + ((d.error && d.error.message) || r.status) }); return; }
    if (d.stop_reason === "refusal") { res.status(502).json({ error: "동선을 만들지 못했어요. 다시 시도해 주세요." }); return; }
    if (d.stop_reason === "max_tokens") { res.status(502).json({ error: "일정이 너무 길어 끝까지 만들지 못했어요." }); return; }
    const text = (d.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    let out;
    try { out = JSON.parse(text); } catch (e) { res.status(502).json({ error: "동선 응답을 읽지 못했어요." }); return; }
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: "동선 생성 호출 실패: " + e.message });
  }
}
