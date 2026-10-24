// Vercel Serverless Function: /api/flights
//  ?group=short|mid|long short = 비행 1~4시간대, mid = 5~9시간대, long = 10시간 이상(대부분 경유)
//  ?win=2028-09-30..2028-10-09&flex=2 → 그 휴가 기간(앞뒤 연차 flex일까지 더 붙여도 됨)에 다녀오는 왕복 최저가 + 국가 안 이동(IN≠OUT) 추천
//  ?scan=PRG&deep=1&min=6&max=9&hol=… → 한 나라 여행: 앞으로 1년 왕복 중 연차 적게 쓰는 날짜 / 연차 더 써도 싼 날짜
//  ?legs=ICN-IST@2026-11-20,IST-TIA@2026-11-23,TIA-ICN@2026-11-27&from=2026-11-10&to=2026-12-10&extra=2&hub=IST
//     → 경유 여행 최저가 일정 TOP3 (경유 여행 추천 탭용). @날짜 간격이 계획 체류일.
//       출발일 from~to 전부를 따져, 다음 비행은 '앞 비행 현지 도착일 + 체류일' ~ +extra 일 사이만 허용.
//       hop=180 이면 중간 구간(나라 간 이동)은 비행 3시간 이내만. hub 를 주면 귀국편 후보에 '마지막 도시→허브→한국' 2장 조합도 넣습니다.
//  &origin=ALL|ICN|GMP|CJJ  (ALL = 세 공항 중 최저가)
//  &month=YYYY-MM        출발 월 (없으면 이번 달)
//  &oneway=0|1           0 = 왕복(기본), 1 = 편도
//  &direct=0|1           1 = 직항만
//  &nights=3-5           왕복일 때 여행 박수 범위 (없으면 전체)
// Travelpayouts(아비아세일즈) Data API — 최근 48시간 내 실제 검색된 최저가 캐시입니다(실시간 예약가 아님).
// 키는 브라우저에 노출되지 않고 환경변수 TRAVELPAYOUTS_TOKEN 에서 읽습니다.

