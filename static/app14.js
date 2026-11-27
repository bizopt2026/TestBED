"use strict";
// ================================================================ 클로즈드 테스트(휴대폰·접근성) 수정
// 메뉴 초점 처리 · 도움말 버튼을 머리글로 · 첫 안내 초점 · 화면 제목 · 이름 없는 입력칸 · 로그인 화면 위 안내 억제

// ---- 펼침 메뉴: 초점이 메뉴 밖으로 나가면 닫기, 닫힌 ▾에서 ↓로 열기
const _popMenu28 = popMenu;
popMenu = function (btn, menu) {
  _popMenu28(btn, menu);
  const wrap = btn.parentElement;
  wrap.addEventListener("focusout", (e) => { if (!menu.hidden && !wrap.contains(e.relatedTarget)) { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); } });
  btn.addEventListener("keydown", (e) => { if (e.key === "ArrowDown" && menu.hidden) { e.preventDefault(); btn.click(); } });
};

// ---- 떠 있는 '? 도움말' 버튼이 내용을 가리지 않게 머리글로 옮김
helpFab = function () {
  if ($("#helpFab")) return;
  const b = document.createElement("button");
  b.id = "helpFab"; b.className = "tb-btn help-top"; b.innerHTML = `<span aria-hidden="true">?</span><span class="hide-sm">도움말</span>`;
  b.title = "이 화면 사용법 (단축키 ?는 단축키 목록)"; b.setAttribute("aria-label", "이 화면 도움말");
  b.onclick = () => (ctx.uid && ctx.tab && location.hash.startsWith("#/p/") ? openHelpFor(ctx.tab) : (location.hash = "#/learn"));
  const top = document.querySelector(".top"); const anchor = top?.querySelector(".split-btn, #btnUpload");
  if (anchor) anchor.before(b); else top?.append(b);
};

// ---- '처음이신가요?' 안내: 초점을 주고 Esc로 닫기, 휴대폰 아래 메뉴를 가리지 않게
const _maybeOnboard28 = maybeOnboard;
maybeOnboard = function () {
  _maybeOnboard28();
  const t = document.querySelector(".tour-pop:not(.tour-step)");
  if (t && $("#obGo")) {
    t.setAttribute("role", "dialog"); t.setAttribute("aria-labelledby", "obTitle");
    t.querySelector("h3")?.setAttribute("id", "obTitle");
    t.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#obNo")?.click(); });
    $("#obGo").focus();
  }
};

// ---- 새로 바뀐 점: 로그인 화면 위에는 띄우지 않음(로그인 뒤에 보임), 닫으면 초점 되돌림
const _maybeWhatsNew28 = maybeWhatsNew;
maybeWhatsNew = async function (force = false) {
  if (!force && document.body.classList.contains("login-screen")) return;
  const back = document.activeElement;
  await _maybeWhatsNew28(force);
  const d = document.querySelector("dialog[open] .wn")?.closest("dialog");
  d?.addEventListener("close", () => { (back?.isConnected && back !== document.body ? back : $("#view"))?.focus?.(); }, { once: true });
};

// ---- 화면마다 문서 제목, 화면을 옮기면 본문으로 초점(화면 읽기 프로그램이 새 화면을 읽도록)
const ROUTE_TITLE = { "": "홈", issues: "이슈", admin: "관리", me: "내 설정", learn: "학습 센터", projects: "프로젝트 권한", reports: "보고서 센터", wizard: "월간 점검", field: "현장 모드", print: "인쇄", cmp: "업데이트 비교", design: "디자인" };
function routeTitle() {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  let t = ROUTE_TITLE[parts[0]] ?? "";
  if (parts[0] === "p") t = `${(ctx.result?.name || "")} · ${TAB_LABEL[parts[2]] || (parts[2] === "settings" ? "설정" : parts[2] === "timeline" ? "타임라인" : "")}`;
  else if (["wizard", "field", "print", "reports"].includes(parts[0]) && ctx.result?.name) t = `${ctx.result.name} · ${t}`;
  if (parts[0] === "" && isDashboard()) t = "대시보드";
  document.title = `${t ? t + " — " : ""}${window.PMS?.edition_name || "PMS"}`;
}
let _lastHash28 = location.hash;
window.addEventListener("hashchange", () => {
  const prev = _lastHash28.split("/").slice(0, 3).join("/"), cur = location.hash.split("/").slice(0, 3).join("/");
  _lastHash28 = location.hash;
  setTimeout(() => {
    routeTitle();
    if (prev !== cur && !document.querySelector("dialog[open], .drawer.open") && !document.activeElement?.closest?.(".side, #mnav, #gnav, #tnav")) $("#view")?.focus({ preventScroll: true });
  }, 400);
});
document.addEventListener("DOMContentLoaded", () => pmsReady.then(() => setTimeout(routeTitle, 600)));

