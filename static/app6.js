"use strict";
// ================================================================ 8차 화면: 새로 바뀐 점, Ctrl+K 명령, 역할별 홈·포트폴리오 마일스톤, 내 설정,
// 업데이트 비교 화면, 차트 클릭, 바탕화면 알림, 회사 로고, 접근성 보완, 미리 받기

// ---------------------------------------------------------------- ① 업데이트 후 '새로 바뀐 점'
const WHATSNEW = {
  "1.9": [
    { ic: "palette", t: "차분한 새 색 테마", d: "화려한 보라색 그라데이션을 없애고 먹색 메인 + 청록 포인트(그래파이트)로 바꿨습니다. 네이비+앰버, 인디고 중에서 고를 수도 있습니다.", go: "#/me" },
    { ic: "eye", t: "메인 색과 포인트 색 분리", d: "주요 버튼·로고는 메인 색, 선택 표시·진행률·탭 밑줄·링크는 포인트 색으로 통일했습니다. 상태색(정상·주의·위험)도 채도를 낮췄습니다." },
  ],
  "1.8": [
    { ic: "search", t: "Ctrl+K로 명령 실행", d: "검색창에 '리스크 추가', '보고 패키지', 'A2000 공정표'처럼 입력하면 바로 실행합니다.", go: "#/" },
    { ic: "gantt", t: "공정표에서 끌어서 What-if", d: "공정표의 '끌어서 What-if'를 켜고 막대를 끌면 원본은 그대로 두고 준공 영향을 계산합니다. 묶기(공종·주공정·상태)와 열 순서도 저장됩니다." },
    { ic: "alert", t: "공정표 안 품질 표시", d: "선후행 누락·제약·음수 여유·리스크·코멘트가 있는 작업 옆에 작은 표시가 붙습니다." },
    { ic: "home", t: "역할별 홈", d: "홈 오른쪽 위 '홈 구성'에서 현장·공무·본사 PM 구성을 고르고, 포트폴리오 마일스톤 공정표를 볼 수 있습니다.", go: "#/" },
    { ic: "gear", t: "내 설정 한곳에", d: "계정·화면·지표·알림(바탕화면 알림 포함) 설정을 '내 설정'에서 한 번에 바꿉니다.", go: "#/me" },
    { ic: "phone", t: "현장 모드 새 디자인", d: "큰 버튼, 오늘 할 일 순서, 사진 찍고 작업 고르기, 오프라인·보내지 않은 기록 표시." },
  ],
};
function verKey(v) { return String(v || "").split(" ")[0].split(".").slice(0, 2).join("."); }
async function maybeWhatsNew(force = false) {
  const cfg = await fetch("/api/config").then((r) => r.json()).catch(() => ({}));
  const k = verKey(cfg.version), items = WHATSNEW[k];
  const seen = store.get("seenVersion");
  const num = (v) => String(v || "0").split(".").map((x) => +x || 0);
  const newer = (a, b) => { const [x1, y1] = num(a), [x2, y2] = num(b); return x1 > x2 || (x1 === x2 && y1 > y2); };
  if (!force) {
    if (seen === k || (seen && !newer(k, seen))) return;   // 같은 버전이거나 되돌린 경우에는 보이지 않음
    store.set("seenVersion", k);
    if (!seen && !store.get("onboarded")) return;   // 처음 쓰는 사람에게는 '처음이신가요?' 안내가 먼저
    if (!items) return;
  }
  if (!items) return toast("이번 버전의 안내가 없습니다");
  const d = _modal(`<form method="dialog" class="wn"><h3>${icon("sparkles", 20)} 새로 바뀐 점 <span class="muted" style="font-size:14px">버전 ${esc(cfg.version || k)}</span></h3>
    <ul class="wn-list">${items.map((x, i) => `<li><span class="wn-ico">${icon(x.ic, 18)}</span><div><b>${esc(x.t)}</b><p class="muted">${esc(x.d)}</p></div>${x.go ? `<a class="btn sm" href="${x.go}" data-wn="${i}">보기</a>` : ""}</li>`).join("")}</ul>
    <div class="row end"><a class="btn ghost" href="#/learn">학습 센터</a><button class="btn primary" value="ok">확인</button></div></form>`);
  d.querySelectorAll("[data-wn]").forEach((a) => a.addEventListener("click", () => d.close()));
}