// 목적지 목록: [국가, 도시, 아비아세일즈 도시코드, 인천 기준 대략 비행시간(h)]
// 도시코드(TYO·OSA·SEL 등)를 쓰면 그 도시의 공항 전체(HND/NRT 등)가 함께 잡힙니다.
const DESTS = {
  short: [
    ["일본","도쿄","TYO",2.3],["일본","오사카","OSA",1.8],["일본","후쿠오카","FUK",1.3],["일본","삿포로","SPK",2.8],["일본","오키나와","OKA",2.3],["일본","나고야","NGO",1.9],
    ["중국","베이징","BJS",2.2],["중국","상하이","SHA",2],["중국","칭다오","TAO",1.5],["중국","연태","YNT",1.3],["중국","웨이하이","WEH",1.2],["중국","톈진","TSN",1.8],["중국","다롄","DLC",1.5],["중국","옌지","YNJ",2.2],["중국","장자제","DYG",3.5],
    ["대만","타이베이","TPE",2.5],["홍콩","홍콩","HKG",3.7],["마카오","마카오","MFM",3.8],
    ["몽골","울란바토르","ULN",3.5],["러시아","블라디보스토크","VVO",2.5],
    ["필리핀","마닐라","MNL",4],["필리핀","세부","CEB",4.5],["필리핀","보라카이(칼리보)","KLO",4.3],
    ["베트남","하노이","HAN",4.5],["베트남","다낭","DAD",4.5],
    ["괌(미국)","괌","GUM",4.2],["사이판(미국)","사이판","SPN",4.2],
  ],
  mid: [
    ["베트남","호치민","SGN",5.3],["베트남","나트랑","NHA",5],["베트남","푸꾸옥","PQC",5.7],
    ["태국","방콕","BKK",5.8],["태국","푸껫","HKT",6.5],["태국","치앙마이","CNX",5.7],
    ["라오스","비엔티안","VTE",5.3],["캄보디아","프놈펜","PNH",5.5],["미얀마","양곤","RGN",6.3],
    ["싱가포르","싱가포르","SIN",6.3],["말레이시아","쿠알라룸푸르","KUL",6.5],["말레이시아","코타키나발루","BKI",5.3],
    ["인도네시아","발리","DPS",7],["인도네시아","자카르타","JKT",7],["팔라우","코로르","ROR",5],
    ["카자흐스탄","알마티","ALA",6.5],["우즈베키스탄","타슈켄트","TAS",7.3],["키르기스스탄","비슈케크","FRU",6],
    ["인도","델리","DEL",8.5],["네팔","카트만두","KTM",7.5],["스리랑카","콜롬보","CMB",8.8],
    ["미국","하와이(호놀룰루)","HNL",8.3],["호주","케언즈","CNS",8],
  ],
  // 10시간 이상: 직항 없는 곳은 경유 기준 대략 총 소요시간
  long: [
    ["미국","로스앤젤레스","LAX",11],["미국","샌프란시스코","SFO",10.5],["미국","시애틀","SEA",10],["미국","라스베이거스","LAS",11],["미국","뉴욕","NYC",14],["미국","시카고","CHI",13],
    ["캐나다","밴쿠버","YVR",10],["캐나다","토론토","YTO",13],["멕시코","칸쿤","CUN",18],
    ["영국","런던","LON",14],["프랑스","파리","PAR",14],["이탈리아","로마","ROM",13.5],["이탈리아","밀라노","MIL",13.5],["스페인","바르셀로나","BCN",14],["스페인","마드리드","MAD",14],
    ["독일","프랑크푸르트","FRA",13.5],["네덜란드","암스테르담","AMS",13.5],["스위스","취리히","ZRH",13.5],["오스트리아","비엔나","VIE",13],["체코","프라하","PRG",13],["헝가리","부다페스트","BUD",13],
    ["포르투갈","리스본","LIS",17],["그리스","아테네","ATH",15],["핀란드","헬싱키","HEL",13.5],["튀르키예","이스탄불","IST",12.5],["크로아티아","자그레브","ZAG",15],
    ["아랍에미리트","두바이","DXB",10],["카타르","도하","DOH",10.5],["이집트","카이로","CAI",15],["모로코","마라케시","RAK",19],["남아공","케이프타운","CPT",20],["케냐","나이로비","NBO",16],
    ["몰디브","말레","MLE",11],["호주","시드니","SYD",10.5],["호주","멜버른","MEL",11],["호주","브리즈번","BNE",10],["뉴질랜드","오클랜드","AKL",11.5],
    ["그리스","산토리니","JTR",16],["세르비아","베오그라드","BEG",14],["몬테네그로","포드고리차(코토르)","TGD",15],["보스니아","사라예보","SJJ",15],["북마케도니아","스코페","SKP",15],
    ["불가리아","소피아","SOF",14],["루마니아","부쿠레슈티","BUH",14],["슬로베니아","류블랴나","LJU",15],["슬로바키아","브라티슬라바","BTS",14],["크로아티아","두브로브니크","DBV",15],["크로아티아","스플리트","SPU",15],
    ["폴란드","크라쿠프","KRK",14],["리투아니아","빌뉴스","VNO",14],["라트비아","리가","RIX",14],["에스토니아","탈린","TLL",14],
    ["조지아","트빌리시","TBS",11],["요르단","암만","AMM",13],["알바니아","티라나","TIA",15],["폴란드","바르샤바","WAW",12.5],["덴마크","코펜하겐","CPH",14],["노르웨이","오슬로","OSL",14],
    ["아일랜드","더블린","DUB",15],["아이슬란드","레이캬비크","REK",17],["미국","보스턴","BOS",14.5],["미국","마이애미","MIA",17],["쿠바","하바나","HAV",21],["탄자니아","잔지바르","ZNZ",16],
    ["페루","리마","LIM",22],["칠레","산티아고","SCL",25],["브라질","상파울루","SAO",26],["아르헨티나","부에노스아이레스","BUE",28],
  ],
};
// 경유 공항은 Travelpayouts 시세 데이터에 없어서 표시하지 않음(짐작 금지). 경유 여행은 구간을 직접 나눠 가격을 매김.
const ORIGINS = ["ICN","GMP","CJJ"];
// 국가 안 이동 코스: [국가, 설명, 들어가는 공항, 나오는 공항, 현지 이동, 최소 휴가일수]
const OPENJAW = [
  ["우즈베키스탄","사마르칸트 → 타슈켄트","SKD","TAS","고속열차 아프로시욥 약 2시간",5],
  ["일본","도쿄 → 오사카","TYO","OSA","신칸센 약 2시간 30분",4],
  ["일본","삿포로 → 도쿄","SPK","TYO","국내선 1시간 30분",5],
  ["대만","가오슝 → 타이베이","KHH","TPE","고속철 약 1시간 30분",4],
  ["베트남","하노이 → 호치민","HAN","SGN","국내선 2시간",6,1],
  ["베트남","다낭 → 나트랑","DAD","NHA","국내선 1시간 10분·기차",5,1],
  ["태국","치앙마이 → 방콕","CNX","BKK","국내선 1시간 10분",5,1],
  ["중국","베이징 → 상하이","BJS","SHA","고속철 약 4시간 30분",5],
  ["이탈리아","로마 → 밀라노","ROM","MIL","고속열차 약 3시간",8],
  ["스페인","바르셀로나 → 마드리드","BCN","MAD","고속열차 약 2시간 30분",8],
  ["프랑스","파리 → 니스","PAR","NCE","국내선 1시간 30분·TGV 6시간",8],
  ["튀르키예","카파도키아 → 이스탄불","NAV","IST","국내선 1시간 20분",7],
  ["호주","시드니 → 멜버른","SYD","MEL","국내선 1시간 30분",8],
  ["미국","샌프란시스코 → 로스앤젤레스","SFO","LAX","국내선 1시간 30분·1번 국도 드라이브",8],
  // 동유럽·발칸: 들어가고 나오는 나라가 달라도 육로·짧은 비행으로 이어지는 코스
  ["체코·오스트리아·헝가리","프라하 → 비엔나 → 부다페스트","PRG","BUD","기차 4시간 + 2시간 30분",8],
  ["크로아티아","자그레브 → 플리트비체 → 스플리트 → 두브로브니크","ZAG","DBV","버스(해안도로)",8],
  ["크로아티아·몬테네그로","두브로브니크 → 코토르 → 포드고리차","DBV","TGD","버스 2시간 + 2시간",8],
  ["슬로베니아·크로아티아","류블랴나(블레드) → 자그레브","LJU","ZAG","기차·버스 2시간 30분",8],
  ["폴란드","크라쿠프 → 바르샤바","KRK","WAW","기차 2시간 30분",8],
  ["발트 3국","빌뉴스 → 리가 → 탈린","VNO","TLL","버스 4시간 + 4시간",9],
  ["그리스","아테네 → 산토리니","ATH","JTR","페리 5~8시간·국내선 45분",8],
  ["세르비아·보스니아","베오그라드 → 사라예보","BEG","SJJ","버스 7시간·국내선 1시간",9],
  ["불가리아·루마니아","소피아 → 부쿠레슈티","SOF","BUH","버스 6시간",9],
  ["그리스·북마케도니아·알바니아","테살로니키 → 오흐리드 → 티라나","SKG","TIA","버스 5시간 + 3시간",7],
  ["세르비아·보스니아·크로아티아","베오그라드 → 사라예보 → 두브로브니크","BEG","DBV","버스 7시간 + 5시간",8],
  ["몬테네그로·알바니아","포드고리차(코토르) → 티라나","TGD","TIA","버스 4시간",6],
  ["그리스","아테네 → 크레타","ATH","HER","페리·국내선 50분",6],
  // 중앙아시아·코카서스·튀르키예·중국 국가 내/육로 일주
  ["우즈베키스탄","타슈켄트 → 사마르칸트 → 부하라 → 타슈켄트","TAS","TAS","고속열차 아프로시욥(타슈켄트↔사마르칸트 2시간, ↔부하라 1시간 30분)",5],
  ["카자흐스탄","알마티 → 아스타나","ALA","NQZ","국내선 1시간 40분·야간열차",6],
  ["카자흐스탄·키르기스스탄","알마티 → 비슈케크(이식쿨)","ALA","FRU","국경 버스 4시간",6],
  ["조지아·아르메니아","트빌리시(카즈베기) → 예레반","TBS","EVN","국경 버스 5~6시간",6],
  ["아르메니아·조지아","예레반(세반 호수) → 트빌리시","EVN","TBS","국경 버스 5~6시간",6],
  ["조지아","트빌리시 → 카즈베기 → 쿠타이시 → 바투미","TBS","BUS","기차 5시간(트빌리시↔바투미)",6],
  ["조지아","바투미(흑해) → 트빌리시","BUS","TBS","기차 5시간",5],
  ["아제르바이잔·조지아","바쿠 → 트빌리시","GYD","TBS","야간열차·국제선 1시간",6],
  ["튀르키예","이스탄불 → 카파도키아 → 파묵칼레 → 이즈미르(에페소)","IST","IZM","국내선 1시간 20분 + 야간버스",7],
  ["튀르키예","이스탄불 → 안탈리아","IST","AYT","국내선 1시간 20분",6],
  ["중국","베이징 → 시안","BJS","XIY","고속철 약 4시간 30분",5],
  ["중국","시안 → 청두","XIY","CTU","고속철 약 3시간 30분",5],
  ["그리스","아테네 → 메테오라 → 테살로니키","ATH","SKG","기차 4시간 + 3시간",7],
];