// ---- 이름 없는 입력칸에 이름 붙이기 (EVM·분석·What-if·관계 추천)
const A11Y_NAMES = { "#blSel": "비교할 베이스라인", "#blSrc": "베이스라인 원본", "#dBase": "비교 기준 업데이트", 'select[data-k="op"]': "변경 방법", ".rc": "이 추천 선택" };
new MutationObserver(() => {
  for (const [sel, name] of Object.entries(A11Y_NAMES)) {
    document.querySelectorAll(sel).forEach((el) => { if (!el.getAttribute("aria-label") && !el.labels?.length) el.setAttribute("aria-label", name); });
  }
  const gl = document.getElementById("gl"); if (gl && !gl.hasAttribute("tabindex")) { gl.tabIndex = 0; gl.setAttribute("role", "region"); gl.setAttribute("aria-label", "작업 표"); }
}).observe(document.documentElement, { childList: true, subtree: true });

// ---- 참조 프로젝트(받아 온 남의 프로젝트): 고치기·게시 단추를 숨김 (서버도 막지만, 눌러 보고 403 받는 일이 없게)
const _showProject28 = showProject;
showProject = async function (uid, tab, ...rest) {
  const r = await _showProject28(uid, tab, ...rest);
  const perm = uid ? await api(`/api/uploads/${uid}/perm`).catch(() => ({})) : {};
  document.body.classList.toggle("ro-ref", !!perm.ref);
  return r;
};
window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/p/")) document.body.classList.remove("ro-ref"); });

// ---- 조회 전용 계정: 편집 권한 요청 대신 안내, Ctrl+K 에서 편집 명령 빼기
const _requestAccess28 = requestAccess;
requestAccess = function (name) {
  if (me?.role === "viewer") return ui.notice("조회 전용 계정", "<p>조회 전용 계정은 프로젝트 멤버가 될 수 없습니다. 편집이 필요하면 관리자에게 <b>편집자</b> 권한을 요청하세요.</p>");
  return _requestAccess28(name);
};
const EDIT_CMDS = ["리스크 추가", "제약 일괄 입력", "업데이트 올리기", "새 공정표 만들기", "끌어서 What-if", "월간 점검 시작"];
const _paletteCommands28 = paletteCommands;
paletteCommands = function () {
  const cmds = _paletteCommands28();
  return me?.role === "viewer" ? cmds.filter((c) => !EDIT_CMDS.some((w) => c.label.includes(w))) : cmds;
};

WHATSNEW["2.8"] = [
  { ic: "shield", t: "베타 준비: 클로즈드 테스트 반영", d: "보안(다른 프로젝트 기록 보호·압축 폭탄·비밀번호 규칙), 현장↔대시보드 협업(재연결 시 편집 소유권 유지·공유 코드 취소·휴지통 되돌림 동기화), 현장 모드 오프라인, 접근성 결함을 고쳤습니다." },
  { ic: "gantt", t: "휴대폰 공정표", d: "휴대폰·태블릿에서도 작업명과 막대가 함께 보입니다. Enter로 상세가 열립니다." },
  { ic: "book", t: "도움말은 머리글로", d: "떠 있던 '? 도움말' 버튼이 내용을 가리지 않도록 머리글로 옮겼습니다 (휴대폰은 작업 ▾ → 이 화면 사용법)." },
];