// ---------------------------------------------------------------- ② Ctrl+K 명령
function paletteCommands() {
  const uid = ctx.uid, cmds = [];
  const C = (label, sub, run) => cmds.push({ kind: "명령", label, sub, run });
  if (uid) {
    C("리스크 추가", "현재 프로젝트", () => { sessionStorage.setItem("pendingAction", "riskAdd"); location.hash = `#/p/${uid}/risk`; });
    C("제약 일괄 입력 (엑셀 붙여넣기)", "룩어헤드", () => { sessionStorage.setItem("pendingAction", "bulkConstraint"); location.hash = `#/p/${uid}/lookahead`; });
    C("월간 점검 시작", "6단계 점검", () => (location.hash = `#/wizard/${uid}`));
    C("보고 패키지 받기", "Word·엑셀·A3·CSV zip", () => download(`/api/uploads/${uid}/package`, "package.zip"));
    C("A3 공정표 인쇄", "", () => (location.hash = `#/print/${uid}`));
    C("공정표: 끌어서 What-if 켜기", "", () => { sessionStorage.setItem("pendingAction", "ganttEdit"); location.hash = `#/p/${uid}/gantt`; });
    C("비교 겹쳐보기 켜기", "공정표", () => { sessionStorage.setItem("pendingAction", "ganttCmp"); location.hash = `#/p/${uid}/gantt`; });
    C("AI 어시스턴트 열기", "Alt+A", () => openAiPanel());
  }
  C("업데이트 올리기", "XER·MS Project", () => $("#btnUpload")?.click());
  C("새 공정표 만들기", "템플릿·문서", () => showGenerate());
  C("내 설정", "계정·화면·알림", () => (location.hash = "#/me"));
  C("화면 테마 바꾸기", "밝게·어둡게·시스템", () => toggleTheme());
  C("새로 바뀐 점 보기", "", () => maybeWhatsNew(true));
  C("단축키 보기", "?", () => showShortcuts());
  C("디자인 가이드", "", () => (location.hash = "#/design"));
  return cmds;
}
// 명령으로 이동한 뒤 할 일
function runPendingAction() {
  const a = sessionStorage.getItem("pendingAction"); if (!a) return;
  const tries = { riskAdd: "#rkAdd", bulkConstraint: "#laBulkC", ganttEdit: "#fEdit", ganttCmp: "#fCmp" };
  let n = 0;
  const t = setInterval(() => {
    const el = $(tries[a]);
    if (el || ++n > 40) {
      clearInterval(t); sessionStorage.removeItem("pendingAction");
      if (!el) return;
      if (el.type === "checkbox") { el.checked = true; el.dispatchEvent(new Event("change")); el.dispatchEvent(new Event("input")); } else el.click();
    }
  }, 150);
}
window.addEventListener("hashchange", () => setTimeout(runPendingAction, 50));