// 같은 조회는 10분간 재사용 (한 번의 요청 안에서도, 같은 인스턴스의 다음 요청에서도).
// 여러 코스가 ICN→IST·IST→ICN 같은 구간을 공유해서 Travelpayouts 호출이 크게 줄어듦. 진행 중인 조회도 같이 기다림.
const MEMO = new Map(), MEMO_MS = 10 * 60000;
function cheapest(token, origin, dest, q) {
  const key = [origin, dest, q.month || "", q.ret || "", q.oneway ? 1 : 0, q.direct ? 1 : 0, q.limit || 5].join("|");
  const hit = MEMO.get(key);
  if (hit && Date.now() - hit.t < MEMO_MS) return hit.v;
  const v = cheapestRaw(token, origin, dest, q);
  MEMO.set(key, { t: Date.now(), v });
  v.then((r) => { if (r === null) MEMO.delete(key); }, () => MEMO.delete(key)); // 실패는 저장 안 함
  if (MEMO.size > 4000) for (const [k, x] of MEMO) { if (Date.now() - x.t >= MEMO_MS || MEMO.size > 3000) MEMO.delete(k); else break; }
  return v;
}
async function cheapestRaw(token, origin, dest, q) {
  const p = new URLSearchParams({
    origin, destination: dest, departure_at: q.month, currency: "krw", market: "kr",
    one_way: q.oneway ? "true" : "false", direct: q.direct ? "true" : "false",
    sorting: "price", limit: String(q.limit || 5), token,
  });
  if (q.ret) p.set("return_at", q.ret);
  if (!q.month) p.delete("departure_at"); // 날짜 없이 = 앞으로 전체 날짜 중 최저가
  let r;
  for (let t = 0; t < 3; t++) { // 요청 제한(429)이면 잠깐 쉬고 다시
    r = await fetch("https://api.travelpayouts.com/aviasales/v3/prices_for_dates?" + p);
    if (r.status !== 429) break;
    await new Promise((ok) => setTimeout(ok, 800 * (t + 1)));
  }
  if (r.status === 401) throw new Error("TOKEN");
  if (!r.ok) return null;
  const d = await r.json();
  const rows = d && d.success && Array.isArray(d.data) ? d.data : [];
  // 경유는 최대 2회까지만 (가는 편·오는 편 각각)
  return rows.filter((t) => t && t.price && (t.transfers || 0) <= 2 && (t.return_transfers || 0) <= 2).map((t) => ({
    origin: t.origin_airport || origin, destAp: t.destination_airport || dest,
    price: t.price, airline: t.airline || "", flightNo: t.flight_number || "",
    departAt: t.departure_at || "", returnAt: t.return_at || "",
    transfers: t.transfers ?? null, returnTransfers: t.return_transfers ?? null,
    durationMin: t.duration_to || t.duration || null,
    durationBackMin: t.duration_back || null,
    link: t.link ? "https://www.aviasales.com" + t.link : "",
  }));
}

