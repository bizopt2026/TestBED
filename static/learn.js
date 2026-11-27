"use strict";
// ================================================================ 🎓 학습 센터: 과정·강의, 실제 화면 따라하기(투어), 퀴즈, CPM 실습, 여유일 시뮬레이터

// ---------------------------------------------------------------- 진도 저장 (계정별 서버 저장, 공개 모드는 브라우저 ID 기준)
const learnId = (() => { let id = store.get("learnId"); if (!id) { id = (crypto.randomUUID?.() || String(Math.random()).slice(2)).replace(/[^A-Za-z0-9-]/g, ""); store.set("learnId", id); } return id; })();
let LP = null;
async function lpLoad() {
  if (LP) return LP;
  try { LP = await api(`/api/learn/progress?client_id=${learnId}`); } catch { LP = null; }
  LP = { done: [], quiz: {}, ...(LP || {}) };
  return LP;
}
async function lpSave() { try { await api(`/api/learn/progress?client_id=${learnId}`, { method: "PUT", json: { data: LP } }); } catch {} }
async function markDone(lessonId) { await lpLoad(); if (!LP.done.includes(lessonId)) { LP.done.push(lessonId); await lpSave(); } }

// ---------------------------------------------------------------- 과정 데이터
// step 종류: text(html) | tour(tab, steps[{sel,title,body,wait?:'click'|'change'}]) | quiz(q, options, answer, explain) | cpm | sim
const COURSES = [
  { id: "start", icon: "🚀", title: "1. 시작하기", desc: "앱 구성, 파일 올리기, 프로젝트 화면 둘러보기", lessons: [
    { id: "start-1", title: "이 앱으로 무엇을 하나요?", steps: [
      { type: "text", html: `<p>이 앱은 <b>Primavera P6에서 내보낸 XER 파일</b>(또는 MS Project XML)을 올리면 공정표를 다시 계산(CPM)하고,
        품질 점검, 지연 원인, 리스크, 만회안, 현장 운영, 보고서까지 한곳에서 처리하는 <b>팀 공유 공정관리 도구</b>입니다.</p>
        <ul><li><b>계산은 엔진이</b>: 날짜와 여유일은 모두 CPM 엔진이 계산합니다.</li>
        <li><b>AI는 해석을</b>: AI는 엔진 결과를 조회해 설명·요약·초안 작성을 돕습니다.</li>
        <li><b>원본은 안전하게</b>: What-if와 추천은 원본을 바꾸지 않고, 승인한 것만 수정 XER로 내려받습니다.</li></ul>` },
      { type: "quiz", q: "이 앱에서 준공일과 여유일(TF)을 계산하는 주체는?", options: ["AI", "CPM 엔진", "사용자가 직접 입력"], answer: 1,
        explain: "숫자는 항상 CPM 엔진이 계산합니다. AI는 그 결과를 조회해서 설명합니다." },
    ] },
    { id: "start-2", title: "홈 화면 둘러보기 (따라하기)", steps: [
      { type: "text", html: `<p>홈 화면에는 <b>오늘 확인할 것</b>, <b>포트폴리오 카드</b>, <b>업로드 목록</b>이 있습니다. 실제 화면에서 하나씩 짚어 보겠습니다.</p>` },
      { type: "tour", tab: "home", steps: [
        { sel: "#inbox", title: "오늘 확인할 것", body: "기한 지난 제약, 음수 여유, 준공 지연처럼 먼저 봐야 할 항목을 모아 줍니다. 누르면 해당 화면으로 바로 이동합니다." },
        { sel: ".cards", title: "포트폴리오 카드", body: "프로젝트별 예상 준공, 목표 대비 여유, 건전성 점수, SPI/CPI, 리스크 수를 한눈에 봅니다. ✓▲는 좋음, ✕▼는 나쁨입니다." },
        { sel: "#btnUpload", title: "파일 업로드", body: "P6 XER 또는 MS Project XML을 올립니다. 같은 프로젝트의 월간 업데이트를 계속 올리면 추세·지연 분석이 쌓입니다." },
        { sel: "#userBox", title: "학습·테마·단축키", body: "언제든 학습 센터로 돌아오고, 어두운 테마와 단축키(?)를 쓸 수 있습니다." },
      ] },
    ] },
    { id: "start-3", title: "프로젝트 화면 구조 (따라하기)", steps: [
      { type: "text", html: `<p>교육용 샘플 프로젝트를 열어 화면 구조를 익힙니다. 샘플은 3월·4월 두 번의 업데이트가 들어 있습니다.</p>` },
      { type: "tour", tab: "overview", steps: [
        { sel: "#upSel", title: "업데이트 전환", body: "같은 프로젝트의 다른 업데이트(Data Date)로 바로 이동합니다. 최신이 아니면 '! 최신 아님'이 표시됩니다." },
        { sel: ".groups", title: "4개 업무 그룹", body: "현황 · 품질·진단 · 리스크·대응 · 현장·보고. 그룹을 누르면 아래에 세부 화면이 나옵니다." },
        { sel: "#btnAi", title: "AI 어시스턴트", body: "어느 화면에서든 열 수 있습니다(Alt+A). 지금 보고 있는 화면을 함께 전달해 맥락에 맞게 답합니다." },
        { sel: "#btnHelp", title: "이 화면 사용법", body: "모르는 화면에서는 이 버튼을 누르면 설명과 따라하기가 열립니다." },
        { sel: "#tab", title: "ID를 누르면 상세", body: "모든 표에서 파란 Activity ID를 누르면 오른쪽에 상세(선후행·리스크·제약·변경 이력)가 열립니다. 표 오른쪽 위 '⭳ 엑셀'로 내보낼 수 있습니다." },
      ] },
    ] },
  ] },
  { id: "cpm", icon: "📐", title: "2. 공정표 읽기 (CPM 기초)", desc: "최장경로, 여유(TF/FF), 관계 유형을 직접 계산하며 이해", lessons: [
    { id: "cpm-1", title: "CPM과 여유일 개념", steps: [
      { type: "text", html: `<p><b>CPM(Critical Path Method)</b>은 작업과 선후행 관계로 가장 빠른 일정(<b>Forward pass</b>)과 가장 늦어도 되는 일정(<b>Backward pass</b>)을 계산합니다.</p>
        <ul><li><b>ES/EF</b>: 가장 빠른 시작·종료 &nbsp; <b>LS/LF</b>: 준공을 지키는 가장 늦은 시작·종료</li>
        <li><b>TF(총 여유)</b> = LF − EF. 0이면 늦어지는 만큼 준공이 늦어집니다(주공정).</li>
        <li><b>최장경로</b>: Data Date부터 준공까지 끊김 없이 이어지는 가장 긴 경로.</li></ul>` },
      { type: "sim" },
      { type: "quiz", q: "어떤 작업의 TF가 5일입니다. 이 작업이 3일 늦어지면 준공일은?", options: ["3일 늦어진다", "변하지 않는다", "5일 늦어진다"], answer: 1,
        explain: "여유 5일 안에서 늦어진 것이므로 준공에는 영향이 없습니다. 다만 여유가 2일로 줄어듭니다." },
    ] },
    { id: "cpm-2", title: "직접 계산해 보기 (CPM 실습)", steps: [
      { type: "text", html: `<p>아래 네트워크의 ES, EF, LS, LF, TF를 직접 계산해 보세요. 모든 관계는 FS(선행 종료 후 후행 시작), 시작일은 0일입니다. 틀린 칸은 빨간색으로 표시됩니다.</p>` },
      { type: "cpm" },
    ] },
    { id: "cpm-3", title: "공정표 화면 활용 (따라하기)", steps: [
      { type: "tour", tab: "gantt", steps: [
        { sel: "#q", title: "검색", body: "ID나 이름으로 찾습니다. 키보드 '/'를 누르면 바로 검색창으로 갑니다. '철골'을 입력해 보세요.", wait: "input" },
        { sel: "#fCrit", title: "주공정만 보기", body: "체크하면 주공정·최장경로 작업만 남습니다. 체크해 보세요.", wait: "change" },
        { sel: "#fLines", title: "최장경로 관계선", body: "최장경로 작업 사이의 관계선을 그립니다.", wait: "change" },
        { sel: ".gantt", title: "차트 조작", body: "드래그로 이동, Ctrl+휠로 확대합니다. 행을 클릭하면 관계선, 더블클릭하면 상세가 열립니다. ↑↓와 Enter로도 됩니다." },
        { sel: "#gBl", title: "베이스라인 비교", body: "P6 계획(Target) 또는 저장한 베이스라인(예: 최초 승인)을 주황 막대로 겹쳐 봅니다." },
        { sel: "#gSaveView", title: "보기 저장", body: "검색·필터·배율을 이름 붙여 저장하면 팀원도 같은 보기를 씁니다." },
      ] },
    ] },
  ] },
  { id: "quality", icon: "🩺", title: "3. 공정표 품질 점검", desc: "건전성 점수, DCMA 14, 관계 추천, 국내 기준", lessons: [
    { id: "q-1", title: "건전성 점수 읽기 (따라하기)", steps: [
      { type: "text", html: `<p>공정표가 엉성하면 계산 결과도 믿을 수 없습니다. 건전성 점수는 34개 지표(논리·관계·제약·여유·공기·진도·구조)를 가중 평균한 0~100점입니다.</p>
        <p>가장 흔한 문제는 <b>Open End(선후행 누락)</b>입니다. 후행이 없는 작업은 여유가 과대 계산되어 위험이 가려집니다.</p>` },
      { type: "tour", tab: "health", steps: [
        { sel: ".panel.score", title: "종합 점수와 등급", body: "A(90+) B(75+) C(60+) D. 업데이트마다 추세를 보며 관리합니다." },
        { sel: ".seg-tabs", title: "DCMA 14 보기", body: "미 국방부 기준 14개 항목과 항목별 조치 가이드는 옆 탭에 있습니다." },
        { sel: "#tab table.t", title: "미달 항목 펼치기", body: "행을 누르면 해당 작업 목록이 펼쳐지고, ID를 누르면 상세가 열립니다." },
      ] },
      { type: "quiz", q: "후행 관계가 없는 미완료 작업(Open End)이 많으면 생기는 문제는?", options: ["준공일이 무조건 늦어진다", "여유가 과대 계산되어 위험이 가려진다", "공정률이 올라간다"], answer: 1,
        explain: "후행이 없으면 그 작업은 프로젝트 종료까지 여유가 있는 것으로 계산되어, 실제 위험이 드러나지 않습니다." },
    ] },
    { id: "q-2", title: "관계 추천과 수정 XER", steps: [
      { type: "text", html: `<p><b>관계 추천</b> 화면은 Open End 작업에 연결할 선후행을 제안합니다. 선택 → <b>What-if 검증</b> → <b>수정 XER 다운로드</b> 순서로 진행하고, 내려받은 XER을 P6에서 Import합니다.</p>
        <p><b>국내 기준</b> 화면은 법정·대체공휴일이 캘린더에 빠졌는지 점검하고, 월별 기상 비작업일로 공기가 부족한 달을 찾습니다.</p>` },
      { type: "quiz", q: "추천된 관계를 원본에 반영하는 올바른 방법은?", options: ["앱이 자동으로 P6 원본을 수정한다", "검증 후 수정 XER을 내려받아 P6에 가져온다", "AI에게 반영하라고 말한다"], answer: 1,
        explain: "앱은 원본을 직접 바꾸지 않습니다. 승인한 변경만 담긴 수정 XER을 내려받아 P6에 Import합니다." },
    ] },
  ] },
  { id: "analysis", icon: "🔍", title: "4. 업데이트 분석", desc: "지연 원인, 변경 로그, 공기 압축 탐지, 베이스라인·EVM", lessons: [
    { id: "a-1", title: "준공이 왜 늦어졌나? (따라하기)", steps: [
      { type: "text", html: `<p>월간 업데이트를 올리면 직전 업데이트와 자동 비교합니다. <b>지연 원인</b>은 최장경로를 따라가며 각 작업이 <b>새로 만든 지연</b>(선행에서 넘겨받은 지연 제외)을 계산합니다.</p>` },
      { type: "tour", tab: "analysis", steps: [
        { sel: ".seg-tabs", title: "두 가지 분석", body: "'지연 원인'과 '변경 로그·압축·추세'를 오갑니다." },
        { sel: "#dBody, #tab .sub", title: "지연 기여 작업", body: "'새로 발생' 열이 큰 작업이 준공 지연의 원인입니다. 샘플에서는 A2000 철골 제작이 +33일입니다." },
      ] },
      { type: "quiz", q: "'공기 압축(Compression)'이 의심되는 경우는?", options: ["실적 진척 없이 잔여공기를 줄였는데 준공일이 그대로다", "작업이 예정보다 빨리 끝났다", "관계가 추가되었다"], answer: 0,
        explain: "진척 없이 남은 기간만 줄여 준공일을 맞추면, 공정표는 좋아 보여도 실제 위험은 커집니다." },
    ] },
    { id: "a-2", title: "EVM 지표 읽기", steps: [
      { type: "text", html: `<ul><li><b>PV</b>: 지금까지 했어야 할 일의 예산 &nbsp; <b>EV</b>: 실제로 한 일의 예산 &nbsp; <b>AC</b>: 실제 투입 비용</li>
        <li><b>SPI = EV/PV</b>: 1보다 작으면 일정 지연 &nbsp; <b>CPI = EV/AC</b>: 1보다 작으면 원가 초과</li></ul>` },
      { type: "quiz", q: "EV 8억, PV 10억, AC 9억일 때 올바른 해석은?", options: ["일정 빠름·원가 절감", "일정 지연·원가 초과", "일정 지연·원가 절감"], answer: 1,
        explain: "SPI=0.8(<1, 일정 지연), CPI≈0.89(<1, 원가 초과)입니다." },
    ] },
  ] },
  { id: "risk", icon: "🎲", title: "5. 리스크와 만회", desc: "리스크 레지스터, 몬테카를로, 자동 만회안, What-if", lessons: [
    { id: "r-1", title: "리스크 등록과 시뮬레이션 (따라하기)", steps: [
      { type: "text", html: `<p>리스크는 <b>아직 일어나지 않은 사건</b>입니다. 확률과 영향일을 정하고 영향받는 작업에 연결하면 몬테카를로 시뮬레이션에 반영됩니다.</p>
        <p><b>P80</b>은 80% 확률로 그 날짜 안에 준공한다는 뜻으로, 보수적인 목표로 많이 씁니다.</p>` },
      { type: "tour", tab: "risk", steps: [
        { sel: "#rkAdd", title: "리스크 추가", body: "제목, 확률, 영향일(최소/최빈/최대), 영향 작업 ID를 입력합니다. AI가 회의록에서 후보를 찾게 할 수도 있습니다." },
        { sel: "#simRun", title: "시뮬레이션 실행", body: "눌러 보세요. P50/P80/P90 준공일, 목표 달성 확률, 민감도(Tornado)가 나옵니다.", wait: "click" },
        { sel: "#simBody", title: "결과 읽기", body: "리스크 민감도의 막대가 긴 리스크부터 대응하세요." },
      ] },
    ] },
    { id: "r-2", title: "자동 만회안 (따라하기)", steps: [
      { type: "text", html: `<p><b>Crashing</b>은 인력·장비를 더 넣어 공기를 줄이고(비용↑), <b>Fast-tracking</b>은 순차 작업을 겹칩니다(위험↑). 자동 만회안은 최장경로에서 두 방법의 조합을 찾아 재계산으로 검증합니다.</p>` },
      { type: "tour", tab: "recovery", steps: [
        { sel: "#rvDays", title: "만회 목표", body: "당기고 싶은 일수를 입력합니다." },
        { sel: "#rvRun", title: "탐색", body: "눌러 보세요. 세 가지 전략이 비교됩니다.", wait: "click" },
        { sel: "#rvOut", title: "결과 활용", body: "마음에 드는 안을 'What-if로 열기'로 세부 조정하거나 시나리오로 저장해 팀과 공유합니다." },
      ] },
      { type: "quiz", q: "Fast-tracking의 대가는 주로 무엇인가요?", options: ["비용 증가", "재작업·간섭 위험 증가", "여유 증가"], answer: 1,
        explain: "작업을 겹치면 공기는 줄지만 간섭·재작업 위험이 커집니다." },
    ] },
  ] },
  { id: "field", icon: "🦺", title: "6. 현장 운영", desc: "3주 룩어헤드, PPC, 제약 관리, 작업일보, 현장 모드", lessons: [
    { id: "f-1", title: "룩어헤드와 PPC (따라하기)", steps: [
      { type: "text", html: `<p>매주 협력업체가 <b>이번 주에 하겠다고 약속</b>한 작업을 등록하고, 주말에 완료 여부를 체크합니다. <b>PPC</b>(약속 대비 완료율)가 80%를 넘으면 계획이 신뢰할 만하다는 뜻입니다.</p>
        <p>못 한 작업은 사유를 남기면 '미완료 사유' 순위로 반복 원인을 찾을 수 있습니다.</p>` },
      { type: "tour", tab: "lookahead", steps: [
        { sel: "table.la", title: "3주 룩어헤드", body: "CPM에서 향후 3주 작업을 자동 추출합니다. 빨간 칸은 주공정입니다." },
        { sel: "[data-commit]", title: "약속 등록", body: "협력업체와 약속한 작업을 등록합니다." },
        { sel: "[data-con]", title: "제약 등록", body: "도면·자재·인력 등 착수를 막는 제약을 기한과 함께 등록하면 홈 화면에서 기한 초과를 알려 줍니다." },
      ] },
    ] },
    { id: "f-2", title: "현장 모드(모바일)", steps: [
      { type: "text", html: `<p>프로젝트 화면의 <b>📱 현장 모드</b>는 휴대폰용 화면입니다.</p>
        <ul><li>큰 체크 버튼으로 이번 주 약속 완료 체크, 못 한 사유 선택</li><li>📷 사진 첨부(자동 축소)</li>
        <li>신호가 없으면 휴대폰에 임시 저장 후 연결되면 자동 전송</li><li>작업일보를 적으면 진도 입력안으로 정리</li></ul>` },
      { type: "quiz", q: "현장에서 통신이 끊긴 상태로 약속 완료를 체크하면?", options: ["저장되지 않는다", "휴대폰에 임시 저장되고 연결되면 자동 전송된다", "다른 사람 기록을 덮어쓴다"], answer: 1,
        explain: "오프라인 변경은 휴대폰에 쌓아 두었다가 온라인이 되면 순서대로 보냅니다." },
    ] },
  ] },
  { id: "ai", icon: "✦", title: "7. AI 활용과 보고", desc: "AI 어시스턴트 질문법, 월간 보고서, 초기 공정표 생성", lessons: [
    { id: "ai-1", title: "AI에게 잘 묻는 법", steps: [
      { type: "text", html: `<p>AI는 앱의 공정 데이터를 도구로 조회해서 답합니다(서버의 Claude CLI 사용, 데이터 변경 권한 없음). 좋은 질문은 <b>대상·기간·형식</b>이 분명합니다.</p>
        <table class="t" data-noexport><thead><tr><th>아쉬운 질문</th><th>좋은 질문</th></tr></thead><tbody>
        <tr><td>공정 어때?</td><td>다음 달 착수할 주공정 작업을 표로 보여줘</td></tr>
        <tr><td>지연 원인?</td><td>지난 업데이트 대비 준공이 늦어진 원인을 기여도 순으로 3개</td></tr>
        <tr><td>단축 방법</td><td>A3030을 10일 줄이면 준공이 며칠 당겨져?</td></tr></tbody></table>
        <p>답변의 숫자는 엔진 계산값이지만, 문장·해석은 반드시 사람이 검토하세요.</p>` },
      { type: "tour", tab: "overview", steps: [
        { sel: "#btnAi", title: "AI 패널 열기", body: "눌러서 열어 보세요. 예시 질문 버튼으로 바로 시작할 수 있습니다.", wait: "click" },
      ] },
      { type: "quiz", q: "AI 어시스턴트가 할 수 없는 일은?", options: ["What-if 가정 계산 결과 설명", "원본 공정표(XER)를 직접 수정", "주공정 작업 조회"], answer: 1,
        explain: "AI 도구는 읽기 전용입니다. 원본 변경은 사람이 승인한 수정 XER로만 합니다." },
    ] },
    { id: "ai-2", title: "월간 보고서와 초기 공정표", steps: [
      { type: "text", html: `<p><b>월간 보고서</b>: 지연 원인·주공정·향후 1개월·리스크를 모아 초안을 만들고, 화면에서 고친 뒤 Word로 내려받습니다.</p>
        <p><b>새 공정표 만들기</b>(홈): 표준 템플릿 또는 입찰·설계 문서로 초기 공정표를 생성합니다. AI가 쓴 가정 사항을 꼭 확인하세요.</p>` },
    ] },
  ] },
];
const ALL_LESSONS = COURSES.flatMap((c) => c.lessons.map((l) => ({ ...l, course: c })));
const HELP = {
  overview: ["start-3", "프로젝트 요약 KPI와 마일스톤을 봅니다."], gantt: ["cpm-3", "WBS별 간트차트. 드래그 이동, Ctrl+휠 확대, 보기 저장, 베이스라인 비교."],
  critical: ["cpm-1", "최장경로와 준주공정(여유 N일 이하) 목록."], scurve: ["a-2", "계획·Early·Late 누적 곡선과 실적."],
  evm: ["a-2", "베이스라인 지정·편차, EVM 지표와 비용 S-Curve."], resources: ["a-2", "자원별 주간 잔여 물량 히스토그램."],
  health: ["q-1", "34개 지표 건전성 점수와 DCMA 14 조치 가이드."], analysis: ["a-1", "직전 업데이트 대비 지연 원인, 변경 로그, 공기 압축, 추세."],
  p6: ["q-1", "XER에 저장된 P6 계산값과 엔진 계산값 비교."], korea: ["q-2", "법정공휴일 캘린더 점검, 기상 비작업일 적정 공기."],
  rels: ["q-2", "Open End 작업의 누락 관계 추천과 수정 XER."], risk: ["r-1", "리스크 레지스터, 몬테카를로, 지연 예측."],
  recovery: ["r-2", "자동 만회안(단축·병행) 탐색."], whatif: ["r-2", "가정 변경 후 재계산, 시나리오 저장, 수정 XER."],
  lookahead: ["f-1", "3주 룩어헤드, 약속·PPC, 제약 로그."], daily: ["f-2", "작업일보 문장에서 진도 입력안 추출."],
  report: ["ai-2", "월간 공정보고서 초안 작성·수정·Word 출력."], trades: ["q-2", "공종 분류와 명칭 표준화."], bench: ["a-2", "팀 전체 실적 기반 공종별 공기 벤치마크."],
  settings: ["q-1", "계산 옵션(Retained/Override)과 지표 기준값."],
};