// ---------------------------------------------------------------- ③ 역할별 홈 구성 + ⑧ 포트폴리오 마일스톤 공정표
const HOME_PRESETS = {
  office: { label: "공무(점검·보고)", order: ["summary", "portfolio", "hub", "msgantt", "team"], hidden: [] },
  field: { label: "현장(이번 주 할 일)", order: ["hub", "portfolio", "summary", "msgantt", "team"], hidden: ["msgantt", "team"] },
  pm: { label: "본사 PM(포트폴리오 위험)", order: ["summary", "msgantt", "portfolio", "hub", "team"], hidden: [] },
};
const HOME_LABEL = { summary: "요약 띠", msgantt: "포트폴리오 마일스톤 공정표", portfolio: "포트폴리오 카드", hub: "할 일 함", team: "팀 공정표 목록" };
function homeLayout() {
  const h = prefs.home || JSON.parse(store.get("homeLayout", "null") || "null");
  return h && h.order ? h : { preset: "office", ...HOME_PRESETS.office };
}
const _showList8 = showList;
showList = async function () {
  await _showList8();
  if (!$(".home-grid")) return;   // 빈 홈
  arrangeHome();
  // 카드에 마우스를 올리면 그 프로젝트 요약을 미리 받아 둔다 (⑰)
  view.querySelectorAll(".card-main").forEach((a) => a.addEventListener("mouseenter", () => { const id = a.getAttribute("href").split("/")[2]; if (id && !cache[id] && !liteCache[id]) loadHead(id).catch(() => {}); }, { once: true }));
};
async function arrangeHome() {
  const L = homeLayout();
  const blocks = {
    summary: $(".sum-band"),
    portfolio: $(".home-grid > div"),
    hub: $(".home-grid > aside"),
    team: $(".proj-groups")?.closest(".panel"),
    msgantt: Object.assign(document.createElement("div"), { className: "panel", id: "msGantt" }),
  };
  const head = view.querySelector(".page-head");
  head?.querySelector(".row")?.insertAdjacentHTML("afterbegin", `<button class="btn ghost" id="btnHomeCfg">${icon("gear", 15)} 홈 구성</button>`);
  const box = document.createElement("div"); box.id = "homeBlocks";
  const vis = L.order.filter((b) => !L.hidden.includes(b) && blocks[b]);
  for (let i = 0; i < vis.length; i++) {
    const b = vis[i], nx = vis[i + 1];
    if ((b === "portfolio" && nx === "hub") || (b === "hub" && nx === "portfolio")) {
      const g = document.createElement("div"); g.className = "home-grid" + (b === "hub" ? " hub-first" : "");
      g.append(blocks.portfolio, blocks.hub); box.append(g); i++;
    } else if (b === "hub") { const w = document.createElement("div"); w.className = "hub-solo"; w.append(blocks.hub); box.append(w); }
    else box.append(blocks[b]);
  }
  Object.entries(blocks).forEach(([k, el]) => { if (el && !vis.includes(k)) el.remove(); });
  view.querySelector(".home-grid:not(#homeBlocks .home-grid)")?.remove();
  head ? head.after(box) : view.prepend(box);
  $("#btnHomeCfg").onclick = homeConfig;
  if (vis.includes("msgantt")) drawMsGantt($("#msGantt"));
}
async function drawMsGantt(el) {
  const pf = await api("/api/portfolio").catch(() => []);
  if (!pf.length) { el.remove(); return; }
  const dates = pf.flatMap((p) => [p.start, p.finish, ...(p.milestones || []).map((m) => m.finish)]).filter(Boolean).sort();
  const t0 = toT(dates[0]) - 15 * dayMs, t1 = toT(dates[dates.length - 1]) + 20 * dayMs;
  const W = 1000, L = 190, RH = 34, H = 34 + pf.length * RH;
  const X = (d) => L + ((toT(d) - t0) / (t1 - t0)) * (W - L - 10);
  const today = new Date().toISOString().slice(0, 10);
  const months = monthTicks(t0, t1).filter((t, i, a) => a.length < 14 || i % 2 === 0);
  const col = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--crit)" };
  el.innerHTML = `<div class="row between"><h3 class="m0">포트폴리오 마일스톤</h3><span class="muted fs12">프로젝트 막대: 시작~예상 준공 · ◆ 마일스톤(채움=완료) · 세로선 오늘</span></div>
    <div class="ms-wrap"><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="프로젝트별 마일스톤 공정표">
      ${months.map((t) => `<line x1="${X(new Date(t).toISOString().slice(0, 10))}" x2="${X(new Date(t).toISOString().slice(0, 10))}" y1="22" y2="${H}" class="ms-grid"/><text x="${X(new Date(t).toISOString().slice(0, 10)) + 3}" y="15" class="ms-axis">${new Date(t).getFullYear() % 100}.${new Date(t).getMonth() + 1}</text>`).join("")}
      ${pf.map((p, i) => { const y = 30 + i * RH, lv = p.level || "ok";
        return `<a href="#/p/${p.id}/overview"><title>${esc(p.name)} · 준공 ${p.finish}</title><rect x="0" y="${y - 4}" width="${W}" height="${RH}" class="ms-row"/>
          <text x="6" y="${y + 13}" class="ms-name">${esc(p.name.length > 14 ? p.name.slice(0, 14) + "…" : p.name)}</text>
          <rect x="${X(p.start)}" y="${y + 6}" width="${Math.max(3, X(p.finish) - X(p.start))}" height="8" rx="4" fill="${col[lv]}" opacity=".28"/>
          ${(p.milestones || []).map((m) => `<g><title>${esc(m.code)} ${esc(m.name)} · ${m.finish}${m.bl ? ` (계획 ${m.bl})` : ""}</title><path d="M${X(m.finish)} ${y + 3} l7 7 -7 7 -7 -7z" fill="${m.done ? col[lv] : "var(--panel)"}" stroke="${col[lv]}" stroke-width="1.6"/></g>`).join("")}
          <text x="${Math.min(W - 70, X(p.finish) + 10)}" y="${y + 14}" class="ms-fin">${p.finish.slice(2)}</text></a>`; }).join("")}
      <line x1="${X(today)}" x2="${X(today)}" y1="20" y2="${H}" class="ms-today"/></svg></div>`;
}
async function homeConfig() {
  let L = JSON.parse(JSON.stringify(homeLayout()));
  const d = _modal(`<form method="dialog" id="fHome"><h3>홈 구성</h3><p class="muted fs13">역할에 맞는 구성을 고르거나, 보일 영역과 순서를 직접 정합니다. 내 계정에만 적용됩니다.</p>
    <div class="seg-tabs" role="group" aria-label="구성">${Object.entries(HOME_PRESETS).map(([k, p]) => `<button type="button" data-pre="${k}" class="${L.preset === k ? "on" : ""}">${p.label}</button>`).join("")}</div>
    <ol id="homeList" class="kpi-cfg"></ol><div class="row end"><button class="btn" value="cancel" formnovalidate>닫기</button><button class="btn primary" value="ok">저장</button></div></form>`);
  const draw = () => {
    $("#homeList").innerHTML = L.order.map((b, i) => `<li><label class="chk"><input type="checkbox" data-b="${b}" ${L.hidden.includes(b) ? "" : "checked"}> ${HOME_LABEL[b]}</label>
      <span><button type="button" class="btn sm ghost" data-up="${i}" aria-label="${HOME_LABEL[b]} 위로" ${i ? "" : "disabled"}>↑</button><button type="button" class="btn sm ghost" data-dn="${i}" aria-label="${HOME_LABEL[b]} 아래로" ${i < L.order.length - 1 ? "" : "disabled"}>↓</button></span></li>`).join("");
    $("#homeList").querySelectorAll("[data-b]").forEach((c) => (c.onchange = () => { L.preset = "custom"; L.hidden = c.checked ? L.hidden.filter((x) => x !== c.dataset.b) : [...L.hidden, c.dataset.b]; syncPre(); }));
    const mv = (i, k) => { [L.order[i], L.order[i + k]] = [L.order[i + k], L.order[i]]; L.preset = "custom"; syncPre(); draw(); };
    $("#homeList").querySelectorAll("[data-up]").forEach((b) => (b.onclick = () => mv(+b.dataset.up, -1)));
    $("#homeList").querySelectorAll("[data-dn]").forEach((b) => (b.onclick = () => mv(+b.dataset.dn, 1)));
  };
  const syncPre = () => d.querySelectorAll("[data-pre]").forEach((b) => b.classList.toggle("on", b.dataset.pre === L.preset));
  d.querySelectorAll("[data-pre]").forEach((b) => (b.onclick = () => { L = { preset: b.dataset.pre, order: [...HOME_PRESETS[b.dataset.pre].order], hidden: [...HOME_PRESETS[b.dataset.pre].hidden] }; syncPre(); draw(); }));
  draw();
  $("#fHome").onsubmit = async (e) => {
    if (e.submitter?.value !== "ok") return; e.preventDefault();
    if (me?.username) prefs = await api("/api/me/prefs", { method: "PUT", json: { home: L } }); else { prefs.home = L; store.set("homeLayout", JSON.stringify(L)); }
    d.close(); showList();
  };
}

