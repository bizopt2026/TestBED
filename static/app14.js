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

// ================================================================ 사용자 매뉴얼 (프로그램 안에서 보기·인쇄)
function mdDoc(src) {   // 매뉴얼용 Markdown: 제목·표·목록·인용·코드·구분선·굵게·코드·링크
  const inl = (t) => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, txt, href) => /^https?:/.test(href) ? `<a href="${href}" target="_blank" rel="noopener">${txt}</a>`
      : `<a href="#/manual/${({ "배포-운영-가이드.md": "ops", "사용자-매뉴얼.md": "manual", "../CHANGELOG.md": "changelog" })[href] || "manual"}">${txt}</a>`);
  const L = src.replace(/\r/g, "").split("\n"), out = [], toc = [];
  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    if (/^```/.test(l)) { const buf = []; while (++i < L.length && !/^```/.test(L[i])) buf.push(L[i]); out.push(`<pre class="md-pre">${esc(buf.join("\n"))}</pre>`); continue; }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { const id = "m" + out.length; if (h[1].length === 2) toc.push([id, h[2]]); out.push(`<h${h[1].length + 1} id="${id}">${inl(h[2])}</h${h[1].length + 1}>`); continue; }
    if (/^---+\s*$/.test(l)) continue;   // 장 구분은 제목 위 선으로 대신
    if (/^\|/.test(l) && /^\|[\s:|-]+\|\s*$/.test(L[i + 1] || "")) {
      const row = (x) => x.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = row(l); i++; const body = [];
      while (i + 1 < L.length && /^\|/.test(L[i + 1])) body.push(row(L[++i]));
      out.push(`<div class="scroll"><table class="t md-t" data-noexport data-tt="1"><thead><tr>${head.map((c) => `<th>${inl(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inl(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l), items = [];
      while (i < L.length && /^\s*([-*]|\d+\.)\s+/.test(L[i])) { items.push(`<li${/^\s{2,}/.test(L[i]) ? ' class="md-sub"' : ""}>${inl(L[i].replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>`); i++; }
      i--; out.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`); continue;
    }
    if (/^>\s?/.test(l)) { out.push(`<div class="md-note">${inl(l.replace(/^>\s?/, ""))}</div>`); continue; }
    if (l.trim()) out.push(`<p>${inl(l)}</p>`);
  }
  return { html: out.join("\n"), toc };
}
async function showManual(key = "manual") {
  $("#crumb").textContent = "/ 사용자 매뉴얼";
  ctx.uid = null;
  const DOCS = [["manual", "사용자 매뉴얼"], ["ops", "배포·운영 가이드"], ["changelog", "변경 기록"]];
  if (!DOCS.some(([k]) => k === key)) key = "manual";
  view.innerHTML = skeleton?.("page") || "";
  const src = await fetch(`/api/docs/${key}`).then((r) => (r.ok ? r.text() : Promise.reject(Object.assign(new Error("문서를 불러오지 못했습니다"), { status: r.status }))));
  const { html, toc } = mdDoc(src);
  view.innerHTML = `<div class="page-head"><div><h2>${DOCS.find(([k]) => k === key)[1]}</h2><p>버전 ${esc(window.PMS?.version || "")} · 인쇄하거나 PDF로 저장해 나눠 볼 수 있습니다.</p></div>
      <div class="row"><div class="seg-tabs sm" role="group" aria-label="문서">${DOCS.map(([k, l]) => `<a class="${k === key ? "on" : ""}" href="#/manual/${k}" ${k === key ? 'aria-current="page"' : ""}>${l}</a>`).join("")}</div>
      <button class="btn" onclick="print()">인쇄·PDF</button></div></div>
    <div class="md-wrap">${toc.length > 2 ? `<nav class="md-toc panel" aria-label="목차"><b>목차</b>${toc.map(([id, t]) => `<a href="#/manual/${key}" data-to="${id}">${esc(t.replace(/\*\*/g, ""))}</a>`).join("")}</nav>` : ""}
      <article class="panel md-doc">${html}</article></div>`;
  view.querySelectorAll("[data-to]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); document.getElementById(a.dataset.to)?.scrollIntoView({ behavior: "smooth", block: "start" }); }));
  routeTitle();
}
ROUTE_TITLE.manual = "사용자 매뉴얼";
// 학습 센터·도움말에서 매뉴얼로
const _showLearn28 = showLearn;
showLearn = async function (...a) {
  const r = await _showLearn28(...a);
  const p = view.querySelector("h2")?.parentElement?.querySelector("p");   // 학습 센터 소개 문장 아래
  if (p && !$("#lnManual")) p.insertAdjacentHTML("afterend", `<a class="btn sm" id="lnManual" href="#/manual" style="margin-bottom:12px">${icon("book", 15)} 사용자 매뉴얼 · 배포 가이드 · 변경 기록</a>`);
  return r;
};