// ---------------------------------------------------------------- 학습 센터 화면
async function showLearn(courseId, lessonId) {
  $("#crumb").textContent = "/ 학습 센터";
  await lpLoad();
  if (lessonId) return showLesson(lessonId);
  const total = ALL_LESSONS.length, done = LP.done.length;
  const isAdmin = (document.body.dataset.role || "admin") === "admin";
  view.innerHTML = `<div class="row" style="justify-content:space-between"><div><h2 style="margin:0">🎓 학습 센터</h2>
      <p class="muted" style="margin:4px 0 12px">개념 설명 → 실제 화면 따라하기 → 퀴즈 순서로 진행합니다. 진도는 ${me?.username ? "계정에" : "이 브라우저에"} 저장됩니다.</p></div>
      <div class="kpi" style="min-width:200px"><div class="l">내 진도</div><div class="v">${done} / ${total}</div><div class="bar"><i style="width:${(100 * done) / total}%"></i></div></div></div>
    <div class="learn-grid">${COURSES.map((c) => { const n = c.lessons.filter((l) => LP.done.includes(l.id)).length;
      return `<a class="course" href="#/learn/${c.id}/${(c.lessons.find((l) => !LP.done.includes(l.id)) || c.lessons[0]).id}"><div class="ico">${c.icon}</div><h3 style="margin:6px 0">${esc(c.title)}</h3>
        <div class="muted">${esc(c.desc)}</div><div class="muted" style="font-size:12px;margin-top:8px">${n}/${c.lessons.length} 완료 ${n === c.lessons.length ? "✓" : ""}</div><div class="pbar"><i style="width:${(100 * n) / c.lessons.length}%"></i></div></a>`; }).join("")}</div>
    <div class="grid2" style="margin-top:16px">
      <div class="panel"><h3 style="margin-top:0">📖 용어 사전</h3><input class="s" type="search" id="gq" placeholder="용어 검색" style="width:100%">
        <dl class="kv" id="glist" style="margin-top:8px"></dl></div>
      <div class="panel"><h3 style="margin-top:0">🧪 실습 도구</h3>
        <p><a href="#/learn/cpm/cpm-2" class="btn">CPM 계산 실습</a> <a href="#/learn/cpm/cpm-1" class="btn">여유일 시뮬레이터</a></p>
        <p><button class="btn" id="lSample">교육용 샘플 프로젝트 열기</button></p>
        <p class="muted" style="font-size:13px">교육용 샘플은 3월·4월 업데이트, 베이스라인, 리스크 1건이 들어 있어 모든 화면을 연습할 수 있습니다.</p>
        ${isAdmin ? `<p><button class="btn" id="lTeam">팀 학습 현황 보기</button></p>` : ""}</div></div>`;
  const drawG = (q) => { $("#glist").innerHTML = Object.entries(GLOSSARY).filter(([k, v]) => !q || (k + v).toLowerCase().includes(q.toLowerCase())).map(([k, v]) => `<dt><b>${esc(k)}</b></dt><dd>${esc(v)}</dd>`).join(""); };
  drawG(""); $("#gq").oninput = (e) => drawG(e.target.value);
  $("#lSample").onclick = async () => { const { id } = await api("/api/learn/sample", { method: "POST" }); uploadsCache = null; location.hash = `#/p/${id}/overview`; };
  $("#lTeam")?.addEventListener("click", async () => {
    const rows = await api("/api/admin/learn").catch(() => []);
    ui.notice("팀 학습 현황", rows.length ? `<table class="t" data-noexport><thead><tr><th>학습자</th><th class="num">완료 강의</th><th class="num">퀴즈 정답</th><th>최근</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.learner)}</td><td class="num">${r.lessons_done}/${total}</td><td class="num">${Object.values(r.quiz).filter(Boolean).length}/${Object.keys(r.quiz).length}</td><td>${r.updated_at.replace("T", " ")}</td></tr>`).join("")}</tbody></table>` : "아직 기록이 없습니다.");
  });
}

async function showLesson(lessonId) {
  const L = ALL_LESSONS.find((l) => l.id === lessonId); if (!L) { location.hash = "#/learn"; return; }
  const idx = ALL_LESSONS.indexOf(L), prev = ALL_LESSONS[idx - 1], next = ALL_LESSONS[idx + 1];
  const stepIdx = Math.min(+(sessionStorage.getItem("lstep:" + lessonId) || 0), L.steps.length - 1);
  const st = L.steps[stepIdx];
  view.innerHTML = `<div class="lesson"><div class="muted"><a href="#/learn">학습 센터</a> / ${esc(L.course.title)}</div>
    <h2>${esc(L.title)}</h2>
    <div class="row" aria-label="단계" style="gap:4px;margin-bottom:10px">${L.steps.map((s, i) => `<span class="chip ${i < stepIdx ? "ok" : i === stepIdx ? "warn" : ""}">${i + 1}. ${{ text: "설명", tour: "따라하기", quiz: "퀴즈", cpm: "실습", sim: "시뮬레이터" }[s.type]}</span>`).join("")}</div>
    <div class="step" id="lstep"></div>
    <div class="nav"><button class="btn" id="lPrev">← ${stepIdx ? "이전 단계" : prev ? "이전 강의" : "학습 센터"}</button>
      <button class="btn primary" id="lNext">${stepIdx < L.steps.length - 1 ? "다음 단계 →" : next ? "완료하고 다음 강의 →" : "과정 완료 🎉"}</button></div></div>`;
  const box = $("#lstep");
  const go = (i) => { sessionStorage.setItem("lstep:" + lessonId, String(i)); showLesson(lessonId); };
  if (st.type === "text") box.innerHTML = st.html;
  if (st.type === "quiz") renderQuiz(box, st, `${lessonId}:${stepIdx}`);
  if (st.type === "cpm") renderCpmExercise(box);
  if (st.type === "sim") renderFloatSim(box);
  if (st.type === "tour") {
    box.innerHTML = `<p>실제 화면에서 ${st.steps.length}단계로 따라 해 봅니다. ${st.tab === "home" ? "홈 화면" : "교육용 샘플 프로젝트"}로 이동한 뒤 안내 상자를 따라가세요. 끝나면 이 강의로 돌아옵니다.</p>
      <button class="btn primary" id="tourGo">▶ 따라하기 시작</button>`;
    $("#tourGo").onclick = () => startTour(st, { lessonId, stepIdx });
  }
  $("#lPrev").onclick = () => (stepIdx ? go(stepIdx - 1) : (location.hash = prev ? `#/learn/${prev.course.id}/${prev.id}` : "#/learn"));
  $("#lNext").onclick = async () => {
    if (stepIdx < L.steps.length - 1) return go(stepIdx + 1);
    await markDone(lessonId); sessionStorage.removeItem("lstep:" + lessonId);
    toast("강의를 완료했습니다 ✓");
    location.hash = next ? `#/learn/${next.course.id}/${next.id}` : "#/learn";
  };
}

function renderQuiz(box, q, key) {
  box.innerHTML = `<div class="quiz"><h3 style="margin-top:0">Q. ${esc(q.q)}</h3>${q.options.map((o, i) => `<button class="opt" data-i="${i}">${String.fromCharCode(65 + i)}. ${esc(o)}</button>`).join("")}<div id="qExp" aria-live="polite"></div></div>`;
  box.querySelectorAll(".opt").forEach((b) => (b.onclick = async () => {
    const ok = +b.dataset.i === q.answer;
    box.querySelectorAll(".opt").forEach((x) => { x.disabled = true; if (+x.dataset.i === q.answer) x.classList.add("right"); });
    if (!ok) b.classList.add("wrong");
    $("#qExp").innerHTML = `<p><b>${ok ? "정답입니다 ✓" : "아쉽습니다 ✕"}</b> ${esc(q.explain)}</p><button class="btn sm" id="qRetry">다시 풀기</button>`;
    $("#qRetry").onclick = () => renderQuiz(box, q, key);
    await lpLoad(); LP.quiz[key] = LP.quiz[key] || ok; lpSave();
  }));
}

// ---------------------------------------------------------------- 미니 CPM (교육용, FS 관계만)
function miniCpm(acts) {
  const by = Object.fromEntries(acts.map((a) => [a.id, { ...a }]));
  const order = []; const seen = new Set();
  const visit = (id) => { if (seen.has(id)) return; seen.add(id); by[id].preds.forEach(visit); order.push(id); };
  acts.forEach((a) => visit(a.id));
  for (const id of order) { const a = by[id]; a.es = Math.max(0, ...a.preds.map((p) => by[p].ef)); a.ef = a.es + a.dur; }
  const end = Math.max(...order.map((id) => by[id].ef));
  for (const id of [...order].reverse()) {
    const a = by[id]; const succ = acts.filter((x) => x.preds.includes(id));
    a.lf = succ.length ? Math.min(...succ.map((x) => by[x.id].ls)) : end; a.ls = a.lf - a.dur; a.tf = a.ls - a.es;
  }
  return { by, end };
}

function renderCpmExercise(box) {
  const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const acts = [{ id: "A", name: "터파기", dur: rnd(3, 6), preds: [] }, { id: "B", name: "기초", dur: rnd(4, 8), preds: ["A"] },
    { id: "C", name: "배관 매설", dur: rnd(2, 5), preds: ["A"] }, { id: "D", name: "골조", dur: rnd(6, 10), preds: ["B"] },
    { id: "E", name: "되메우기", dur: rnd(2, 4), preds: ["B", "C"] }, { id: "F", name: "준공", dur: rnd(1, 3), preds: ["D", "E"] }];
  const { by, end } = miniCpm(acts);
  const pos = { A: [20, 70], B: [170, 20], C: [170, 130], D: [330, 20], E: [330, 130], F: [480, 70] };
  const edges = acts.flatMap((a) => a.preds.map((p) => [p, a.id]));
  box.innerHTML = `<div class="cpm-ex"><svg viewBox="0 0 600 190" width="100%" role="img" aria-label="CPM 네트워크">
      ${edges.map(([p, s]) => `<line x1="${pos[p][0] + 100}" y1="${pos[p][1] + 22}" x2="${pos[s][0]}" y2="${pos[s][1] + 22}" stroke="#94a3b8" marker-end="url(#ah)"/>`).join("")}
      <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#94a3b8"/></marker></defs>
      ${acts.map((a) => `<rect x="${pos[a.id][0]}" y="${pos[a.id][1]}" width="100" height="44" rx="8" fill="none" stroke="#3b82f6"/><text x="${pos[a.id][0] + 8}" y="${pos[a.id][1] + 18}">${a.id} ${a.name}</text><text x="${pos[a.id][0] + 8}" y="${pos[a.id][1] + 36}">공기 ${a.dur}일</text>`).join("")}
    </svg>
    <table class="t" data-noexport><thead><tr><th>작업</th><th>공기</th><th>선행</th><th>ES</th><th>EF</th><th>LS</th><th>LF</th><th>TF</th></tr></thead><tbody>
      ${acts.map((a) => `<tr><td><b>${a.id}</b> ${a.name}</td><td>${a.dur}</td><td>${a.preds.join(", ") || "-"}</td>${["es", "ef", "ls", "lf", "tf"].map((k) => `<td><input inputmode="numeric" data-a="${a.id}" data-k="${k}" aria-label="${a.id} ${k.toUpperCase()}"></td>`).join("")}</tr>`).join("")}
    </tbody></table>
    <div class="row" style="margin-top:10px"><button class="btn primary" id="cCheck">채점</button><button class="btn" id="cHint">힌트</button><button class="btn" id="cShow">정답 보기</button><button class="btn" id="cNew">새 문제</button></div>
    <div id="cMsg" aria-live="polite" style="margin-top:8px"></div></div>`;
  $("#cCheck").onclick = () => {
    let ok = 0, n = 0;
    box.querySelectorAll("input[data-a]").forEach((i) => { n++; const v = by[i.dataset.a][i.dataset.k]; const good = i.value !== "" && +i.value === v; ok += good; i.classList.toggle("right", good); i.classList.toggle("wrong", !good); });
    const crit = acts.filter((a) => by[a.id].tf === 0).map((a) => a.id).join(" → ");
    $("#cMsg").innerHTML = ok === n ? `<b>🎉 모두 정답!</b> 준공은 ${end}일, 주공정은 <b>${crit}</b> 입니다. 여유가 있는 작업은 늦어져도 그만큼 준공에 영향이 없습니다.`
      : `<b>${ok}/${n}</b>칸 정답. 빨간 칸을 다시 확인하세요. (ES = 선행 EF 중 최댓값, LF = 후행 LS 중 최솟값)`;
    if (ok === n) { lpLoad().then(() => { LP.quiz["cpm-exercise"] = true; lpSave(); }); }
  };
  $("#cHint").onclick = () => ($("#cMsg").innerHTML = `① 앞에서부터: ES = 선행 작업 EF의 최댓값(첫 작업은 0), EF = ES + 공기<br>② 뒤에서부터: 마지막 작업 LF = 전체 최대 EF, LS = LF − 공기, 선행의 LF = 후행 LS의 최솟값<br>③ TF = LS − ES`);
  $("#cShow").onclick = () => { box.querySelectorAll("input[data-a]").forEach((i) => { i.value = by[i.dataset.a][i.dataset.k]; }); $("#cCheck").click(); };
  $("#cNew").onclick = () => renderCpmExercise(box);
}

function renderFloatSim(box) {
  const acts = [{ id: "A", name: "터파기", dur: 5, preds: [] }, { id: "B", name: "기초", dur: 8, preds: ["A"] }, { id: "C", name: "배관 매설", dur: 4, preds: ["A"] },
    { id: "D", name: "골조", dur: 10, preds: ["B"] }, { id: "E", name: "외부 포장", dur: 6, preds: ["C"] }, { id: "F", name: "준공", dur: 2, preds: ["D", "E"] }];
  const draw = () => {
    const { by, end } = miniCpm(acts);
    const W = 440, sc = W / Math.max(end, 1);
    box.querySelector("#simChart").innerHTML = `<svg viewBox="0 0 ${W + 120} ${acts.length * 30 + 30}" width="100%" role="img" aria-label="간트 시뮬레이션">
      ${acts.map((a, i) => { const b = by[a.id]; const y = i * 30 + 6; const crit = b.tf === 0;
        return `<text x="0" y="${y + 14}">${a.id} ${a.name}</text>
          <rect x="${110 + b.es * sc}" y="${y}" width="${Math.max(2, a.dur * sc)}" height="18" rx="3" fill="${crit ? "#dc2626" : "#3b82f6"}"/>
          ${b.tf > 0 ? `<line x1="${110 + b.ef * sc}" y1="${y + 9}" x2="${110 + b.lf * sc}" y2="${y + 9}" stroke="#9ca3af" stroke-dasharray="3 2"/><text x="${110 + b.lf * sc + 4}" y="${y + 14}" style="font-size:11px">여유 ${b.tf}</text>` : `<text x="${110 + b.ef * sc + 4}" y="${y + 14}" style="font-size:11px">▲ 주공정</text>`}`; }).join("")}
      <line x1="${110 + end * sc}" y1="0" x2="${110 + end * sc}" y2="${acts.length * 30 + 6}" stroke="#16a34a" stroke-dasharray="4 3"/>
      <text x="${110 + end * sc - 30}" y="${acts.length * 30 + 24}" style="font-size:12px">준공 ${end}일</text></svg>`;
    box.querySelector("#simMsg").textContent = `준공 ${end}일 · 주공정: ${acts.filter((a) => by[a.id].tf === 0).map((a) => a.id).join(" → ")}`;
  };
  box.innerHTML = `<h3 style="margin-top:0">여유일 시뮬레이터</h3><p class="muted">슬라이더로 공기를 바꿔 보세요. 여유(회색 점선)가 있는 작업은 늘려도 준공이 그대로지만, 여유를 다 쓰면 주공정(빨강)이 바뀝니다.
      <b>도전:</b> C(배관 매설)를 몇 일까지 늘려야 주공정이 바뀌나요?</p>
    <div class="sim-box"><div>${acts.map((a, i) => `<label>${a.id} ${a.name} <b id="sv${i}">${a.dur}</b>일<input type="range" min="1" max="20" value="${a.dur}" data-i="${i}" aria-label="${a.id} 공기"></label>`).join("")}</div>
      <div><div id="simChart"></div><p id="simMsg" aria-live="polite"></p></div></div>`;
  box.querySelectorAll("input[type=range]").forEach((r) => (r.oninput = () => { acts[+r.dataset.i].dur = +r.value; $("#sv" + r.dataset.i).textContent = r.value; draw(); }));
  draw();
}

// ---------------------------------------------------------------- 실제 화면 따라하기(투어) 엔진
async function startTour(tour, back) {
  sessionStorage.setItem("tour", JSON.stringify({ tour, back, i: 0 }));
  if (tour.tab === "home") { location.hash = "#/"; if (location.hash === "#/") setTimeout(runTour, 400); return; }
  const { id } = await api("/api/learn/sample", { method: "POST" });
  uploadsCache = null;
  const target = `#/p/${id}/${tour.tab}`;
  if (location.hash === target) setTimeout(runTour, 400); else location.hash = target;
}
function maybeStartTour() { if (sessionStorage.getItem("tour")) setTimeout(runTour, 500); else maybeOnboard(); }
window.addEventListener("hashchange", () => { if (sessionStorage.getItem("tour") && (location.hash === "#/" || location.hash === "")) setTimeout(runTour, 700); });

function endTour(completed) {
  const s = JSON.parse(sessionStorage.getItem("tour") || "null");
  sessionStorage.removeItem("tour");
  document.querySelectorAll(".tour-hole,.tour-pop").forEach((x) => x.remove());
  if (s?.back) {
    if (completed) sessionStorage.setItem("lstep:" + s.back.lessonId, String(s.back.stepIdx + 1));
    const L = ALL_LESSONS.find((l) => l.id === s.back.lessonId);
    if (completed) toast("따라하기를 마쳤습니다 ✓ 강의로 돌아갑니다");
    if (L) location.hash = `#/learn/${L.course.id}/${L.id}`;
  }
}

function runTour() {
  const s = JSON.parse(sessionStorage.getItem("tour") || "null"); if (!s) return;
  const step = s.tour.steps[s.i];
  if (!step) return endTour(true);
  const el = step.sel.split(",").map((x) => document.querySelector(x.trim())).find(Boolean);
  document.querySelectorAll(".tour-hole,.tour-pop").forEach((x) => x.remove());
  const hole = document.createElement("div"); hole.className = "tour-hole";
  const pop = document.createElement("div"); pop.className = "tour-pop"; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-live", "polite");
  document.body.append(hole, pop);
  if (el) el.scrollIntoView({ block: "center", behavior: "instant" });
  const place = () => {
    const r = el ? el.getBoundingClientRect() : { left: innerWidth / 2 - 100, top: innerHeight / 3, width: 200, height: 40, bottom: innerHeight / 3 + 40 };
    Object.assign(hole.style, { left: r.left - 6 + "px", top: r.top - 6 + "px", width: r.width + 12 + "px", height: Math.min(r.height, innerHeight * 0.6) + 12 + "px" });
    const below = r.top + Math.min(r.height, innerHeight * 0.6) + 200 < innerHeight;
    pop.style.left = Math.max(8, Math.min(innerWidth - 380, r.left)) + "px";
    pop.style.top = (below ? r.top + Math.min(r.height, innerHeight * 0.6) + 14 : Math.max(8, r.top - 190)) + "px";
  };
  pop.innerHTML = `<div class="muted" style="font-size:12px">따라하기 ${s.i + 1} / ${s.tour.steps.length}</div><h4>${esc(step.title)}</h4><div>${esc(step.body)}</div>
    ${!el ? `<div class="task">이 화면에서 해당 요소를 찾지 못했습니다. 다음으로 넘어가세요.</div>` : step.wait ? `<div class="task">👉 직접 해 보면 자동으로 다음 단계로 넘어갑니다.</div>` : ""}
    <div class="row"><button class="btn sm" id="tSkip">그만하기</button><span><button class="btn sm" id="tPrev" ${s.i ? "" : "disabled"}>이전</button>
      <button class="btn sm primary" id="tNext">${s.i === s.tour.steps.length - 1 ? "완료" : "다음"}</button></span></div>`;
  place();
  const adv = (d) => { s.i += d; sessionStorage.setItem("tour", JSON.stringify(s)); runTour(); };
  pop.querySelector("#tSkip").onclick = () => endTour(false);
  pop.querySelector("#tPrev").onclick = () => adv(-1);
  pop.querySelector("#tNext").onclick = () => adv(1);
  pop.querySelector("#tNext").focus();
  if (el && step.wait) {
    const ev = step.wait === "input" ? "input" : step.wait === "change" ? "change" : "click";
    const h = () => { el.removeEventListener(ev, h); setTimeout(() => adv(1), ev === "click" ? 900 : 400); };
    el.addEventListener(ev, h);
  }
  const onResize = () => { if (!document.body.contains(pop)) return window.removeEventListener("resize", onResize); place(); };
  window.addEventListener("resize", onResize);
}

// ---------------------------------------------------------------- 화면별 도움말 + 첫 방문 안내
function openHelpFor(tab) {
  const [lessonId, desc] = HELP[tab] || ["start-3", "프로젝트 화면입니다."];
  const L = ALL_LESSONS.find((l) => l.id === lessonId);
  const tour = L?.steps.find((s) => s.type === "tour" && s.tab === tab);
  const d = openDrawer(`? ${esc(TAB_LABEL[tab] || "설정")} 사용법`, `<p>${esc(desc)}</p>
    ${tour ? `<button class="btn primary" id="hTour">▶ 이 화면 따라하기 (${tour.steps.length}단계)</button>` : ""}
    <p><a class="btn" href="#/learn/${L.course.id}/${L.id}">📘 관련 강의: ${esc(L.title)}</a></p>
    <h4>이 화면의 용어</h4><div id="hTerms" class="muted">-</div>
    <p class="muted" style="font-size:12px">단축키는 <kbd>?</kbd>, AI 질문은 <kbd>Alt</kbd>+<kbd>A</kbd>.</p>`);
  const words = new Set([...document.querySelectorAll("#tab .term")].map((t) => t.dataset.term));
  $("#hTerms").innerHTML = [...words].map((w) => `<div class="mini"><b>${esc(w)}</b> ${esc(GLOSSARY[w])}</div>`).join("") || "표 머리글의 ? 표시에 마우스를 올리면 설명이 나옵니다.";
  if (tour) d.querySelector("#hTour").onclick = () => {
    closeDrawer();
    sessionStorage.setItem("tour", JSON.stringify({ tour, back: null, i: 0 })); runTour();
  };
}

function maybeOnboard() {
  if (store.get("onboarded") || !ctx.uid) return;
  store.set("onboarded", "1");
  const t = document.createElement("div"); t.className = "tour-pop"; t.style.right = "16px"; t.style.bottom = "16px"; t.style.left = "auto"; t.style.top = "auto";
  t.innerHTML = `<h4>처음이신가요? 👋</h4><div>2분 둘러보기로 화면 구조를 익히거나, 학습 센터에서 단계별로 배울 수 있습니다.</div>
    <div class="row"><button class="btn sm" id="obNo">나중에</button><span><a class="btn sm" href="#/learn">학습 센터</a> <button class="btn sm primary" id="obGo">둘러보기</button></span></div>`;
  document.body.appendChild(t);
  t.querySelector("#obNo").onclick = () => t.remove();
  t.querySelector("[href]").onclick = () => t.remove();
  t.querySelector("#obGo").onclick = () => {
    t.remove();
    const tour = ALL_LESSONS.find((l) => l.id === "start-3").steps.find((s) => s.type === "tour");
    sessionStorage.setItem("tour", JSON.stringify({ tour, back: null, i: 0 })); runTour();
  };
}