// 동시 요청 수를 n개로 제한해서 병렬 처리
async function pool(jobs, n) {
  const out = new Array(jobs.length); let i = 0;
  async function worker() { while (i < jobs.length) { const k = i++; try { out[k] = await jobs[k](); } catch (e) { if (e.message === "TOKEN") throw e; out[k] = null; } } }
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, worker));
  return out;
}

export default async function handler(req, res) {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  if (!token) { res.status(500).json({ error: "서버에 TRAVELPAYOUTS_TOKEN 환경변수가 없습니다. (travelpayouts.com 가입 → API 토큰)" }); return; }

  const now = new Date();
  let month = (req.query.month || "").toString();
  if (!/^\d{4}-\d{2}$/.test(month)) month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // 한 나라 여행: scan=PRG,BUD&og=ICN&deep=1&min=6&max=9&hol=2027-01-01,...
  //  → 앞으로 1년 왕복 날짜 조합마다 연차 일수(주말·hol 제외 근무일, 저녁 8시 이후 출발이면 출발일은 퇴근 후라 안 셈)를 계산해
  //    low = 연차 적게 쓰는 순, cheap = 연차 더 써도 싼 순, byLeave = 연차 일수별 싼 순, best = 공항별 최저가
  //  fix=출발일..귀국편 출발일 → 그 날짜 왕복 최저가 하나 (찜 가격 재확인용, trips 형식)
  if (req.query.scan) {
    const addDay = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
    const codes = [...new Set(req.query.scan.toString().toUpperCase().split(",").filter((c) => /^[A-Z]{3}$/.test(c)))].slice(0, 24);
    const ogs = [...new Set((req.query.og || "ICN").toString().toUpperCase().split(",").filter((o) => ORIGINS.includes(o)))];
    if (!codes.length || !ogs.length) { res.status(400).json({ error: "scan=PRG,BUD 형식이 필요해요." }); return; }
    const today = new Date(Date.now() + 540 * 60000).toISOString().slice(0, 10), tomorrow = addDay(today, 1);
    const arrKST = (x) => { const m = x.durationBackMin || x.durationMin; return m && x.returnAt ? new Date(Date.parse(x.returnAt) + m * 60000 + 540 * 60000).toISOString().slice(0, 10) : null; };
    try {
      const fix = (req.query.fix || "").toString().split("..");
      if (/^\d{4}-\d{2}-\d{2}$/.test(fix[0] || "") && /^\d{4}-\d{2}-\d{2}$/.test(fix[1] || "")) {
        const r = (await pool(codes.flatMap((c) => ogs.map((og) => () => cheapest(token, og, c, { month: fix[0], ret: fix[1], oneway: false, direct: false, limit: 30 }))), 6)).flat().filter(Boolean)
          .filter((x) => x.departAt.slice(0, 10) === fix[0] && (x.returnAt || "").slice(0, 10) === fix[1]).sort((a, b) => a.price - b.price)[0];
        res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate");
        res.status(200).json({ trips: r ? [{ total: r.price, legs: [{ from: r.origin, to: r.destAp, departAt: r.departAt }, { from: r.destAp, to: r.origin, departAt: r.returnAt, arrDate: arrKST(r) }] }] : [] });
        return;
      }
      const min = Math.max(2, Math.min(30, parseInt(req.query.min, 10) || 3)), max = Math.max(min, Math.min(30, parseInt(req.query.max, 10) || 30));
      const hol = new Set((req.query.hol || "").toString().split(",").filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)));
      const off = (d) => { const w = new Date(d + "T00:00:00Z").getUTCDay(); return w === 0 || w === 6 || hol.has(d); };
      // 깊게(나라 하나): 첫 출발공항(인천)은 앞으로 12개월 달마다, 나머지 공항(김포·청주)은 날짜 없이 한 번에 / 얕게(지역 전체): 전부 한 번에
      const deep = req.query.deep === "1" && codes.length <= 9;
      const months12 = Array.from({ length: 12 }, (_, k) => { const t = new Date(today + "T00:00:00Z"); t.setUTCDate(1); t.setUTCMonth(t.getUTCMonth() + k); return t.toISOString().slice(0, 7); });
      const rows = (await pool(codes.flatMap((c) => ogs.flatMap((og, oi) => (deep && oi === 0 ? months12 : [null]).map((m) => () => cheapest(token, og, c, { month: m, oneway: false, direct: false, limit: m ? 300 : 1000 }).then((r) => (r || []).map((x) => ({ ...x, code: c })))))), 10)).flat().filter(Boolean);
      const seen = {}, opts = [];
      rows.forEach((x) => {
        const dep = x.departAt.slice(0, 10), back = (x.returnAt || "").slice(0, 10); if (!back || dep < tomorrow) return;
        const arr = arrKST(x) || addDay(back, 1), days = Math.round((new Date(arr) - new Date(dep)) / 86400000) + 1;
        if (days < min || days > max) return;
        const k = x.code + dep + back; if (seen[k] && seen[k].p <= x.price) return;
        const eve = !off(dep) && +x.departAt.slice(11, 13) >= 20; // 퇴근 후 출발
        const lv = []; for (let d = eve ? addDay(dep, 1) : dep; d <= arr; d = addDay(d, 1)) if (!off(d)) lv.push(d);
        const o = { c: x.code, ap: x.destAp, o: x.origin, dep: x.departAt, ret: x.returnAt, arr, days, leave: lv.length, lv, eve, p: x.price, t: x.transfers, rt: x.returnTransfers, al: x.airline, link: x.link };
        if (seen[k]) opts[opts.indexOf(seen[k])] = o; else opts.push(o); seen[k] = o;
      });
      // 같은 출발일은 하나만
      const top = (arr, n) => { const used = new Set(), out = []; for (const o of arr) { const k = o.dep.slice(0, 10); if (used.has(k)) continue; used.add(k); out.push(o); if (out.length >= n) break; } return out; };
      const best = {}; opts.forEach((o) => { if (!best[o.c] || o.p < best[o.c].p) best[o.c] = o; });
      // 연차 일수별(0·1·2…·7+) 싼 순 3개씩
      const byLeave = {}; opts.slice().sort((a, b) => a.p - b.p).forEach((o) => { const k = Math.min(o.leave, 7); (byLeave[k] = byLeave[k] || []).push(o); });
      Object.keys(byLeave).forEach((k) => { byLeave[k] = top(byLeave[k], 3); });
      res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate");
      res.status(200).json({
        checked: opts.length, deep,
        low: top(opts.slice().sort((a, b) => a.leave - b.leave || a.p - b.p || b.days - a.days), 8),
        cheap: top(opts.slice().sort((a, b) => a.p - b.p || a.leave - b.leave), 8),
        best: Object.values(best).sort((a, b) => a.p - b.p),
        byLeave,
      });
    } catch (e) {
      if (e.message === "TOKEN") { res.status(502).json({ error: "Travelpayouts 토큰이 올바르지 않습니다." }); return; }
      res.status(502).json({ error: "한 나라 여행 조회 실패: " + e.message });
    }
    return;
  }

  // 휴가 기간 맞춤 추천: win=YYYY-MM-DD..YYYY-MM-DD → 왕복 최저가 + 국가 안 이동(IN≠OUT)
  if (req.query.win) {
    const [ws, we] = req.query.win.toString().split("..");
    const okd = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");
    if (!okd(ws) || !okd(we) || we < ws) { res.status(400).json({ error: "win 형식: 2028-09-30..2028-10-09" }); return; }
    const addDay = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
    const len = Math.round((new Date(we) - new Date(ws)) / 86400000) + 1;
    const arrKST = (x) => x.durationMin ? new Date(Date.parse(x.departAt) + x.durationMin * 60000 + 540 * 60000).toISOString().slice(0, 10) : null;
    // flex: 앞뒤로 연차를 최대 며칠 더 붙여도 되는지 (더 일찍 출발 / 더 늦게 귀국)
    const F = Math.min(3, Math.max(0, parseInt(req.query.flex, 10) || 0)), wsF = addDay(ws, -F), weF = addDay(we, F);
    const backOk = (x) => { const d = x.departAt.slice(0, 10); const a = arrKST(x); return d >= addDay(we, -1 - F) && (a ? a <= weF : d < weF); };
    const goOk = (x) => { const d = x.departAt.slice(0, 10); return d >= wsF && d <= addDay(ws, 1); };
    const depMonths = [...new Set([wsF.slice(0, 7), addDay(ws, 1).slice(0, 7)])];
    const groups = len <= 4 ? ["short"] : len <= 8 ? ["short", "mid"] : ["short", "mid", "long"];
    const skip = (req.query.skip || "").toString().split(",").map((x) => x.trim()).filter(Boolean);
    const skipped = (country) => skip.some((c) => country.includes(c));
    try {
      // 왕복: 단거리는 인천·김포·청주, 나머지는 인천
      const jobs = [];
      if (req.query.rt !== "0") groups.forEach((g) => DESTS[g].filter((d) => !skipped(d[0])).forEach((d) => (g === "short" ? ORIGINS : ["ICN"]).forEach((og) => jobs.push(async () => {
        const r = (await Promise.all(depMonths.map((m) => cheapest(token, og, d[2], F ? { month: m, oneway: false, direct: false, limit: 200 } : { month: m, ret: we.slice(0, 7), oneway: false, direct: false, limit: 100 })))).flat().filter(Boolean);
        const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
        const ok = r.filter((x) => goOk(x) && x.returnAt && x.returnAt.slice(0, 10) <= weF && x.returnAt.slice(0, 10) >= addDay(we, -1 - F) && days(x.departAt.slice(0, 10), x.returnAt.slice(0, 10)) >= len - 2).sort((a, b) => a.price - b.price)[0];
        return ok ? { country: d[0], city: d[1], code: d[2], hours: d[3], ...ok } : null;
      }))));
      // 국가 안 이동: 들어가는 도시와 나오는 도시가 다른 편도 2장
      OPENJAW.filter((o) => len >= o[5] && (!o[6] || req.query.sea !== "0") && !skipped(o[0])).forEach((o) => jobs.push(async () => {
        const [go, back] = await Promise.all([[`ICN`, o[2], ws], [o[3], `ICN`, we]].map(([a, b, d]) =>
          Promise.all([...new Set([addDay(d, -1 - F).slice(0, 7), addDay(d, 1 + F).slice(0, 7)])].map((m) => cheapest(token, a, b, { month: m, oneway: true, direct: false, limit: 100 }))).then((x) => x.flat().filter(Boolean))));
        const g = go.filter(goOk).sort((a, b) => a.price - b.price)[0], b = back.filter(backOk).sort((a, b) => a.price - b.price)[0];
        return g && b ? { openjaw: true, country: o[0], city: o[1], inCode: o[2], outCode: o[3], move: o[4], price: g.price + b.price, go: g, back: b } : null;
      }));
      const out = (await pool(jobs, 10)).filter(Boolean);
      // 도시별 최저가 하나만(출발공항 중복 제거)
      const rt = {}; out.filter((x) => !x.openjaw).forEach((x) => { if (!rt[x.code] || x.price < rt[x.code].price) rt[x.code] = x; });
      res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate");
      res.status(200).json({ win: [ws, we], len, flex: F, roundtrip: Object.values(rt).sort((a, b) => a.price - b.price), openjaw: out.filter((x) => x.openjaw).sort((a, b) => a.price - b.price) });
    } catch (e) {
      if (e.message === "TOKEN") { res.status(502).json({ error: "Travelpayouts 토큰이 올바르지 않습니다." }); return; }
      res.status(502).json({ error: "휴가 맞춤 추천 실패: " + e.message });
    }
    return;
  }

  // 경유 여행 최저가 일정 찾기: legs=ICN-IST@YYYY-MM-DD,... (@날짜 간격 = 계획 체류일)
  if (req.query.legs) {
    const legs = req.query.legs.toString().toUpperCase().split(",").map((x) => { const [r, date] = x.split("@"); const [a, b] = (r || "").split("-"); return { a, b, date }; })
      .filter((x) => /^[A-Z]{3}$/.test(x.a || "") && /^[A-Z]{3}$/.test(x.b || "") && /^\d{4}-\d{2}-\d{2}$/.test(x.date || "")).slice(0, 6);
    if (!legs.length) { res.status(400).json({ error: "legs 형식: ICN-IST@2026-11-20,IST-TIA@2026-11-22" }); return; }
    const addDay = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
    const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");
    // 출발일 검색 범위 [from, to] (최대 45일), 체류 늘리기 extra(0~3박)
    const from = isDate(req.query.from) ? req.query.from : legs[0].date;
    let to = isDate(req.query.to) && req.query.to >= from ? req.query.to : from;
    if (to > addDay(from, 45)) to = addDay(from, 45);
    const extra = Math.min(8, Math.max(0, parseInt(req.query.extra, 10) || 0)); // 체류를 최대 몇 박까지 늘려도 되는지 (end 로 전체 길이 제한)
    const end = isDate(req.query.end) ? req.query.end : ""; // 이 날까지 한국 도착(휴가 끝)
    const hop = parseInt(req.query.hop, 10) || 0; // 중간 구간(나라 간 이동) 최대 비행 분
    const stays = legs.map((l, i) => (i ? Math.round((new Date(l.date) - new Date(legs[i - 1].date)) / 86400000) : 0));
    const total = stays.reduce((x, y) => x + y, 0) + extra * (legs.length - 1) + 2;
    // 귀국편 대체 환승지: hub(코스의 첫 도시) + 대표 환승지들. 귀국 직항·직접 경유편이 없을 때만 시도
    // 지역에 맞는 환승지만 (클라이언트가 hubs=IST,FRA,... 로 지정). 없으면 코스 첫 도시만
    const hubs = [...new Set([(req.query.hub || "").toString().toUpperCase(), ...(req.query.hubs || "").toString().toUpperCase().split(",")])].filter((h) => /^[A-Z]{3}$/.test(h)).slice(0, 6);
    // 현지 날짜: 출발시각의 UTC 오프셋 + 비행시간으로 도착 추정
    const offMin = (iso) => { const m = /([+-])(\d\d):?(\d\d)$/.exec(iso || ""); return m ? (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0; };
    const arrAbs = (x) => Date.parse(x.departAt) + (x.durationMin || 0) * 60000;
    const localDate = (abs, off) => new Date(abs + off * 60000).toISOString().slice(0, 10);
    const monthsOf = (lo, hi) => { const out = []; let m = lo.slice(0, 7); while (m <= hi.slice(0, 7)) { out.push(m); const [y, mm] = m.split("-").map(Number); m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`; } return out; };
    const fetchAll = async (a, b, lo, hi) => (await Promise.all(monthsOf(lo, hi).map((m) => cheapest(token, a, b, { month: m, oneway: true, direct: false, limit: 300 }).catch((e) => { if (e.message === "TOKEN") throw e; return []; })))).flat().filter((x) => x && x.departAt);
    try {
      const hi = addDay(to, total);
      // 구간마다 실제로 출발할 수 있는 기간의 달만 조회 (i번째 구간 = 출발일 + 앞 체류 합 ~ +늘린 박·도착 하루 여유)
      const cum = stays.map((_, i) => stays.slice(1, i + 1).reduce((x, y) => x + y, 0));
      const win = legs.map((_, i) => (i === 0 ? [from, to] : [addDay(from, cum[i] - 1), ((h) => (h < hi ? h : hi))(addDay(to, cum[i] + i * (extra + 1) + 1))]));
      const opts = await Promise.all(legs.map((l, i) => fetchAll(l.a, l.b, win[i][0], win[i][1])));
      // 귀국편: 마지막 도시→허브→한국 2장 이어 붙인 조합도 후보로 (환승 1시간 이상, 다음날까지)
      const li = legs.length - 1, last = legs[li];
      const directBack = opts[li].length;
      for (const hub of hubs) {
        if (!ORIGINS.includes(last.b) || hub === last.a || hub === last.b) continue;
        if (directBack && hub !== hubs[0]) break; // 귀국편이 있으면 코스 허브만 비교
        if (opts[li].length > directBack + 30) break; // 대체 경로를 충분히 찾았으면 그만
        const [p1, p2] = await Promise.all([fetchAll(last.a, hub, win[li][0], win[li][1]), fetchAll(hub, last.b, win[li][0], addDay(win[li][1], 1))]);
        p1.forEach((x) => { let best = null; const arr = arrAbs(x);
          p2.forEach((y) => { if (Date.parse(y.departAt) < arr + 60 * 60000 || y.departAt.slice(0, 10) > addDay(x.departAt.slice(0, 10), 1)) return; if (!best || y.price < best.price) best = y; });
          if (best && (x.transfers || 0) + (best.transfers || 0) + 1 > 2) best = null; // 이어 붙여도 경유 2회까지
          if (best) opts[li].push({ ...x, price: x.price + best.price, durationMin: best.durationMin ? Math.round((arrAbs(best) - Date.parse(x.departAt)) / 60000) : null,
            transfers: (x.transfers || 0) + (best.transfers || 0) + 1, airline: [x.airline, best.airline].filter(Boolean).join("+"), via: hub, link: "",
            parts: [{ from: last.a, to: hub, ...x }, { from: hub, to: last.b, ...best }] }); });
      }
      // 첫 구간(한국 → 첫 도시)도 표가 드물면 '한국→허브→첫 도시' 2장 조합을 후보로 (환승 1시간 이상, 다음날까지)
      const first = legs[0], directGo = opts[0].filter((x) => x.departAt.slice(0, 10) >= from && x.departAt.slice(0, 10) <= to).length;
      if (ORIGINS.includes(first.a) && directGo < 3) {
        const pairs = await Promise.all(hubs.filter((h) => h !== first.a && h !== first.b).map(async (hub) => [hub, ...(await Promise.all([fetchAll(first.a, hub, from, addDay(to, 1)), fetchAll(hub, first.b, from, addDay(to, 2))]))]));
        for (const [hub, p1, p2] of pairs) {
          p1.filter((x) => x.departAt.slice(0, 10) >= from && x.departAt.slice(0, 10) <= to).forEach((x) => { let best = null; const arr = arrAbs(x);
            p2.forEach((y) => { if (Date.parse(y.departAt) < arr + 60 * 60000 || y.departAt.slice(0, 10) > addDay(x.departAt.slice(0, 10), 1)) return; if (!best || y.price < best.price) best = y; });
            if (best && (x.transfers || 0) + (best.transfers || 0) + 1 > 2) best = null;
            if (best) opts[0].push({ ...x, price: x.price + best.price, durationMin: best.durationMin ? Math.round((arrAbs(best) - Date.parse(x.departAt)) / 60000) : null,
              transfers: (x.transfers || 0) + (best.transfers || 0) + 1, airline: [x.airline, best.airline].filter(Boolean).join("+"), via: hub, link: "",
              parts: [{ from: first.a, to: hub, ...x }, { from: hub, to: first.b, ...best }] }); });
        }
      }
      // 출발일마다: 앞 비행 현지 도착일 + 체류일 ~ +extra 일 사이 다음 비행 중 누적 최저가 (구간별 DP)
      const starts = [...new Set(opts[0].map((x) => x.departAt.slice(0, 10)).filter((d) => d >= from && d <= to))].sort();
      const trips = [];
      starts.forEach((sd) => {
        let states = opts[0].filter((x) => x.departAt.slice(0, 10) === sd).map((x) => ({ cost: x.price, ext: 0, chain: [x] }));
        for (let i = 1; i < legs.length && states.length; i++) {
          const next = [];
          opts[i].forEach((x) => {
            const d = x.departAt.slice(0, 10); let best = null, bestExt = 0;
            if (end && i === legs.length - 1 && (x.durationMin ? localDate(arrAbs(x), 540) > end : d >= end)) return;
            if (hop && i < legs.length - 1 && x.durationMin && x.durationMin > hop) return;
            states.forEach((st) => { const p = st.chain[st.chain.length - 1]; const min = addDay(localDate(arrAbs(p), offMin(x.departAt)), stays[i]);
              if (d < min || d > addDay(min, extra) || Date.parse(x.departAt) <= arrAbs(p)) return;
              const ext = st.ext + Math.round((new Date(d) - new Date(min)) / 86400000);
              // 같은 값이면 체류를 덜 늘린 쪽(계획에 가까운 일정)
              if (!best || st.cost < best.cost || (st.cost === best.cost && ext < bestExt)) { best = st; bestExt = ext; } });
            if (best) next.push({ cost: best.cost + x.price, ext: bestExt, chain: [...best.chain, x] });
          });
          states = next;
        }
        const done = states.filter((st) => st.chain.length === legs.length).sort((x, y) => x.cost - y.cost || x.ext - y.ext)[0];
        if (done) trips.push(done);
      });
      trips.sort((x, y) => x.cost - y.cost || x.ext - y.ext);
      const fmt = (st) => ({ total: st.cost, extraNights: st.ext, legs: st.chain.map((x, i) => ({ from: legs[i].a, to: legs[i].b, target: legs[i].date, ...x,
        arrDate: x.durationMin ? localDate(arrAbs(x), ORIGINS.includes(legs[i].b) ? 540 : i + 1 < st.chain.length ? offMin(st.chain[i + 1].departAt) : offMin(x.departAt)) : null })) });
      // 출발 시점에 그 구간에 가격 자체가 없는 경우 알려주기
      const empty = legs.map((l, i) => (opts[i].length ? null : `${l.a}→${l.b}`)).filter(Boolean);
      res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate");
      // 왜 안 나왔는지: 구간별로 찾은 가격 개수(+ 첫 비행이 출발 가능일에 있는지)
      const counts = legs.map((l, i) => ({ leg: `${l.a}→${l.b}`, n: opts[i].length, viaHub: opts[i].some((x) => x.via) }));
      res.status(200).json({ from, to, extra, trips: trips.slice(0, 3).map(fmt), checked: starts.length, empty, counts, startsInRange: starts.length });
    } catch (e) {
      if (e.message === "TOKEN") { res.status(502).json({ error: "Travelpayouts 토큰이 올바르지 않습니다." }); return; }
      res.status(502).json({ error: "경유 여행 가격 조회 실패: " + e.message });
    }
    return;
  }

  const group = (req.query.group || "short").toString();
  const list = DESTS[group];
  if (!list) { res.status(400).json({ error: "group 은 short, mid, long 중 하나여야 합니다." }); return; }
  const o = (req.query.origin || "ALL").toString().toUpperCase();
  const origins = o === "ALL" ? ORIGINS : ORIGINS.includes(o) ? [o] : null;
  if (!origins) { res.status(400).json({ error: "origin 은 ALL, ICN, GMP, CJJ 중 하나여야 합니다." }); return; }
  const q = { month, oneway: req.query.oneway === "1", direct: req.query.direct === "1", limit: 30 };
  const nm = /^(\d+)-(\d+)$/.exec((req.query.nights || "").toString());
  const nightsOf = (x) => x.returnAt ? Math.round((new Date(x.returnAt.slice(0, 10)) - new Date(x.departAt.slice(0, 10))) / 86400000) : null;
  const nightsOk = (x) => q.oneway || !nm || ((n) => n != null && n >= +nm[1] && n <= +nm[2])(nightsOf(x));

  try {
    const jobs = [];
    // 김포는 단거리만, 청주는 중거리까지, 장거리는 인천만 (불필요한 요청을 줄여 요청 제한 회피)
    const ogs = origins.filter((og) => og === "ICN" || (og === "GMP" && group === "short") || (og === "CJJ" && group !== "long"));
    list.forEach((d, di) => (ogs.length ? ogs : origins).forEach((og) => jobs.push(async () => ({ di, opts: (await cheapest(token, og, d[2], q)) || [] }))));
    const found = await pool(jobs, 10);
    // 목적지별로 출발공항 전체의 후보를 모아 최저가 + 직항 최저가 + 경유 방법(환승지별 최저가 최대 3개)
    const opts = {};
    found.forEach((r) => { if (r) (opts[r.di] = opts[r.di] || []).push(...r.opts); });
    const results = list.map((d, di) => {
      const all = (opts[di] || []).filter(nightsOk).map((x) => ({ ...x, nights: nightsOf(x) })).sort((a, b) => a.price - b.price);
      // 왕복 최저가 날짜 추천: 출발일이 겹치지 않게 상위 3개
      const dates = []; const dset = new Set();
      all.forEach((x) => { const k = (x.departAt || "").slice(0, 10); if (k && !dset.has(k) && dates.length < 3) { dset.add(k); dates.push(x); } });
      const direct = all.find((x) => x.transfers === 0) || null;
      const vias = []; const seen = new Set();
      all.forEach((x) => { const k = x.airline; if (x.transfers > 0 && !seen.has(k) && vias.length < 3) { seen.add(k); vias.push(x); } });
      // 여행 기간 조건에 맞는 게 없으면 다른 기간 최저가를 참고로
      const alt = !all.length && nm ? (opts[di] || []).slice().sort((a, b) => a.price - b.price).map((x) => ({ ...x, nights: nightsOf(x) }))[0] || null : null;
      return { country: d[0], city: d[1], code: d[2], hours: d[3], ...(all[0] || { price: null }), direct, vias, dates, alt };
    });
    res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate");
    res.status(200).json({ group, month, origins, oneway: q.oneway, direct: q.direct, results });
  } catch (e) {
    if (e.message === "TOKEN") { res.status(502).json({ error: "Travelpayouts 토큰이 올바르지 않습니다." }); return; }
    res.status(502).json({ error: "항공권 시세 조회 실패: " + e.message });
  }
}