// ---------------------------------------------------------------- ④ 내 설정 (#/me)
async function showMe() {
  $("#crumb").textContent = "/ 내 설정";
  ctx.uid = null;
  const [m, p] = await Promise.all([fetch("/api/me").then((r) => r.json()).catch(() => ({})), loadPrefs()]);
  const roleKo = { viewer: "조회", editor: "편집", admin: "관리자" }, pr = { owner: "소유자", member: "멤버" };
  const theme = store.get("theme", "auto"), dens = store.get("density", "normal");
  const deskOn = store.get("deskNotify") === "1" && "Notification" in window && Notification.permission === "granted";
  const types = p.types || {};
  const sec = (id, ic, t, body) => `<section class="panel me-sec" id="${id}" aria-labelledby="${id}-h"><h3 id="${id}-h">${icon(ic, 18)} ${t}</h3>${body}</section>`;
  view.innerHTML = `<div class="page-head"><div><h2>내 설정</h2><p>계정, 화면, 지표, 알림을 한곳에서 바꿉니다. 바뀐 값은 바로 저장됩니다.</p></div></div>
  <div class="me-grid"><nav class="me-nav" aria-label="설정 목차">${[["me-acc", "계정"], ["me-view", "화면"], ["me-home", "홈·지표"], ["me-noti", "알림"], ["me-keys", "단축키"]].map(([h, l]) => `<a href="#/me" data-jump="${h}">${l}</a>`).join("")}</nav><div>
  ${sec("me-acc", "user", "계정", m.username ? `<p><b>${esc(m.username)}</b> · 전역 역할 <span class="tag">${roleKo[m.role] || m.role}</span></p>
      <h4>편집할 수 있는 프로젝트</h4>${Object.entries(m.projects || {}).map(([n, r]) => `<div class="mini">${esc(n)} · ${pr[r]}</div>`).join("") || '<p class="muted">없음 (읽기는 모든 프로젝트 가능)</p>'}
      <h4>비밀번호 변경</h4><form id="fPw" class="me-form"><label>현재 비밀번호<input class="s" type="password" name="current" autocomplete="current-password" required></label>
      <label>새 비밀번호 (10자 이상)<input class="s" type="password" name="new" autocomplete="new-password" minlength="10" required></label><button class="btn">비밀번호 변경</button><p class="err" id="pwErr" role="alert"></p></form>`
    : '<p class="muted">계정 없이 쓰는 공개 모드입니다. 관리자 계정을 만들면 로그인이 켜집니다.</p>')}
  ${sec("me-view", "palette", "화면", `<div class="me-form">
      <label>테마<select class="s" id="meTheme">${[["auto", "시스템 설정 따름"], ["light", "밝게"], ["dark", "어둡게"]].map(([k, l]) => `<option value="${k}" ${theme === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label>표 간격<select class="s" id="meDensity">${[["comfy", "편안"], ["normal", "보통"], ["compact", "촘촘"]].map(([k, l]) => `<option value="${k}" ${dens === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label>용어 표기<select class="s" id="meTerm"><option value="mixed" ${p.term_mode !== "ko" ? "selected" : ""}>실무 영문 (TF, SPI…)</option><option value="ko" ${p.term_mode === "ko" ? "selected" : ""}>한글 우선 (총여유(TF)…)</option></select></label>
      <label>시작 화면<select class="s" id="meStart">${[["home", "홈"], ["portfolio", "포트폴리오만"], ["wizard", "내 최근 프로젝트 월간 점검"], ["field", "내 최근 프로젝트 현장 모드"], ["reports", "보고서 센터"]].map(([k, l]) => `<option value="${k}" ${p.start_page === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label>왼쪽 메뉴<select class="s" id="meSide"><option value="0">펼침</option><option value="1" ${document.body.classList.contains("side-mini") ? "selected" : ""}>아이콘만</option></select></label></div>`)}
  ${sec("me-home", "home", "홈·지표", `<p class="muted">홈 구성: <b>${esc((HOME_PRESETS[homeLayout().preset] || { label: "직접 구성" }).label)}</b></p>
      <div class="row"><button class="btn" id="meHome">홈 구성 바꾸기</button><button class="btn" id="meKpi">상황판 지표 고르기</button></div>`)}
  ${sec("me-noti", "bell", "알림", `${m.username ? `<h4>받을 알림</h4><div class="me-checks">${Object.entries(types).map(([k, l]) => `<label class="chk"><input type="checkbox" data-nt="${k}" ${p.notify.includes(k) ? "checked" : ""}> ${esc(l)}</label>`).join("")}</div>` : ""}
      <h4>바탕화면 알림</h4><label class="chk"><input type="checkbox" id="meDesk" ${deskOn ? "checked" : ""} ${"Notification" in window ? "" : "disabled"}> 새 알림이 오면 이 PC 화면 구석에 알려 주기</label>
      <p class="muted fs12">이 브라우저에서만 동작하며 메일은 보내지 않습니다. 처음 켤 때 브라우저가 허용 여부를 묻습니다.</p>`)}
  ${sec("me-keys", "key", "단축키", `<p><kbd>Ctrl</kbd>+<kbd>K</kbd> 검색·명령, <kbd>g</kbd> 다음 글자로 화면 이동, <kbd>?</kbd> 전체 목록</p><button class="btn" id="meKeys">단축키 전체 보기</button>`)}
  </div></div>`;
  view.querySelectorAll("[data-jump]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); $("#" + a.dataset.jump).scrollIntoView({ behavior: "smooth", block: "start" }); }));
  const saved = () => toast("저장했습니다");
  const putPrefs = async (body) => { if (me?.username) prefs = await api("/api/me/prefs", { method: "PUT", json: body }); else Object.assign(prefs, body); saved(); };
  $("#meTheme").onchange = (e) => { store.set("theme", e.target.value); applyTheme(); saved(); };
  $("#meDensity").onchange = (e) => { store.set("density", e.target.value); applyDensity(); saved(); };
  $("#meTerm").onchange = (e) => { store.set("termMode", e.target.value); putPrefs({ term_mode: e.target.value }); };
  $("#meStart").onchange = (e) => putPrefs({ start_page: e.target.value });
  $("#meSide").onchange = (e) => { document.body.classList.toggle("side-mini", e.target.value === "1"); store.set("sideMini", e.target.value); renderSide(); saved(); };
  view.querySelectorAll("[data-nt]").forEach((c) => (c.onchange = () => putPrefs({ notify: [...view.querySelectorAll("[data-nt]:checked")].map((x) => x.dataset.nt) })));
  $("#meDesk").onchange = async (e) => {
    if (e.target.checked) {
      const perm = await Notification.requestPermission().catch(() => "denied");
      if (perm !== "granted") { e.target.checked = false; toast("브라우저에서 알림이 허용되지 않았습니다"); return; }
      new Notification("공정관리 분석기", { body: "바탕화면 알림을 켰습니다" });
    }
    store.set("deskNotify", e.target.checked ? "1" : "0"); saved();
  };
  $("#meHome").onclick = homeConfig;
  $("#meKpi").onclick = () => { if (ctx.lastUid) kpiConfig(ctx.lastUid); else toast("프로젝트 상황판에서 '지표 고르기'를 누르세요"); };
  $("#meKeys").onclick = () => showShortcuts();
  $("#fPw")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api("/api/me/password", { method: "POST", json: Object.fromEntries(new FormData(e.target)) }); toast("비밀번호를 바꿨습니다. 다시 로그인하세요."); setTimeout(() => location.reload(), 1200); }
    catch (err) { $("#pwErr").textContent = err.message; }
  });
  enhance(view);
}
showMyInfo = () => (location.hash = "#/me");
showPrefs = () => (location.hash = "#/me");
const _showProject8 = showProject;
showProject = async function (uid, ...a) { ctx.lastUid = uid; return _showProject8(uid, ...a); };

// ---------------------------------------------------------------- ⑩ 업데이트 비교 화면 (새 디자인)
showCompare = async function (a, b) {
  $("#crumb").textContent = "/ 업데이트 비교";
  view.innerHTML = skeleton();
  const c = await api(`/api/compare?base=${a}&target=${b}`);
  const sl = c.finish_slip;
  const late = c.changed.filter((x) => x.d_finish > 0).length, early = c.changed.filter((x) => x.d_finish < 0).length;
  view.innerHTML = `<div class="page-head"><div><h2>업데이트 비교</h2><p>${esc(c.base.name)} · DD ${c.base.data_date} → ${c.target.name !== c.base.name ? esc(c.target.name) + " · " : ""}DD ${c.target.data_date}</p></div>
    <div class="row"><a class="btn" href="#/p/${b}/timeline">${icon("clock", 15)} 타임라인</a><button class="btn primary" id="cmpGantt">${icon("gantt", 15)} 공정표에서 겹쳐 보기</button></div></div>
    <div class="kpis"><div class="kpi ${sl > 0 ? "tone-bad" : sl < 0 ? "tone-good" : ""}"><div class="l">예상 준공 변화</div><div class="v">${sl > 0 ? "+" : ""}${sl}<small>일</small></div><div class="muted fs12">${c.base.finish} → ${c.target.finish}</div></div>
      <div class="kpi"><div class="l">종료일 늦어진 작업</div><div class="v ${late ? "crit" : ""}">${late}<small>개</small></div></div>
      <div class="kpi"><div class="l">종료일 당겨진 작업</div><div class="v">${early}<small>개</small></div></div>
      <div class="kpi"><div class="l">추가 · 삭제</div><div class="v">${c.added.length}<small> / </small>${c.removed.length}</div></div></div>
    <div class="panel"><div class="row between"><h3 class="m0">바뀐 작업 <span class="muted fs13">(종료일 변동 큰 순)</span></h3>
      <div class="seg-tabs sm" role="group" aria-label="보기">${[["all", "전체"], ["late", "늦어짐"], ["early", "당겨짐"], ["crit", "주공정"], ["dur", "공기 변경"]].map(([k, l], i) => `<button data-cf="${k}" class="${i ? "" : "on"}">${l}</button>`).join("")}</div></div>
      <div id="cmpTbl"></div></div>
    <div class="grid2"><div class="panel"><h3 class="mt0">추가된 작업 (${c.added.length})</h3>${simpleList(c.added) || emptyState("없음")}</div>
      <div class="panel"><h3 class="mt0">삭제된 작업 (${c.removed.length})</h3>${simpleList(c.removed) || emptyState("없음")}</div></div>`;
  const draw = (f) => {
    const xs = c.changed.filter((x) => f === "all" || (f === "late" && x.d_finish > 0) || (f === "early" && x.d_finish < 0) || (f === "crit" && x.critical) || (f === "dur" && x.d_dur));
    $("#cmpTbl").innerHTML = xs.length ? `<div class="scroll"><table class="t"><thead><tr><th>ID</th><th>작업</th><th>상태</th><th>종료(기준)</th><th>종료(비교)</th><th class="num">종료 변화</th><th class="num">TF 기준→비교</th><th class="num">원공기 변화</th></tr></thead><tbody>
      ${xs.map((x) => `<tr><td><button class="act-link" data-act="${esc(x.code)}">${esc(x.code)}</button></td><td class="wrap">${esc(x.name)}${x.critical ? ' <span class="chip bad">주공정</span>' : ""}</td>
        <td>${esc(x.status_before)}${x.status_before !== x.status_after ? " → " + esc(x.status_after) : ""}</td><td>${x.finish_before}</td><td>${x.finish_after}</td>
        <td class="num"><span class="delta ${x.d_finish > 0 ? "bad" : x.d_finish < 0 ? "good" : "same"}">${x.d_finish > 0 ? "+" : ""}${x.d_finish}일</span></td>
        <td class="num">${fmtDays(x.tf_before)} → ${fmtDays(x.tf_after)}</td><td class="num">${x.d_dur ? (x.d_dur > 0 ? "+" : "") + x.d_dur : ""}</td></tr>`).join("")}</tbody></table></div>` : emptyState("해당하는 작업이 없습니다");
    enhance($("#cmpTbl"));
  };
  view.querySelectorAll("[data-cf]").forEach((btn) => (btn.onclick = () => { view.querySelectorAll("[data-cf]").forEach((x) => x.classList.toggle("on", x === btn)); draw(btn.dataset.cf); }));
  draw("all");
  $("#cmpGantt").onclick = () => { setBase(c.target.name, a); sessionStorage.setItem("pendingAction", "ganttCmp"); location.hash = `#/p/${b}/gantt`; };
  ctx.result = null;
};

// ---------------------------------------------------------------- ⑨ 차트에서 바로 들어가기
function activitiesDrawer(title, acts, note = "") {
  const d = openDrawer(esc(title), `${note ? `<p class="muted fs13">${note}</p>` : ""}${acts.length ? `<table class="t" data-noexport><thead><tr><th>ID</th><th>작업</th><th>기간</th><th class="num">TF</th></tr></thead><tbody>
    ${acts.slice(0, 300).map((a) => `<tr><td><button class="act-link" data-act="${esc(a.code)}">${esc(a.code)}</button></td><td class="wrap">${esc(a.name)}${a.longest ? ' <span class="chip bad">최장</span>' : ""}</td>
      <td class="fs12">${a.start.slice(2)}~${a.finish.slice(2)}</td><td class="num">${fmtDays(a.tf)}</td></tr>`).join("")}</tbody></table>${acts.length > 300 ? `<p class="muted">처음 300개만 표시</p>` : ""}` : emptyState("해당 기간에 진행할 작업이 없습니다")}`);
  return d;
}
const _tabScurve8 = tabScurve;
tabScurve = function (el, r) {
  const _c = chartSvg;
  chartSvg = (host, opt) => _c(host, { ...opt, onPick: (i) => {
    const d = r.s_curve.dates[i], prev = r.s_curve.dates[Math.max(0, i - 1)];
    const acts = r.activities.filter((a) => a.start <= d && a.finish >= prev).sort((x, y) => (x.start < y.start ? -1 : 1));
    activitiesDrawer(`${d} 무렵 진행 작업 (${acts.length})`, acts, `${prev} ~ ${d} 사이에 진행 중인 작업입니다 (Early 일정).`);
  } });
  try { return _tabScurve8(el, r); } finally { chartSvg = _c; }
};
const _tabResources8 = tabResources;
tabResources = async function (el, r, uid) {
  const _c = chartSvg;
  chartSvg = (host, opt) => _c(host, { ...opt, onPick: (i) => {
    const full = "20" + opt.labels[i];
    const end = new Date(toT(full) + 6 * dayMs).toISOString().slice(0, 10);
    const acts = r.activities.filter((a) => a.has_resource && a.start <= end && a.finish >= full);
    activitiesDrawer(`${full} 주 자원 투입 작업 (${acts.length})`, acts, "막대가 솟은 주에 자원을 쓰는 작업입니다. 여유가 있는 작업을 뒤로 미루면 평준화할 수 있습니다.");
  } });
  try { return await _tabResources8(el, r, uid); } finally { chartSvg = _c; }
};

// ---------------------------------------------------------------- ⑫ 바탕화면 알림
const _poll8 = pollNotifications;
pollNotifications = async function () {
  await _poll8();
  if (store.get("deskNotify") !== "1" || !("Notification" in window) || Notification.permission !== "granted" || !me?.username) return;
  try {
    const n = await api("/api/notifications");
    const seen = new Set(JSON.parse(store.get("deskSeen", "[]")));
    const first = !store.get("deskSeen");
    n.items.filter((x) => !x.read && !seen.has(x.id)).slice(0, 3).forEach((x) => {
      if (!first) { const no = new Notification("공정관리 분석기", { body: x.text, tag: x.id }); no.onclick = () => { window.focus(); if (x.link) location.hash = x.link.replace(/^#/, "#"); no.close(); }; }
      seen.add(x.id);
    });
    n.items.forEach((x) => seen.add(x.id));
    store.set("deskSeen", JSON.stringify([...seen].slice(-200)));
  } catch {}
};

// ---------------------------------------------------------------- ⑪ 회사 로고 (관리자)
const _showAdmin8 = showAdmin;
showAdmin = async function () {
  await _showAdmin8();
  const has = await fetch("/api/logo").then((r) => r.ok).catch(() => false);
  const p = document.createElement("div"); p.className = "panel"; p.id = "logoPanel";
  p.innerHTML = `<h3 class="mt0">회사 로고</h3><p class="muted fs13">A3 공정표, 인쇄 화면, Word 보고서 머리에 들어갑니다. PNG·JPG, 512KB 이하, 가로형 권장.</p>
    <div class="row">${has ? `<img src="/api/logo?t=${Date.now()}" alt="현재 로고" class="logo-prev">` : '<span class="muted">등록된 로고 없음</span>'}
      <label class="btn">${icon("upload", 15)} 로고 올리기<input type="file" accept="image/png,image/jpeg" id="logoFile" hidden></label>${has ? '<button class="btn danger" id="logoDel">로고 지우기</button>' : ""}</div>`;
  ($("#updPanel") || view.querySelector("h2"))?.after(p);
  $("#logoFile").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.append("file", f);
    try { await api("/api/admin/logo", { method: "POST", body: fd }); toast("로고를 등록했습니다"); showAdmin(); } catch (err) { toast(err.message); }
  };
  $("#logoDel")?.addEventListener("click", async () => { await api("/api/admin/logo", { method: "DELETE" }); toast("로고를 지웠습니다"); showAdmin(); });
};

// ---------------------------------------------------------------- ⑯ 접근성 보완: 빈 표 머리글, 따라하기 창 구역
function a11yFix(root) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll("th").forEach((th) => { if (!th.textContent.trim() && !th.querySelector(".sr-only")) th.insertAdjacentHTML("beforeend", '<span class="sr-only">동작</span>'); });
  root.querySelectorAll(".tour-pop:not([aria-label])").forEach((p) => { p.setAttribute("role", "region"); p.setAttribute("aria-label", "따라하기 안내"); });
}
new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && a11yFix(n.matches?.("th,.tour-pop") ? n.parentNode : n))))
  .observe(document.documentElement, { childList: true, subtree: true });

// ---------------------------------------------------------------- 시작
document.addEventListener("DOMContentLoaded", () => setTimeout(() => { maybeWhatsNew(); runPendingAction(); }, 800));

// 도움말 풍선(.tip)을 '도움말' 구역 안에 두어 화면 구역(landmark) 규칙을 지킴
document.addEventListener("DOMContentLoaded", () => {
  const layer = Object.assign(document.createElement("aside"), { id: "tipLayer" }); layer.setAttribute("aria-label", "도움말 풍선");
  document.body.appendChild(layer);
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1 && n.classList?.contains("tip") && n.parentNode === document.body) layer.appendChild(n); })))
    .observe(document.body, { childList: true });
});

// 화면 전환 경쟁 방지: 늦게 끝난 이전 화면(홈 등)이 새 화면을 덮어쓰지 않도록 이동 표시를 올림
for (const fn of ["showMe", "showDesign", "showCompare", "showLearn", "showAdmin", "showProjectsAccess", "showPrint", "showField"]) {
  const orig = window[fn] || globalThis[fn];
  if (typeof orig !== "function") continue;
  const wrapped = async function (...a) { ++navToken; return orig.apply(this, a); };
  try { eval(`${fn} = wrapped`); } catch { window[fn] = wrapped; }
}
