"use strict";
// ---------------------------------------------------------------- 공통
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const view = $("#view");
const store = {
  get(k, d = "") { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
let cache = {}; // uid -> upload detail

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2500);
}

async function api(path, opts = {}) {
  opts.headers = { ...(opts.headers || {}), "X-App-Token": store.get("token"), "X-User": encodeURIComponent(store.get("uploader")), "X-Requested-With": "fetch" };
  opts.credentials = "same-origin";
  if (opts.json !== undefined) { opts.body = JSON.stringify(opts.json); opts.headers["Content-Type"] = "application/json"; delete opts.json; }
  const r = await fetch(path, opts);
  if (r.status === 401 && path !== "/api/login") {
    const cfg = await fetch("/api/config").then((x) => x.json());
    if (cfg.login_required) { await showLogin(); return api(path, opts); }
    const dlg = $("#dlgToken");
    dlg.showModal();
    await new Promise((res) => dlg.addEventListener("close", res, { once: true }));
    store.set("token", dlg.querySelector("input").value);
    return api(path, opts);
  }
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch {}
    throw new Error(msg);
  }
  return r.headers.get("content-type")?.includes("json") ? r.json() : r;
}

async function download(path, fallbackName) {
  const r = await api(path);
  const blob = await r.blob();
  const cd = r.headers.get("content-disposition") || "";
  const m = cd.match(/filename\*=UTF-8''([^;]+)/);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = m ? decodeURIComponent(m[1]) : fallbackName;
  a.click();
  URL.revokeObjectURL(a.href);
}

const fmtDays = (n) => (n === null || n === undefined ? "" : n);
const dayMs = 86400000;
const toT = (s) => (s ? Date.parse(s + "T00:00:00") : null);
const cssv = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || "#888";

// ---------------------------------------------------------------- 업로드
$("#btnUpload").onclick = () => {
  const f = $("#formUpload");
  f.uploader.value = store.get("uploader");
  $("#uploadErr").textContent = "";
  $("#dlgUpload").showModal();
};
$("#formUpload").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "ok") return;
  e.preventDefault();
  const f = e.target;
  const fd = new FormData(f);
  store.set("uploader", f.uploader.value);
  const btn = $("#btnDoUpload");
  btn.disabled = true; btn.textContent = "분석 중...";
  try {
    const r = await api("/api/upload", { method: "POST", body: fd });
    $("#dlgUpload").close();
    f.reset();
    toast("업로드 및 분석 완료");
    location.hash = `#/p/${r.ids[0]}/overview`;
    route();
  } catch (err) {
    $("#uploadErr").textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = "업로드 및 분석";
  }
});

// ---------------------------------------------------------------- 라우팅
window.addEventListener("hashchange", route);
async function route() {
  closeDrawer(); if (!location.hash.startsWith("#/p/")) { ctx.uid = null; ctx.result = null; }
  document.body.classList.toggle("field", location.hash.startsWith("#/field/"));
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  try {
    if (parts[0] === "p" && parts[1]) return await showProject(parts[1], parts[2] || "overview");
    if (parts[0] === "cmp" && parts[1] && parts[2]) return await showCompare(parts[1], parts[2]);
    if (parts[0] === "admin") return await showAdmin();
    if (parts[0] === "learn") return await showLearn(parts[1], parts[2]);
    if (parts[0] === "field" && parts[1]) return await showField(parts[1]);
    if (parts[0] === "print" && parts[1]) return await showPrint(parts[1]);
    return await showList();
  } catch (err) {
    view.innerHTML = `<div class="panel err">오류: ${esc(err.message)}</div>`;
  }
}

// ---------------------------------------------------------------- 목록
async function showList() {
  $("#crumb").textContent = "";
  const [list, pf] = await Promise.all([api("/api/uploads"), api("/api/portfolio")]);
  if (!list.length) {
    view.innerHTML = `<div class="panel empty"><h2>업로드된 공정표가 없습니다</h2>
      <p>P6 XER 또는 MS Project XML 파일을 올리거나, 템플릿·문서로 초기 공정표를 만들어 보세요.</p>
      <div class="row" style="justify-content:center"><button class="btn primary" onclick="$('#btnUpload').click()">파일 업로드</button>
      <button class="btn" onclick="showGenerate()">새 공정표 만들기</button></div></div>`;
    return;
  }
  const sig = (v, good, warn) => v === null || v === undefined ? "" : v >= good ? "ok" : v >= warn ? "warn" : "bad";
  view.innerHTML = `
  <div id="inbox"></div>
  <div class="row" style="justify-content:space-between;margin-bottom:10px"><h2 style="margin:0">포트폴리오</h2>
    <div class="row"><a class="btn" href="#/learn">🎓 학습 센터</a><button class="btn" onclick="showGenerate()" data-need="editor">+ 새 공정표 만들기</button></div></div>
  <div class="cards">${pf.sort((a, b) => JSON.parse(store.get("favs", "[]")).includes(b.name) - JSON.parse(store.get("favs", "[]")).includes(a.name)).map((p) => `<a class="card" data-name="${esc(p.name)}" href="#/p/${p.id}/overview">
      <div class="row" style="justify-content:space-between"><b>${esc(p.name)}</b><span class="muted" style="font-size:12px">DD ${p.data_date}</span></div>
      <div class="big">${p.finish}<span class="muted" style="font-size:12px"> 예상 준공</span></div>
      <div class="chips">
        <span class="chip ${p.margin === null ? "" : p.margin >= 0 ? "ok" : "bad"}">${p.margin === null ? "목표 준공 없음" : p.margin >= 0 ? `✓ 여유 ${p.margin}일` : `✕ 지연 ${-p.margin}일`}</span>
        ${p.slip !== null ? `<span class="chip ${p.slip > 0 ? "bad" : "ok"}">${p.slip > 0 ? "▼" : "▲"} 전회 ${p.slip > 0 ? "+" : ""}${p.slip}일</span>` : ""}
        <span class="chip ${sig(p.health, 75, 60)}">건전성 ${p.health ?? "-"}</span>
        ${p.spi !== null ? `<span class="chip ${sig(p.spi, 0.95, 0.85)}">SPI ${p.spi}</span>` : ""}
        ${p.cpi !== null ? `<span class="chip ${sig(p.cpi, 0.95, 0.85)}">CPI ${p.cpi}</span>` : ""}
        ${p.open_risks ? `<span class="chip warn">리스크 ${p.open_risks}</span>` : ""}
        ${p.negative_float ? `<span class="chip bad">음수여유 ${p.negative_float}</span>` : ""}
      </div>
      <div class="bar"><i style="width:${p.progress}%"></i></div><div class="muted" style="font-size:12px">공정률 ${p.progress}% · 업데이트 ${p.updates}회</div>
    </a>`).join("")}</div>
  <div class="panel">
    <div class="row" style="justify-content:space-between;margin-bottom:10px">
      <h3 style="margin:0">팀 공정표 목록 <span class="muted">(${list.length})</span></h3>
      <div class="row">
        <span class="muted">업데이트 비교:</span>
        <select class="s" id="cmpA">${list.map((u) => `<option value="${u.id}">${esc(u.name)} · ${u.data_date}</option>`).join("")}</select>
        <span>→</span>
        <select class="s" id="cmpB">${list.map((u) => `<option value="${u.id}">${esc(u.name)} · ${u.data_date}</option>`).join("")}</select>
        <button class="btn" id="btnCmp">비교</button>
      </div>
    </div>
    <div class="scroll"><table class="t">
      <thead><tr><th>프로젝트</th><th>Data Date</th><th>예상 준공</th><th class="num">액티비티</th>
      <th>메모</th><th>업로더</th><th>업로드 시각</th><th></th></tr></thead>
      <tbody>${list.map((u) => `<tr>
        <td><a href="#/p/${u.id}/overview"><b>${esc(u.name)}</b></a><div class="muted" style="font-size:12px">${esc(u.filename)}</div></td>
        <td>${u.data_date}</td><td>${u.finish}</td><td class="num">${u.activities}</td>
        <td class="wrap">${esc(u.note)}</td><td>${esc(u.uploader)}</td><td>${u.created_at.replace("T", " ")}</td>
        <td><button class="btn sm" data-xer="${u.id}">XER</button>
            <button class="btn sm danger" data-del="${u.id}" data-need="admin">삭제</button></td></tr>`).join("")}
      </tbody></table></div>
  </div>`;
  renderInbox($("#inbox"));
  const favs = JSON.parse(store.get("favs", "[]"));
  view.querySelectorAll(".card").forEach((c) => { if (favs.includes(c.dataset.name)) c.classList.add("fav"); });
  enhance(view);
  if (list.length > 1) $("#cmpA").selectedIndex = 1;
  $("#btnCmp").onclick = () => (location.hash = `#/cmp/${$("#cmpA").value}/${$("#cmpB").value}`);
  view.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!(await ui.confirm("이 업로드를 삭제할까요? 팀 전체에서 사라집니다.", { ok: "삭제", danger: true }))) return;
    await api(`/api/uploads/${b.dataset.del}`, { method: "DELETE" });
    delete cache[b.dataset.del];
    toast("삭제되었습니다"); showList();
  }));
  view.querySelectorAll("[data-xer]").forEach((b) => (b.onclick = () => download(`/api/uploads/${b.dataset.xer}/xer`, "project.xer")));
}

// ---------------------------------------------------------------- 프로젝트
const GROUPS = [
  ["현황", [["overview", "개요"], ["gantt", "공정표"], ["critical", "주공정"], ["scurve", "S-Curve"], ["evm", "베이스라인·EVM"], ["resources", "자원"]]],
  ["품질·진단", [["health", "건전성·DCMA"], ["analysis", "업데이트 분석"], ["p6", "P6 일정 비교"], ["korea", "국내 기준"], ["rels", "관계 추천"]]],
  ["리스크·대응", [["risk", "리스크·예측"], ["recovery", "자동 만회안"], ["whatif", "What-if"]]],
  ["현장·보고", [["lookahead", "룩어헤드·PPC"], ["daily", "작업일보 진도"], ["report", "월간 보고서"], ["trades", "공종 분류"], ["bench", "벤치마크"]]],
];
const TAB_GROUP = Object.fromEntries(GROUPS.flatMap(([g, ts]) => ts.map(([k]) => [k, g])));
const TAB_LABEL = Object.fromEntries(GROUPS.flatMap(([, ts]) => ts));
const TAB_ALIAS = { dcma: "health", delay: "analysis", forensic: "analysis", predict: "risk", chat: "overview" };
let aiStatus = null;
async function getAiStatus() { if (!aiStatus) aiStatus = await api("/api/ai/status"); return aiStatus; }

async function load(uid) {
  if (!cache[uid]) cache[uid] = await api(`/api/uploads/${uid}`);
  return cache[uid];
}

let uploadsCache = null;
async function showProject(uid, tab) {
  if (tab === "chat") setTimeout(() => openAiPanel(), 50);
  tab = TAB_ALIAS[tab] || tab;
  const u = await load(uid);
  const r = u.result;
  ctx.uid = uid; ctx.tab = tab; ctx.result = r;
  uploadsCache = uploadsCache || await api("/api/uploads");
  const same = uploadsCache.filter((x) => x.name === r.name).sort((a, b) => (a.data_date < b.data_date ? 1 : -1));
  const latest = same[0]?.id === uid;
  const favs = JSON.parse(store.get("favs", "[]"));
  $("#crumb").innerHTML = `/ <a href="#/p/${uid}/overview">${esc(r.name)}</a> / ${esc(TAB_LABEL[tab] || (tab === "settings" ? "설정" : ""))}`;
  view.innerHTML = `
    <div class="phead">
      <div><h2 style="margin:0">${esc(r.name)} <button class="btn icon fav ${favs.includes(r.name) ? "on" : ""}" id="btnFav" aria-label="관심 프로젝트" title="관심 프로젝트">★</button></h2>
        <div class="row muted" style="gap:6px;margin-top:4px">
          <label for="upSel">업데이트</label>
          <select class="s sm" id="upSel" aria-label="업데이트 선택">${same.map((x) => `<option value="${x.id}" ${x.id === uid ? "selected" : ""}>DD ${x.data_date} · ${esc(x.note || x.filename)}</option>`).join("")}</select>
          ${latest ? '<span class="chip ok">✓ 최신</span>' : '<span class="chip warn">! 최신 아님</span>'}
          <span class="chip">${r.options?.progress_override ? "Progress Override" : "Retained Logic"}</span>
          <span>업로더 ${esc(u.uploader)}</span></div></div>
      <div class="row"><a class="btn" href="#/field/${uid}" title="현장 모바일 화면">📱 현장 모드</a>
        <button class="btn" id="btnHelp" title="이 화면 사용법">? 사용법</button>
        <button class="btn" id="btnRecalc" title="최신 엔진으로 다시 계산" data-need="editor">재계산</button></div>
    </div>
    ${r.warnings.map((w) => `<div class="panel err">⚠ ${esc(w)}</div>`).join("")}
    <nav class="groups" aria-label="화면 그룹">${GROUPS.map(([g, ts]) => `<a href="#/p/${uid}/${ts[0][0]}" class="${TAB_GROUP[tab] === g ? "on" : ""}" ${TAB_GROUP[tab] === g ? 'aria-current="page"' : ""}>${g}</a>`).join("")}
      <button class="ai-link" id="btnAi" title="Alt+A">✦ AI 어시스턴트</button>
      <a href="#/p/${uid}/settings" class="${tab === "settings" ? "on" : ""}">⚙ 설정</a></nav>
    ${TAB_GROUP[tab] ? `<nav class="tabs" role="tablist">${GROUPS.find(([g]) => g === TAB_GROUP[tab])[1].map(([k, l]) => `<a role="tab" aria-selected="${k === tab}" href="#/p/${uid}/${k}" class="${k === tab ? "on" : ""}">${l}</a>`).join("")}</nav>` : ""}
    <div id="tab"></div>`;
  $("#upSel").onchange = (e) => (location.hash = `#/p/${e.target.value}/${tab}`);
  $("#btnAi").onclick = () => openAiPanel();
  $("#btnHelp").onclick = () => openHelpFor(tab);
  $("#btnFav").onclick = () => {
    const f = new Set(JSON.parse(store.get("favs", "[]"))); f.has(r.name) ? f.delete(r.name) : f.add(r.name);
    store.set("favs", JSON.stringify([...f])); $("#btnFav").classList.toggle("on", f.has(r.name));
  };
  $("#btnRecalc").onclick = async () => {
    await api(`/api/uploads/${uid}/recalc`, { method: "POST" });
    delete cache[uid]; toast("재계산 완료"); showProject(uid, tab);
  };
  const el = $("#tab");
  el.dataset.uid = uid;
  ({ overview: tabOverview, gantt: tabGantt, critical: tabCritical, dcma: tabDcma, scurve: tabScurve, p6: tabP6,
     chat: tabChat, report: tabReport, delay: tabDelay, whatif: tabWhatif, rels: tabRels, trades: tabTrades,
     risk: tabRisk, bench: tabBench, daily: tabDaily, health: tabHealth, forensic: tabForensic, predict: tabPredict,
     recovery: tabRecovery, evm: tabEvm, resources: tabResources, korea: tabKorea, lookahead: tabLookahead,
     settings: tabSettings, analysis: tabAnalysis }[tab] || tabOverview)(el, r, uid);
  enhance(el);
  maybeStartTour(tab);
}

function kpi(label, value, cls = "") {
  return `<div class="kpi"><div class="l">${label}</div><div class="v ${cls}">${value}</div></div>`;
}

function tabOverview(el, r) {
  const s = r.summary;
  const passed = r.dcma.filter((d) => d.pass).length;
  const neg = r.activities.filter((a) => a.tf !== null && a.tf < 0).length;
  const ms = r.activities.filter((a) => a.milestone).sort((a, b) => (a.start > b.start ? 1 : -1));
  el.innerHTML = `
    <div class="kpis">
      ${kpi("예상 준공일 (재계산)", r.finish)}
      ${kpi("목표 준공일 (Must Finish)", r.must_finish || "-")}
      ${kpi("잔여 작업일", s.remaining_workdays + "일")}
      ${kpi("공정률 (공기 가중)", s.progress_pct + "%")}
      ${kpi("액티비티 / 관계", `${s.activities} / ${s.relationships}`)}
      ${kpi("미착수 · 진행 · 완료", `${s.not_started} · ${s.in_progress} · ${s.completed}`)}
      ${kpi("주공정(TF≤0)", s.critical, s.critical ? "crit" : "")}
      ${kpi("최장경로 액티비티", s.longest_path)}
      ${kpi("음수 여유 액티비티", neg, neg ? "crit" : "")}
      ${kpi("DCMA 통과", `${passed} / 14`, passed < 10 ? "crit" : "")}
    </div>
    <div class="panel"><h3 style="margin-top:0">마일스톤</h3>
      ${ms.length ? `<table class="t"><thead><tr><th>ID</th><th>마일스톤</th><th>상태</th><th>예정일</th><th>계획일</th><th class="num">TF</th></tr></thead><tbody>
      ${ms.map((a) => `<tr><td>${esc(a.code)}</td><td>${esc(a.name)}</td><td>${statusTag(a)}</td><td>${a.act_end || a.finish}</td>
      <td>${a.bl_finish || "-"}</td><td class="num">${fmtDays(a.tf)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">마일스톤이 없습니다.</p>`}
    </div>
    <div class="panel"><h3 style="margin-top:0">캘린더</h3><p>${s.calendars.map(esc).join(", ")}</p></div>`;
}

function statusTag(a) {
  if (a.status_code === "TK_Complete") return `<span class="tag done">완료</span>`;
  if (a.critical) return `<span class="tag crit">${a.status}·주공정</span>`;
  return `<span class="tag">${a.status}</span>`;
}

function actTable(rows, extra = "") {
  return `<div class="scroll"><table class="t"><thead><tr><th>ID</th><th>액티비티명</th><th>WBS</th><th>상태</th>
    <th class="num">잔여</th><th>시작</th><th>종료</th><th class="num">TF</th><th class="num">FF</th>${extra}</tr></thead><tbody>
    ${rows.map((a) => `<tr><td>${esc(a.code)}</td><td class="wrap">${esc(a.name)}</td><td class="wrap muted">${esc(a.wbs)}</td>
    <td>${statusTag(a)}</td><td class="num">${a.rem_dur}</td><td>${a.start}</td><td>${a.finish}</td>
    <td class="num">${fmtDays(a.tf)}</td><td class="num">${fmtDays(a.ff)}</td></tr>`).join("")}</tbody></table></div>`;
}

function tabCritical(el, r) {
  const lp = r.activities.filter((a) => a.longest).sort((a, b) => (a.start > b.start ? 1 : a.start < b.start ? -1 : 0));
  const thr = +store.get("nearCrit", "10");
  const near = r.activities.filter((a) => a.tf !== null && a.tf > 0 && a.tf <= thr && !a.longest)
    .sort((a, b) => a.tf - b.tf);
  el.innerHTML = `
    <div class="panel"><h3 style="margin-top:0">최장 경로 (Longest Path) <span class="muted">${lp.length}개</span></h3>
      <p class="muted">프로젝트 최종 종료 액티비티에서 구동(Driving) 관계를 역추적한 경로입니다.</p>${actTable(lp)}</div>
    <div class="panel"><div class="row" style="justify-content:space-between"><h3 style="margin:0">준주공정 (Near-Critical)</h3>
      <label class="muted">TF ≤ <input class="s" id="thr" type="number" value="${thr}" style="width:70px"> 일</label></div>
      ${actTable(near)}</div>`;
  $("#thr").onchange = (e) => { store.set("nearCrit", e.target.value); tabCritical(el, r); };
}

function tabDcma(el, r) {
  const passed = r.dcma.filter((d) => d.pass).length;
  el.innerHTML = `<div class="panel">
    <h3 style="margin-top:0">DCMA 14-Point Assessment <span class="tag ${passed >= 10 ? "ok" : "fail"}">${passed}/14 통과</span></h3>
    <p class="muted">미국 국방부 DCMA의 공정표 품질 평가 기준입니다. 행을 누르면 해당 액티비티 목록이 펼쳐집니다.</p>
    <table class="t"><thead><tr><th>#</th><th>항목</th><th>설명</th><th class="num">해당</th><th class="num">결과</th><th>기준</th><th>판정</th></tr></thead>
    <tbody>${r.dcma.map((d, i) => `<tr data-i="${i}" style="cursor:${d.items.length ? "pointer" : "default"}">
      <td>${d.no}</td><td><b>${esc(d.name)}</b></td><td class="wrap">${esc(d.desc)}</td>
      <td class="num">${d.unit === "%" ? `${d.count} / ${d.total}` : ""}</td>
      <td class="num">${d.value}${d.unit}</td><td>${d.threshold}</td>
      <td>${d.threshold === "참고" ? '<span class="tag">참고</span>' : d.pass ? '<span class="tag ok">통과</span>' : '<span class="tag fail">미달</span>'}</td></tr>
      <tr class="dx" id="dx${i}" hidden><td></td><td colspan="6" class="dcma-items">${d.items.map(esc).join(", ")}${d.items.length >= 200 ? " …" : ""}
        <div class="guide" id="gd${d.no}"></div></td></tr>`).join("")}
    </tbody></table></div>
    <div class="panel"><div class="row" style="justify-content:space-between"><h3 style="margin:0">조치 가이드</h3>
      <button class="btn" id="btnDcmaAi">✦ AI 우선순위 조치안</button></div>
      <div id="dcmaGuide" class="muted" style="margin-top:8px">불러오는 중...</div></div>`;
  const uid = el.dataset.uid;
  const showGuide = (g) => {
    const items = Object.entries(g.guides).map(([no, xs]) => {
      const d = r.dcma.find((x) => String(x.no) === no);
      const gd = $(`#gd${no}`); if (gd) gd.innerHTML = `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
      return `<h4 style="margin:10px 0 4px">${no}. ${esc(d.name)}</h4><ul>${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
    }).join("");
    $("#dcmaGuide").innerHTML = (g.narrative ? `<div class="ai-box">${md(g.narrative)}</div>` : "") + (items || "모든 항목이 기준을 충족합니다.");
    $("#dcmaGuide").classList.remove("muted");
  };
  api(`/api/uploads/${uid}/dcma_guide`).then(showGuide);
  $("#btnDcmaAi").onclick = async () => { const x = await runLong("AI가 조치안을 정리하는 중", "dcma", (signal) => api(`/api/uploads/${uid}/dcma_guide?ai=1`, { signal })); if (x) showGuide(x); };
  el.querySelectorAll("tr[data-i]").forEach((tr) => (tr.onclick = () => {
    const x = $(`#dx${tr.dataset.i}`); if (r.dcma[tr.dataset.i].items.length) x.hidden = !x.hidden;
  }));
}

function tabP6(el, r) {
  const c = r.p6_compare;
  el.innerHTML = `<div class="panel">
    <h3 style="margin-top:0">P6 계산 결과와 비교 <span class="tag ${c.match_pct >= 90 ? "ok" : ""}">${c.match_pct}% 일치</span></h3>
    <p class="muted">XER 안에 저장된 P6 일정(Early Start/Finish, Total Float)과 본 엔진의 재계산 결과를 비교합니다.
      차이는 P6 스케줄 옵션(Retained Logic/Progress Override, 시간 단위 계산, Lag 캘린더 등)이나 P6에서 재계산하지 않고 내보낸 경우 생길 수 있습니다.
      검토 대상 ${c.checked}개 중 ${c.match}개 일치.</p>
    ${!c.checked ? `<p><b>이 XER에는 P6 계산 일정(Early Start/Finish)이 없어 비교할 수 없습니다.</b></p>` : ""}
    ${c.diffs.length ? `<div class="scroll"><table class="t"><thead><tr><th>ID</th><th>액티비티명</th><th>시작(엔진)</th><th>시작(P6)</th><th class="num">Δ</th>
      <th>종료(엔진)</th><th>종료(P6)</th><th class="num">Δ</th><th class="num">TF(엔진)</th><th class="num">TF(P6)</th></tr></thead><tbody>
      ${c.diffs.map((d) => `<tr><td>${esc(d.code)}</td><td class="wrap">${esc(d.name)}</td><td>${d.start}</td><td>${d.p6_start}</td><td class="num">${d.d_start}</td>
      <td>${d.finish}</td><td>${d.p6_finish || ""}</td><td class="num">${d.d_finish}</td><td class="num">${fmtDays(d.tf)}</td><td class="num">${fmtDays(d.p6_tf)}</td></tr>`).join("")}
      </tbody></table></div>` : ""}</div>`;
}

// ---------------------------------------------------------------- S-Curve
function tabScurve(el, r) {
  const sc = r.s_curve;
  el.innerHTML = `<div class="panel"><h3 style="margin-top:0">S-Curve (원공기 가중 누적 공정률)</h3>
    <div class="legend"><span><i style="background:var(--bl)"></i>계획(Target)</span><span><i style="background:var(--bar)"></i>Early</span>
    <span><i style="background:#8b5cf6"></i>Late</span><span><i style="background:var(--ok)"></i>실적 ${sc.actual_pct}%</span></div>
    <canvas id="sc" style="width:100%;height:420px"></canvas></div>`;
  const cv = $("#sc");
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext("2d"); g.scale(dpr, dpr);
  const pad = { l: 46, r: 16, t: 16, b: 34 };
  const ts = sc.dates.map(toT);
  if (!ts.length) return;
  const x0 = ts[0], x1 = ts[ts.length - 1];
  const X = (t) => pad.l + ((t - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const Y = (v) => H - pad.b - (v / 100) * (H - pad.t - pad.b);
  g.font = "11px sans-serif"; g.fillStyle = "#6b7280"; g.strokeStyle = "#e5e7eb";
  for (let v = 0; v <= 100; v += 20) { g.beginPath(); g.moveTo(pad.l, Y(v)); g.lineTo(W - pad.r, Y(v)); g.stroke(); g.fillText(v + "%", 8, Y(v) + 4); }
  const months = monthTicks(x0, x1);
  months.forEach((t, i) => { if (i % Math.ceil(months.length / 12) === 0) g.fillText(new Date(t).toISOString().slice(0, 7), X(t) - 18, H - 12); });
  const line = (arr, color) => {
    g.strokeStyle = color; g.lineWidth = 2; g.beginPath();
    arr.forEach((v, i) => (i ? g.lineTo(X(ts[i]), Y(v)) : g.moveTo(X(ts[i]), Y(v)))); g.stroke();
  };
  if (sc.baseline.some((v) => v > 0)) line(sc.baseline, "#f59e0b");
  line(sc.early, "#3b82f6"); line(sc.late, "#8b5cf6");
  const dd = toT(sc.data_date);
  g.strokeStyle = "#16a34a"; g.setLineDash([4, 4]); g.lineWidth = 1;
  g.beginPath(); g.moveTo(X(dd), pad.t); g.lineTo(X(dd), H - pad.b); g.stroke(); g.setLineDash([]);
  g.fillStyle = "#16a34a"; g.beginPath(); g.arc(X(dd), Y(sc.actual_pct), 5, 0, 7); g.fill();
  g.fillText("Data Date", X(dd) + 4, pad.t + 10);
}

function monthTicks(a, b) {
  const out = []; const d = new Date(a); d.setDate(1);
  while (d.getTime() <= b) { if (d.getTime() >= a) out.push(d.getTime()); d.setMonth(d.getMonth() + 1); }
  return out;
}

// ---------------------------------------------------------------- 간트차트
function tabGantt(el, r) {
  const uid = el.dataset.uid;
  const COLS = [["od", "원공기"], ["rd", "잔여"], ["st", "시작"], ["fn", "종료"], ["tf", "TF"]];
  const hidden = new Set(JSON.parse(store.get("gcols", "[]")));
  el.innerHTML = `
    <div class="row toolbar" style="margin-bottom:6px">
      <select class="s" id="gView" aria-label="저장된 보기"><option value="">보기: 기본</option></select>
      <button class="btn sm" id="gSaveView" data-need="editor" title="현재 필터·배율을 팀 공유 보기로 저장">보기 저장</button>
      <label class="muted">베이스라인 <select class="s sm" id="gBl"><option value="target">P6 계획(Target)</option></select></label>
      <label><input type="checkbox" id="fLines"> 최장경로 관계선</label>
      <details class="cols"><summary class="btn sm">열 선택</summary><div class="menu">${COLS.map(([k, l]) => `<label><input type="checkbox" data-col="${k}" ${hidden.has(k) ? "" : "checked"}> ${l}</label>`).join("")}</div></details>
      <span class="muted" style="font-size:12px">드래그: 이동 · Ctrl+휠: 확대 · ↑↓ Enter: 선택·상세</span>
    </div>
    <div class="row" style="margin-bottom:10px">
      <input class="s" id="q" type="search" placeholder="ID / 이름 검색 ( / )" style="width:220px">
      <label><input type="checkbox" id="fCrit"> 주공정/최장경로만</label>
      ${highlight.size ? `<label><input type="checkbox" id="fHl" checked> AI 답변 작업만 (${highlight.size})</label>` : ""}
      <label><input type="checkbox" id="fInc" checked> 완료 제외</label>
      <label><input type="checkbox" id="fBl" checked> 계획(Target) 표시</label>
      <label class="muted">배율 <select class="s" id="zoom"><option value="3">일</option><option value="1.2" selected>주</option><option value="0.35">월</option><option value="0.12">분기</option></select></label>
      <span class="spacer"></span><a class="btn sm" href="#/print/${el.dataset.uid}">A3 인쇄</a>
      <div class="legend"><span><i style="background:var(--bar)"></i>일반</span><span><i style="background:var(--crit)"></i>주공정</span>
      <span><i style="background:var(--done)"></i>완료</span><span><i style="background:var(--bl);height:4px"></i>계획</span>
      <span><i style="background:#16a34a;width:2px"></i>Data Date</span></div>
    </div>
    <div class="gantt ${[...hidden].map((k) => "hide-" + k).join(" ")}" style="grid-template-columns:${+store.get("gsplit", "640")}px 6px 1fr">
      <div class="g-left"><div class="g-row hdr"><div>ID</div><div>액티비티명</div><div class="c-od">원공기</div><div class="c-rd">잔여</div><div class="c-st">시작</div><div class="c-fn">종료</div><div class="c-tf">TF</div></div>
        <div class="g-body" id="gl"><div class="g-rows" id="glr"></div></div></div>
      <div class="g-split" id="gSplit" role="separator" aria-label="표 너비 조절" tabindex="0"></div>
      <div class="g-right"><canvas class="g-head" id="gh"></canvas><div class="g-body" id="gr" tabindex="0" aria-label="간트 차트. 위아래 화살표로 작업 선택, Enter로 상세"><div id="grs"></div><canvas id="gc" style="position:sticky;top:0;left:0"></canvas></div></div>
    </div>
    <div class="panel detail" id="det"><span class="muted">행을 클릭하면 선·후행 관계를 볼 수 있습니다. 더블클릭하면 상세 패널이 열립니다.</span></div>`;
  let blMap = null; // 저장된 베이스라인 사용 시 code -> {start, finish}
  api(`/api/uploads/${uid}/baselines`).then((bls) => { $("#gBl").insertAdjacentHTML("beforeend", bls.map((b) => `<option value="${b.upload_id}">${esc(b.label)} (DD ${b.data_date})</option>`).join("")); }).catch(() => {});
  $("#gBl").onchange = async (e) => {
    if (e.target.value === "target") blMap = null;
    else { const b = await load(e.target.value); blMap = Object.fromEntries(b.result.activities.map((a) => [a.code, { s: a.start, f: a.finish }])); }
    $("#fBl").checked = true; render();
  };
  el.querySelectorAll("[data-col]").forEach((c) => (c.onchange = () => {
    c.checked ? hidden.delete(c.dataset.col) : hidden.add(c.dataset.col);
    store.set("gcols", JSON.stringify([...hidden]));
    COLS.forEach(([k]) => el.querySelector(".gantt").classList.toggle("hide-" + k, hidden.has(k)));
  }));
  // 저장된 보기
  const views = [];
  const loadViews = async () => {
    views.splice(0, views.length, ...(await api(`/api/uploads/${uid}/views`).catch(() => [])));
    $("#gView").innerHTML = `<option value="">보기: 기본</option>` + views.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join("");
  };
  loadViews();
  $("#gView").onchange = (e) => {
    const v = views.find((x) => x.id === e.target.value); if (!v) return;
    const c = v.config; $("#q").value = c.q || ""; $("#fCrit").checked = !!c.crit; $("#fInc").checked = c.inc !== false;
    $("#fLines").checked = !!c.lines; $("#zoom").value = c.zoom || "1.2"; ppd = +$("#zoom").value; build();
  };
  $("#gSaveView").onclick = async () => {
    const v = await ui.form("보기 저장", [{ name: "name", label: "보기 이름", required: true, placeholder: "예: 골조 주공정" }], { intro: "현재 검색어·필터·배율을 팀이 함께 쓰는 보기로 저장합니다." });
    if (!v) return;
    await api(`/api/uploads/${uid}/views`, { method: "POST", json: { name: v.name, config: { q: $("#q").value, crit: $("#fCrit").checked, inc: $("#fInc").checked, lines: $("#fLines").checked, zoom: $("#zoom").value } } });
    toast("보기를 저장했습니다"); loadViews();
  };

  const byId = Object.fromEntries(r.activities.map((a) => [a.id, a]));
  const RH = 26;
  let rows = [];
  let sel = null;
  let ppd = 1.2; // pixels per day
  let t0, t1;

  function build() {
    const q = $("#q").value.trim().toLowerCase();
    const fc = $("#fCrit").checked, fi = $("#fInc").checked, fh = $("#fHl")?.checked;
    const acts = r.activities.filter((a) =>
      (!q || a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)) &&
      (!fc || a.critical || a.longest) && (!fh || highlight.has(a.code)) && (!fi || !!fh || a.status_code !== "TK_Complete"));
    rows = []; let last = null;
    for (const a of acts) {
      if (a.wbs !== last) { rows.push({ wbs: a.wbs || "(WBS 없음)" }); last = a.wbs; }
      rows.push(a);
    }
    const all = r.activities.flatMap((a) => [a.start, a.finish, a.late_finish, a.bl_start, a.bl_finish]).filter(Boolean).map(toT);
    t0 = Math.min(...all) - 7 * dayMs; t1 = Math.max(...all) + 21 * dayMs;
    $("#glr").style.height = $("#grs").style.height = rows.length * RH + "px";
    $("#grs").style.width = ((t1 - t0) / dayMs) * ppd + "px";
    render();
  }

  const gl = $("#gl"), gr = $("#gr"), gc = $("#gc"), gh = $("#gh");
  gr.addEventListener("scroll", () => { gl.scrollTop = gr.scrollTop; render(); });
  gl.addEventListener("wheel", (e) => { gr.scrollTop += e.deltaY; e.preventDefault(); }, { passive: false });

  function render() {
    if (!gc.isConnected) { window.removeEventListener("resize", render); return; }
    const H = gr.clientHeight, W = gr.clientWidth;
    const first = Math.max(0, Math.floor(gr.scrollTop / RH) - 2);
    const last = Math.min(rows.length, first + Math.ceil(H / RH) + 4);
    // 왼쪽 표
    $("#glr").innerHTML = rows.slice(first, last).map((a, k) => {
      const top = (first + k) * RH;
      if (a.wbs !== undefined && !a.id) return `<div class="g-row wbs" style="top:${top}px"><div>${esc(a.wbs)}</div></div>`;
      const cls = `${a.critical || a.longest ? "crit" : ""} ${sel === a.id ? "sel" : ""}`;
      return `<div class="g-row ${cls}" data-id="${a.id}" style="top:${top}px"><div>${a.longest ? "▲ " : ""}${esc(a.code)}</div><div class="nm" title="${esc(a.name)}">${esc(a.name)}</div>
        <div class="num c-od">${a.orig_dur}</div><div class="num c-rd">${a.rem_dur}</div><div class="c-st">${a.start}</div><div class="c-fn">${a.finish}</div><div class="num c-tf">${fmtDays(a.tf)}</div></div>`;
    }).join("");
    // 캔버스
    const dpr = window.devicePixelRatio || 1;
    gc.width = W * dpr; gc.height = H * dpr; gc.style.width = W + "px"; gc.style.height = H + "px";
    gc.style.marginTop = -rows.length * RH + "px";
    gh.width = W * dpr; gh.height = 44 * dpr; gh.style.width = W + "px"; gh.style.height = "44px";
    const g = gc.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const h = gh.getContext("2d"); h.setTransform(dpr, 0, 0, dpr, 0, 0); h.fillStyle = cssv("--head"); h.fillRect(0, 0, W, 44);
    const sx = gr.scrollLeft, sy = gr.scrollTop;
    const X = (t) => ((t - t0) / dayMs) * ppd - sx;
    // 눈금
    h.font = "11px sans-serif"; h.fillStyle = cssv("--text"); g.strokeStyle = cssv("--line");
    const months = monthTicks(t0, t1);
    months.forEach((t) => {
      const x = X(t); if (x < -200 || x > W + 10) return;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
      h.strokeStyle = "#e3e6eb"; h.beginPath(); h.moveTo(x, 22); h.lineTo(x, 44); h.stroke();
      const d = new Date(t);
      if (ppd >= 0.3 || d.getMonth() % 3 === 0) h.fillText(ppd >= 0.3 ? `${d.getMonth() + 1}월` : `${d.getFullYear()}.${d.getMonth() + 1}`, x + 3, 38);
      if (d.getMonth() === 0 || t === months[0]) h.fillText(`${d.getFullYear()}년`, x + 3, 15);
    });
    if (ppd >= 2) {
      for (let t = t0; t < t1; t += dayMs) {
        const d = new Date(t); if (d.getDay() !== 1) continue;
        const x = X(t); if (x < 0 || x > W) continue;
        h.fillStyle = "#9ca3af"; h.fillText(d.getDate(), x + 2, 28); h.fillStyle = "#374151";
      }
    }
    // 행 배경 (WBS)
    for (let i = first; i < last; i++) {
      const a = rows[i]; const y = i * RH - sy;
      if (!a.id) { g.fillStyle = cssv("--soft"); g.fillRect(0, y, W, RH); continue; }
      if (sel === a.id) { g.fillStyle = cssv("--sel"); g.fillRect(0, y, W, RH); }
      const blS = blMap ? blMap[a.code]?.s : a.bl_start, blF = blMap ? blMap[a.code]?.f : a.bl_finish;
      const bl = $("#fBl").checked && blS && blF;
      const s = toT(a.start), f = toT(a.finish) + dayMs;
      const color = a.status_code === "TK_Complete" ? "#9ca3af" : a.critical || a.longest ? "#dc2626" : "#3b82f6";
      const by = y + (bl ? 5 : 7), bh = bl ? 10 : 12;
      if (a.milestone) {
        const x = X(a.milestone && a.type === "TT_FinMile" ? f : s);
        g.fillStyle = color; g.beginPath(); g.moveTo(x, by - 1); g.lineTo(x + 6, by + bh / 2); g.lineTo(x, by + bh + 1); g.lineTo(x - 6, by + bh / 2); g.fill();
      } else {
        const x = X(s), w = Math.max(2, X(f) - x);
        g.fillStyle = color; g.fillRect(x, by, w, bh);
        if (a.status_code === "TK_Active" && a.pct > 0) { g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(x, by + bh - 3, w * Math.min(a.pct, 100) / 100, 3); }
        if (a.tf > 0 && a.status_code !== "TK_Complete") {
          const lf = X(toT(a.late_finish) + dayMs); g.strokeStyle = "#9ca3af"; g.beginPath(); g.moveTo(x + w, by + bh / 2); g.lineTo(lf, by + bh / 2); g.stroke();
        }
      }
      if (bl) { g.fillStyle = "#f59e0b"; const x = X(toT(blS)); g.fillRect(x, y + 18, Math.max(2, X(toT(blF) + dayMs) - x), 4); }
      if (ppd >= 1) { g.fillStyle = cssv("--text"); g.font = "11px sans-serif"; g.fillText(a.name, X(f) + 8, y + 17); }
    }
    // 관계선 (선택 작업, 또는 최장경로 전체)
    const idx = Object.fromEntries(rows.map((a, i) => [a.id, i]));
    if ($("#fLines")?.checked) {
      for (const a of rows) {
        if (!a.id || !a.longest) continue;
        for (const p of a.preds) { const pa = byId[p.id]; if (pa?.longest) drawRel(pa, a, p.type, "#b91c1c"); }
      }
    }
    function drawRel(p, s, type, color = "#111827") {
        if (idx[p.id] === undefined || idx[s.id] === undefined) return;
        const x1 = X(toT(type[0] === "S" ? p.start : p.finish) + (type[0] === "S" ? 0 : dayMs));
        const x2 = X(toT(type[1] === "S" ? s.start : s.finish) + (type[1] === "S" ? 0 : dayMs));
        const y1 = idx[p.id] * RH - sy + 13, y2 = idx[s.id] * RH - sy + 13;
        g.strokeStyle = color; g.lineWidth = 1; g.beginPath(); g.moveTo(x1, y1);
        g.lineTo(x1 + 5, y1); g.lineTo(x1 + 5, y2); g.lineTo(x2, y2); g.stroke();
        g.beginPath(); g.moveTo(x2, y2); g.lineTo(x2 - 4, y2 - 3); g.lineTo(x2 - 4, y2 + 3); g.fillStyle = color; g.fill();
    }
    if (sel) {
      const a = byId[sel];
      const draw = (p, s, type) => {
        if (idx[p.id] === undefined || idx[s.id] === undefined) return;
        const x1 = X(toT(type[0] === "S" ? p.start : p.finish) + (type[0] === "S" ? 0 : dayMs));
        const x2 = X(toT(type[1] === "S" ? s.start : s.finish) + (type[1] === "S" ? 0 : dayMs));
        const y1 = idx[p.id] * RH - sy + 13, y2 = idx[s.id] * RH - sy + 13;
        g.strokeStyle = "#111827"; g.lineWidth = 1; g.beginPath(); g.moveTo(x1, y1);
        g.lineTo(x1 + 5, y1); g.lineTo(x1 + 5, y2); g.lineTo(x2, y2); g.stroke();
        g.beginPath(); g.moveTo(x2, y2); g.lineTo(x2 - 4, y2 - 3); g.lineTo(x2 - 4, y2 + 3); g.fillStyle = "#111827"; g.fill();
      };
      a.preds.forEach((p) => draw(byId[p.id], a, p.type));
      a.succs.forEach((s) => draw(a, byId[s.id], s.type));
    }
    // Data date
    const xd = X(toT(r.data_date)); g.strokeStyle = "#16a34a"; g.lineWidth = 1.5; g.setLineDash([5, 4]);
    g.beginPath(); g.moveTo(xd, 0); g.lineTo(xd, H); g.stroke(); g.setLineDash([]); g.lineWidth = 1;
  }

  $("#glr").addEventListener("click", (e) => {
    const row = e.target.closest("[data-id]"); if (!row) return;
    sel = row.dataset.id; render(); detail(byId[sel]);
  });
  gc.addEventListener("click", (e) => {
    if (gc._suppress) { gc._suppress = false; return; }
    const i = Math.floor((e.offsetY + gr.scrollTop) / RH);
    if (rows[i]?.id) { sel = rows[i].id; render(); detail(byId[sel]); }
  });

  function detail(a) {
    const rel = (list, dir) => list.map((x) => {
      const o = byId[x.id];
      return `<tr><td>${dir}</td><td><a href="#" data-go="${o.id}">${esc(o.code)}</a></td><td class="wrap">${esc(o.name)}</td><td>${x.type}</td>
        <td class="num">${x.lag}</td><td>${o.start}</td><td>${o.finish}</td><td class="num">${fmtDays(o.tf)}</td></tr>`;
    }).join("");
    $("#det").innerHTML = `<h3 style="margin-top:0">${esc(a.code)} · ${esc(a.name)} ${statusTag(a)}</h3>
      <div class="muted">WBS: ${esc(a.wbs)} · 캘린더: ${esc(a.calendar)} · 공정률 ${a.pct}% ·
        Late ${a.late_start} ~ ${a.late_finish} · 계획 ${a.bl_start || "-"} ~ ${a.bl_finish || "-"}
        ${a.constraint ? ` · 제약: ${esc(a.constraint)} ${a.constraint_date}` : ""}${a.has_resource ? "" : " · 자원 미배정"}</div>
      <table class="t" style="margin-top:8px"><thead><tr><th></th><th>ID</th><th>액티비티명</th><th>관계</th><th class="num">Lag</th><th>시작</th><th>종료</th><th class="num">TF</th></tr></thead>
      <tbody>${rel(a.preds, "선행")}${rel(a.succs, "후행")}</tbody></table>`;
    $("#det").querySelectorAll("[data-go]").forEach((l) => (l.onclick = (e) => {
      e.preventDefault(); sel = l.dataset.go;
      const i = rows.findIndex((x) => x.id === sel);
      if (i >= 0) gr.scrollTop = i * RH - 100;
      render(); detail(byId[sel]);
    }));
  }

  ["q", "fCrit", "fInc", "fHl"].forEach((id) => $("#" + id)?.addEventListener("input", build));
  $("#fLines").addEventListener("input", render);
  // 더블클릭 → 상세 서랍
  $("#glr").addEventListener("dblclick", (e) => { const row = e.target.closest("[data-id]"); if (row) openActivity(byId[row.dataset.id].code); });
  gc.addEventListener("dblclick", (e) => { const i = Math.floor((e.offsetY + gr.scrollTop) / RH); if (rows[i]?.id) openActivity(rows[i].code); });
  // 드래그 이동 + Ctrl/⌘ 휠 확대
  let drag = null;
  gc.addEventListener("mousedown", (e) => { drag = { x: e.clientX, y: e.clientY, sl: gr.scrollLeft, st: gr.scrollTop, moved: false }; });
  window.addEventListener("mousemove", (e) => {
    if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; gc.style.cursor = "grabbing"; }
    gr.scrollLeft = drag.sl - dx; gr.scrollTop = drag.st - dy;
  });
  window.addEventListener("mouseup", () => { if (drag?.moved) gc._suppress = true; drag = null; gc.style.cursor = ""; });
  gr.addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const rect = gr.getBoundingClientRect(), mx = e.clientX - rect.left, day = (gr.scrollLeft + mx) / ppd;
    ppd = Math.min(8, Math.max(0.08, ppd * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
    build(); gr.scrollLeft = day * ppd - mx;
  }, { passive: false });
  // 키보드 탐색
  gr.addEventListener("keydown", (e) => {
    const acts = rows.filter((x) => x.id); if (!acts.length) return;
    let i = acts.findIndex((x) => x.id === sel);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); i = Math.max(0, Math.min(acts.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
      sel = acts[i].id; const ri = rows.indexOf(acts[i]);
      if (ri * RH < gr.scrollTop || ri * RH > gr.scrollTop + gr.clientHeight - RH * 2) gr.scrollTop = ri * RH - 100;
      render(); detail(byId[sel]);
    } else if (e.key === "Enter" && sel) { openActivity(byId[sel].code); }
  });
  // 표/차트 너비 조절
  const split = $("#gSplit");
  split.addEventListener("mousedown", (e) => {
    e.preventDefault(); const g0 = el.querySelector(".gantt"), x0 = e.clientX, w0 = +store.get("gsplit", "640");
    const mv = (ev) => { const w = Math.max(240, Math.min(1000, w0 + ev.clientX - x0)); g0.style.gridTemplateColumns = `${w}px 6px 1fr`; store.set("gsplit", String(w)); render(); };
    const up = () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up);
  });
  split.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const w = Math.max(240, Math.min(1000, +store.get("gsplit", "640") + (e.key === "ArrowRight" ? 20 : -20)));
    store.set("gsplit", String(w)); el.querySelector(".gantt").style.gridTemplateColumns = `${w}px 6px 1fr`; render();
  });
  $("#fBl").addEventListener("input", render);
  $("#zoom").addEventListener("input", (e) => {
    const center = (gr.scrollLeft + gr.clientWidth / 2) / ppd;
    ppd = +e.target.value; build(); gr.scrollLeft = center * ppd - gr.clientWidth / 2;
  });
  window.addEventListener("resize", render);
  build();
  gr.scrollLeft = Math.max(0, ((toT(r.data_date) - t0) / dayMs) * ppd - 150);
}

// ---------------------------------------------------------------- 업데이트 비교
async function showCompare(a, b) {
  $("#crumb").textContent = "/ 업데이트 비교";
  const c = await api(`/api/compare?base=${a}&target=${b}`);
  const sl = c.finish_slip;
  view.innerHTML = `
    <h2 style="margin:0 0 12px">업데이트 비교</h2>
    <div class="kpis">
      ${kpi("기준", `<span style="font-size:16px">${esc(c.base.name)}</span><div class="muted" style="font-size:12px">DD ${c.base.data_date} · 준공 ${c.base.finish}</div>`)}
      ${kpi("비교 대상", `<span style="font-size:16px">${esc(c.target.name)}</span><div class="muted" style="font-size:12px">DD ${c.target.data_date} · 준공 ${c.target.finish}</div>`)}
      ${kpi("준공일 변동", (sl > 0 ? "+" : "") + sl + "일", sl > 0 ? "crit" : "")}
      ${kpi("추가 / 삭제 / 변경", `${c.added.length} / ${c.removed.length} / ${c.changed.length}`)}
    </div>
    <div class="panel"><h3 style="margin-top:0">일정 변경 액티비티 (종료일 변동 큰 순)</h3>
      <div class="scroll"><table class="t"><thead><tr><th>ID</th><th>액티비티명</th><th>상태</th><th>종료(기준)</th><th>종료(비교)</th>
      <th class="num">Δ종료</th><th class="num">TF 기준→비교</th><th class="num">Δ원공기</th></tr></thead><tbody>
      ${c.changed.map((x) => `<tr><td>${esc(x.code)}</td><td class="wrap">${esc(x.name)}${x.critical ? ' <span class="tag crit">주공정</span>' : ""}</td>
        <td>${x.status_before}→${x.status_after}</td><td>${x.finish_before}</td><td>${x.finish_after}</td>
        <td class="num" style="color:${x.d_finish > 0 ? "var(--crit)" : x.d_finish < 0 ? "var(--ok)" : ""}">${x.d_finish > 0 ? "+" : ""}${x.d_finish}</td>
        <td class="num">${fmtDays(x.tf_before)} → ${fmtDays(x.tf_after)}</td><td class="num">${x.d_dur || ""}</td></tr>`).join("")}
      </tbody></table></div></div>
    <div class="panel"><h3 style="margin-top:0">추가된 액티비티 (${c.added.length})</h3>${simpleList(c.added)}</div>
    <div class="panel"><h3 style="margin-top:0">삭제된 액티비티 (${c.removed.length})</h3>${simpleList(c.removed)}</div>`;
}

function simpleList(xs) {
  if (!xs.length) return `<p class="muted">없음</p>`;
  return `<table class="t"><thead><tr><th>ID</th><th>액티비티명</th><th>시작</th><th>종료</th></tr></thead><tbody>
    ${xs.map((x) => `<tr><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td>${x.start}</td><td>${x.finish}</td></tr>`).join("")}</tbody></table>`;
}

document.addEventListener("DOMContentLoaded", route);

// ================================================================ AI·의사결정 기능
const highlight = new Set();

async function withBusy(btn, fn) {
  const t = btn.textContent; btn.disabled = true; btn.textContent = "처리 중...";
  try { return await fn(); } catch (e) { toast(e.message); throw e; } finally { btn.disabled = false; btn.textContent = t; }
}

// 안전한 최소 마크다운 렌더러 (표, 목록, 굵게, 코드, 제목)
function md(src) {
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
  const lines = String(src || "").split("\n"); let out = ""; let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const cells = (x) => x.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      out += `<div class="scroll" style="max-height:none"><table class="t"><thead><tr>${cells(l).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>`;
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { out += `<tr>${cells(lines[i]).map((c) => `<td class="wrap">${inline(c)}</td>`).join("")}</tr>`; i++; }
      out += "</tbody></table></div>"; continue;
    }
    if (/^\s*[-*] /.test(l)) { out += "<ul>"; while (i < lines.length && /^\s*[-*] /.test(lines[i])) { out += `<li>${inline(lines[i].replace(/^\s*[-*] /, ""))}</li>`; i++; } out += "</ul>"; continue; }
    if (/^\s*\d+\. /.test(l)) { out += "<ol>"; while (i < lines.length && /^\s*\d+\. /.test(lines[i])) { out += `<li>${inline(lines[i].replace(/^\s*\d+\. /, ""))}</li>`; i++; } out += "</ol>"; continue; }
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) { out += `<h4>${inline(h[2])}</h4>`; i++; continue; }
    if (l.trim()) out += `<p>${inline(l)}</p>`;
    i++;
  }
  return out;
}

function aiOffNote(st) {
  return st.enabled ? "" : `<div class="panel warn">AI가 설정되지 않아 규칙 기반 결과만 표시합니다. 서버에 <code>ANTHROPIC_API_KEY</code>(또는 <code>AI_PROVIDER=bedrock</code>)를 설정하면 AI 기능이 켜집니다.</div>`;
}

// ---------------------------------------------------------------- ① AI 어시스턴트
const EXAMPLES = ["다음 달에 착수해야 하는 주공정 작업은?", "계획보다 늦어지고 있는 작업을 공종별로 정리해줘",
  "지난 업데이트 대비 준공이 왜 늦어졌어?", "기계설비 배관을 10일 단축하면 준공일이 얼마나 당겨져?",
  "목표 준공일을 지킬 확률은?", "DCMA 미달 항목 중 가장 먼저 고칠 것은?"];

async function tabChat(el, r, uid) {
  const st = await getAiStatus();
  const key = "chat:" + uid;
  let hist = []; try { hist = JSON.parse(sessionStorage.getItem(key) || "[]"); } catch {}
  el.innerHTML = `${st.enabled ? "" : `<div class="panel warn">AI가 설정되지 않았습니다. 서버 환경변수 <code>ANTHROPIC_API_KEY</code>를 설정하세요.</div>`}
    <div class="chat panel">
      <div id="msgs" class="msgs"></div>
      <div class="examples">${EXAMPLES.map((q) => `<button class="btn sm ex">${esc(q)}</button>`).join("")}</div>
      <form id="chatForm" class="row"><textarea id="chatIn" rows="2" placeholder="공정에 대해 물어보세요 (Enter 전송, Shift+Enter 줄바꿈)"></textarea>
        <button class="btn primary" id="chatSend">질문</button><button class="btn" type="button" id="chatClear">새 대화</button></form>
      <p class="muted" style="font-size:12px;margin:6px 0 0">답변의 날짜·일수는 CPM 엔진 계산값입니다. AI는 데이터를 조회해 정리하며, What-if는 원본을 바꾸지 않습니다. 모델: ${esc(st.model)}</p>
    </div>`;
  const box = $("#msgs");
  const render = () => {
    box.innerHTML = hist.map((m, i) => m.role === "user" ? `<div class="msg user">${esc(m.content)}</div>`
      : `<div class="msg bot">${md(m.content)}${m.codes?.length ? `<div class="row" style="margin-top:6px">
          <button class="btn sm" data-hl="${i}">공정표에서 보기 (${m.codes.length})</button>
          <span class="muted" style="font-size:12px">${m.trace?.map((t) => t.tool).join(" → ") || ""}</span></div>` : ""}</div>`).join("")
      || `<div class="muted">예시 질문을 누르거나 직접 질문해 보세요.</div>`;
    box.scrollTop = box.scrollHeight;
    box.querySelectorAll("[data-hl]").forEach((b) => (b.onclick = () => {
      highlight.clear(); hist[b.dataset.hl].codes.forEach((c) => highlight.add(c)); location.hash = `#/p/${uid}/gantt`;
    }));
  };
  const send = async (q) => {
    if (!q.trim()) return;
    hist.push({ role: "user", content: q }); render();
    box.insertAdjacentHTML("beforeend", `<div class="msg bot muted" id="thinking">데이터를 조회하며 답변을 작성 중입니다...</div>`);
    box.scrollTop = box.scrollHeight;
    try {
      const res = await api(`/api/uploads/${uid}/chat`, { method: "POST", json: { messages: hist.map(({ role, content }) => ({ role, content })) } });
      hist.push({ role: "assistant", content: res.answer, codes: res.codes, trace: res.trace });
    } catch (e) {
      hist.push({ role: "assistant", content: "⚠ " + e.message });
    }
    try { sessionStorage.setItem(key, JSON.stringify(hist.slice(-30))); } catch {}
    render();
  };
  const pending = sessionStorage.getItem("chatPrefill"); sessionStorage.removeItem("chatPrefill");
  $("#chatForm").onsubmit = (e) => { e.preventDefault(); const v = $("#chatIn").value; $("#chatIn").value = ""; send(v); };
  $("#chatIn").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#chatForm").requestSubmit(); } };
  $("#chatClear").onclick = () => { hist = []; sessionStorage.removeItem(key); render(); };
  el.querySelectorAll(".ex").forEach((b) => (b.onclick = () => send(b.textContent)));
  render();
  if (pending) send(pending);
}

function askAi(uid, q) { try { sessionStorage.setItem("chatPrefill", q); } catch {} location.hash = `#/p/${uid}/chat`; }

// ---------------------------------------------------------------- ② 월간 보고서
const REPORT_SECTIONS = [["headline", "핵심 메시지"], ["summary", "요약"], ["progress", "공정 현황"], ["delay_causes", "지연 원인"],
  ["critical_path", "주공정"], ["next_month", "향후 1개월 주요 작업"], ["risks_actions", "리스크 및 대책"], ["requests", "요청 사항"]];

async function tabReport(el, r, uid) {
  const st = await getAiStatus();
  const draw = (rep) => {
    $("#repBody").innerHTML = !rep.sections ? `<div class="muted">아직 생성된 보고서가 없습니다.</div>` : `
      <p class="muted">작성 방식: ${rep.method} · Data Date ${rep.data.data_date}. 각 항목을 직접 수정한 뒤 저장할 수 있습니다.</p>
      ${REPORT_SECTIONS.map(([k, l]) => `<label class="sec"><b>${l}</b><textarea data-k="${k}" rows="${k === "headline" ? 1 : 5}">${esc(rep.sections[k])}</textarea></label>`).join("")}
      <div class="row end"><button class="btn" id="repSave">수정 저장</button><button class="btn primary" id="repDocx">Word 다운로드</button></div>`;
    if (!rep.sections) return;
    $("#repSave").onclick = () => withBusy($("#repSave"), async () => {
      const sections = {}; el.querySelectorAll("textarea[data-k]").forEach((t) => (sections[t.dataset.k] = t.value));
      await api(`/api/uploads/${uid}/report`, { method: "PUT", json: { sections } }); toast("저장했습니다");
    });
    $("#repDocx").onclick = () => download(`/api/uploads/${uid}/report.docx`, "report.docx");
  };
  el.innerHTML = `${aiOffNote(st)}<div class="panel"><div class="row" style="justify-content:space-between">
    <h3 style="margin:0">월간 공정보고서</h3>
    <div class="row"><label><input type="checkbox" id="repAi" ${st.enabled ? "checked" : "disabled"}> AI 초안 작성</label>
    <button class="btn primary" id="repGen" data-need="editor">보고서 생성</button></div></div>
    <p class="muted">업데이트 비교(지연 원인), 주공정, 향후 1개월 작업, 리스크를 모아 보고서 초안을 만듭니다. 이전 업데이트는 같은 프로젝트 이름으로 자동 선택됩니다.</p>
    <div id="repBody"></div></div>`;
  draw(await api(`/api/uploads/${uid}/report`));
  $("#repGen").onclick = async () => { const ai_ = $("#repAi").checked; const x = await runLong(ai_ ? "AI가 보고서 초안을 작성하는 중" : "보고서 생성 중", "report" + ai_, (signal) => api(`/api/uploads/${uid}/report?ai=${ai_ ? 1 : 0}`, { method: "POST", signal })); if (x) draw(x); };
}

// ---------------------------------------------------------------- ④ 지연 원인
async function tabDelay(el, r, uid) {
  const list = (await api("/api/uploads")).filter((u) => u.name === r.name && u.id !== uid && u.data_date < r.data_date);
  el.innerHTML = `<div class="panel"><div class="row">
      <b>비교 기준 업데이트</b><select class="s" id="dBase">${list.map((u) => `<option value="${u.id}">${u.data_date} · ${esc(u.note || u.filename)}</option>`).join("") || "<option value=''>없음</option>"}</select>
      <button class="btn" id="dAsk">✦ AI에게 원인 설명 요청</button></div>
      <p class="muted">이번 업데이트의 최장 경로를 따라가며 각 작업이 <b>새로 만든 지연</b>(선행에서 넘겨받은 지연 제외)을 계산합니다. 준공 지연의 원인 작업을 찾는 데 씁니다.</p></div>
    <div id="dBody"></div>`;
  const draw = async () => {
    const d = await api(`/api/uploads/${uid}/delay${$("#dBase").value ? "?base=" + $("#dBase").value : ""}`);
    if (!d.available) { $("#dBody").innerHTML = `<div class="panel empty">${esc(d.message)}</div>`; return; }
    $("#dBody").innerHTML = `<div class="kpis">
      ${kpi("기준 → 비교 Data Date", `<span style="font-size:16px">${d.base_data_date} → ${d.target_data_date}</span>`)}
      ${kpi("예상 준공", `<span style="font-size:16px">${d.base_finish} → ${d.target_finish}</span>`)}
      ${kpi("준공 지연", (d.finish_slip > 0 ? "+" : "") + d.finish_slip + "일", d.finish_slip > 0 ? "crit" : "")}
      ${kpi("주공정 변경 작업", d.path_changed.length)}</div>
      <div class="panel"><h3 style="margin-top:0">지연 기여 작업 (큰 순)</h3>
      <table class="t"><thead><tr><th>ID</th><th>작업</th><th class="num">종료 순연</th><th class="num">선행에서 전달</th><th class="num">새로 발생</th><th>추정 원인</th></tr></thead><tbody>
      ${d.top.map((x) => `<tr><td>${esc(x.code)}</td><td class="wrap">${esc(x.name)}</td><td class="num">${x.slip}</td><td class="num">${x.inherited ?? "-"}</td>
        <td class="num" style="color:${x.introduced > 0 ? "var(--crit)" : "var(--ok)"}">${x.introduced > 0 ? "+" : ""}${x.introduced}</td><td class="wrap">${esc(x.note)}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">기여 작업 없음</td></tr>`}
      </tbody></table></div>
      <div class="panel"><h3 style="margin-top:0">최장 경로 추적</h3>${pathTable(d.path)}</div>`;
  };
  const pathTable = (rows) => `<div class="scroll"><table class="t"><thead><tr><th>ID</th><th>작업</th><th class="num">종료 순연</th><th class="num">새로 발생</th><th>비고</th></tr></thead><tbody>
    ${rows.map((x) => `<tr><td>${esc(x.code)}</td><td class="wrap">${esc(x.name)}</td><td class="num">${x.slip ?? "-"}</td><td class="num">${x.introduced ?? "-"}</td><td class="wrap">${esc(x.note)}</td></tr>`).join("")}</tbody></table></div>`;
  $("#dBase").onchange = draw;
  $("#dAsk").onclick = () => askAi(uid, "직전 업데이트 대비 준공이 늦어진 원인을 지연 기여도 기준으로 설명하고, 만회 대책을 제안해줘.");
  draw();
}

// ---------------------------------------------------------------- ⑤ What-if
const OPS = { set_duration: "공기 변경", add_rel: "관계 추가", remove_rel: "관계 삭제", set_lag: "Lag 변경", set_progress: "진도 입력" };

function changeForm(ch, i) {
  const f = (k, ph, w = 90) => `<input class="s" data-i="${i}" data-k="${k}" value="${esc(ch[k] ?? "")}" placeholder="${ph}" style="width:${w}px">`;
  const fields = {
    set_duration: f("code", "Activity ID") + f("days", "잔여공기(일)", 100),
    add_rel: f("pred", "선행 ID") + f("succ", "후행 ID") + `<select class="s" data-i="${i}" data-k="type">${["FS", "SS", "FF", "SF"].map((t) => `<option ${ch.type === t ? "selected" : ""}>${t}</option>`).join("")}</select>` + f("lag", "Lag(일)", 70),
    remove_rel: f("pred", "선행 ID") + f("succ", "후행 ID"),
    set_lag: f("pred", "선행 ID") + f("succ", "후행 ID") + f("lag", "Lag(일)", 70),
    set_progress: f("code", "Activity ID") + f("act_start", "실착수 YYYY-MM-DD", 150) + f("act_end", "실완료", 110) + f("pct", "공정률%", 80),
  }[ch.op];
  return `<div class="row chg"><select class="s" data-i="${i}" data-k="op">${Object.entries(OPS).map(([k, l]) => `<option value="${k}" ${ch.op === k ? "selected" : ""}>${l}</option>`).join("")}</select>${fields}
    <button class="btn sm danger" data-rm="${i}">✕</button></div>`;
}

function whatifResult(w) {
  return `<div class="kpis">${kpi("준공 (현재 → 변경)", `<span style="font-size:16px">${w.finish_before} → ${w.finish_after}</span>`)}
    ${kpi("준공 변화", (w.d_finish > 0 ? "+" : "") + w.d_finish + "일", w.d_finish > 0 ? "crit" : "")}
    ${kpi("DCMA 통과", `${w.dcma_pass_before} → ${w.dcma_pass_after}`)}
    ${kpi("주공정 작업 수", `${w.longest_before.length} → ${w.longest_after.length}`)}</div>
    <p class="muted">적용: ${w.log.map(esc).join(" · ")}</p>
    <div class="scroll"><table class="t"><thead><tr><th>ID</th><th>작업</th><th>종료 (현재→변경)</th><th class="num">Δ</th><th class="num">TF</th></tr></thead><tbody>
    ${w.changed.slice(0, 100).map((x) => `<tr><td>${esc(x.code)}</td><td class="wrap">${esc(x.name)}${x.longest ? ' <span class="tag crit">주공정</span>' : ""}</td>
      <td>${x.finish_before} → ${x.finish_after}</td><td class="num">${x.d_finish > 0 ? "+" : ""}${x.d_finish}</td><td class="num">${fmtDays(x.tf_before)} → ${fmtDays(x.tf_after)}</td></tr>`).join("")}</tbody></table></div>`;
}

const numKeys = new Set(["days", "lag", "pct", "remaining_days"]);
function cleanChanges(chs) {
  return chs.map((c) => Object.fromEntries(Object.entries(c).filter(([, v]) => v !== "" && v != null)
    .map(([k, v]) => [k, numKeys.has(k) ? Number(v) : v])));
}

async function tabWhatif(el, r, uid, preset) {
  let chs = preset || JSON.parse(sessionStorage.getItem("whatif:" + uid) || "null") || [{ op: "set_duration", code: "", days: "" }];
  el.innerHTML = `<div class="panel"><h3 style="margin-top:0">What-if 시뮬레이션</h3>
    <p class="muted">공기 단축, 관계 변경, 진도 가정을 넣고 재계산합니다. 원본은 바뀌지 않습니다. 결과는 시나리오로 저장하거나 수정된 XER로 내려받아 P6에 가져올 수 있습니다.
    AI 어시스턴트에 "A3030을 10일 단축하면?"처럼 물어봐도 됩니다.</p>
    <div id="chgs"></div>
    <div class="row" style="margin-top:8px"><button class="btn" id="wAdd">+ 변경 추가</button><span class="spacer"></span>
      <input class="s" id="wName" placeholder="시나리오 이름"><button class="btn" id="wSave" data-need="editor">시나리오 저장</button>
      <button class="btn" id="wXer">수정 XER 다운로드</button><button class="btn primary" id="wRun">재계산</button></div></div>
    <div class="panel" id="wRes" hidden></div>
    <div class="panel"><h3 style="margin-top:0">저장된 시나리오</h3><div id="wList" class="muted">불러오는 중...</div></div>`;
  const draw = () => {
    $("#chgs").innerHTML = chs.map(changeForm).join("");
    $("#chgs").querySelectorAll("[data-k]").forEach((inp) => (inp.oninput = () => {
      const i = +inp.dataset.i; chs[i][inp.dataset.k] = inp.value;
      if (inp.dataset.k === "op") { chs[i] = { op: inp.value }; draw(); }
      try { sessionStorage.setItem("whatif:" + uid, JSON.stringify(chs)); } catch {}
    }));
    $("#chgs").querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { chs.splice(+b.dataset.rm, 1); draw(); }));
  };
  const loadList = async () => {
    const sc = await api(`/api/uploads/${uid}/scenarios`);
    $("#wList").innerHTML = sc.length ? `<table class="t"><thead><tr><th>이름</th><th>종류</th><th>준공 변화</th><th>내용</th><th>작성</th><th></th></tr></thead><tbody>
      ${sc.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.kind)}</td><td>${x.summary.finish_before} → ${x.summary.finish_after} (${x.summary.d_finish > 0 ? "+" : ""}${x.summary.d_finish}일)</td>
        <td class="wrap">${x.summary.log.map(esc).join(" · ")}</td><td>${esc(x.author)}<div class="muted" style="font-size:12px">${x.created_at.replace("T", " ")}</div></td>
        <td><button class="btn sm" data-load="${x.id}">불러오기</button> <button class="btn sm danger" data-del="${x.id}">삭제</button></td></tr>`).join("")}</tbody></table>` : "저장된 시나리오가 없습니다.";
    $("#wList").classList.toggle("muted", !sc.length);
    $("#wList").querySelectorAll("[data-load]").forEach((b) => (b.onclick = () => { chs = sc.find((x) => x.id === b.dataset.load).changes.map((c) => ({ ...c })); draw(); $("#wRun").click(); }));
    $("#wList").querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { if (await ui.confirm("이 시나리오를 삭제할까요?", { ok: "삭제", danger: true })) { await api(`/api/scenarios/${b.dataset.del}`, { method: "DELETE" }); loadList(); } }));
  };
  $("#wAdd").onclick = () => { chs.push({ op: "set_duration" }); draw(); };
  $("#wRun").onclick = () => withBusy($("#wRun"), async () => {
    const w = await api(`/api/uploads/${uid}/whatif`, { method: "POST", json: { changes: cleanChanges(chs) } });
    $("#wRes").hidden = false; $("#wRes").innerHTML = `<h3 style="margin-top:0">결과</h3>` + whatifResult(w);
  });
  $("#wSave").onclick = () => withBusy($("#wSave"), async () => {
    await api(`/api/uploads/${uid}/scenarios`, { method: "POST", json: { name: $("#wName").value || "시나리오", kind: "whatif", changes: cleanChanges(chs) } });
    toast("시나리오를 저장했습니다"); loadList();
  });
  $("#wXer").onclick = () => withBusy($("#wXer"), () => downloadPost(`/api/uploads/${uid}/xer_patch`, { changes: cleanChanges(chs) }, "patched.xer"));
  draw(); loadList();
}

async function downloadPost(path, json, fallback) {
  const r = await api(path, { method: "POST", json });
  const blob = await r.blob();
  const m = (r.headers.get("content-disposition") || "").match(/filename\*=UTF-8''([^;]+)/);
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = m ? decodeURIComponent(m[1]) : fallback; a.click();
}

// ---------------------------------------------------------------- ⑥ 관계 추천
async function tabRels(el, r, uid) {
  const st = await getAiStatus();
  el.innerHTML = `${aiOffNote(st)}<div class="panel"><div class="row" style="justify-content:space-between"><h3 style="margin:0">누락 관계 추천</h3>
    <div class="row"><button class="btn" id="rAi" ${st.enabled ? "" : "disabled"}>✦ AI로 다시 추천</button></div></div>
    <p class="muted">선행 또는 후행이 없는 작업(Open End)에 연결할 관계를 추천합니다. 승인한 항목만 What-if로 검증하고, 수정된 XER을 내려받아 P6에 반영하세요.</p>
    <div id="rBody" class="muted">분석 중...</div>
    <div class="row end"><button class="btn" id="rTest">선택 항목 What-if 검증</button><button class="btn" id="rSave" data-need="editor">시나리오로 저장</button><button class="btn primary" id="rXer">선택 반영 XER 다운로드</button></div></div>
    <div class="panel" id="rRes" hidden></div>`;
  let items = [];
  const draw = (d) => {
    items = d.items;
    $("#rBody").classList.remove("muted");
    $("#rBody").innerHTML = items.length ? `<p class="muted">추천 방식: ${d.method}</p><table class="t"><thead><tr><th><input type="checkbox" id="rAll"></th><th>대상</th><th>누락</th><th>추천 관계</th><th class="num">점수</th><th>근거</th></tr></thead><tbody>
      ${items.map((x, i) => `<tr><td><input type="checkbox" class="rc" data-i="${i}"></td><td>${esc(x.target)} <span class="muted">${esc(x.target_name)}</span></td><td>${x.missing}</td>
        <td>${esc(x.pred)} ${esc(x.pred_name)} → ${esc(x.succ)} ${esc(x.succ_name)} <span class="tag">${x.type}${x.lag ? (x.lag > 0 ? "+" : "") + x.lag : ""}</span></td>
        <td class="num">${x.score}</td><td class="wrap">${x.reasons.map(esc).join(", ")}</td></tr>`).join("")}</tbody></table>` : "추천할 관계가 없습니다. 모든 미완료 작업에 선·후행이 있습니다.";
    $("#rAll")?.addEventListener("input", (e) => el.querySelectorAll(".rc").forEach((c) => (c.checked = e.target.checked)));
  };
  const chosen = () => [...el.querySelectorAll(".rc:checked")].map((c) => items[+c.dataset.i])
    .map((x) => ({ op: "add_rel", pred: x.pred, succ: x.succ, type: x.type, lag: x.lag }));
  draw(await api(`/api/uploads/${uid}/rel_suggest`));
  $("#rAi").onclick = async () => { const x = await runLong("AI가 관계를 추천하는 중", "rels", (signal) => api(`/api/uploads/${uid}/rel_suggest?ai=1`, { signal })); if (x) draw(x); };
  $("#rTest").onclick = () => withBusy($("#rTest"), async () => {
    const c = chosen(); if (!c.length) return toast("항목을 선택하세요");
    const w = await api(`/api/uploads/${uid}/whatif`, { method: "POST", json: { changes: c } });
    $("#rRes").hidden = false; $("#rRes").innerHTML = `<h3 style="margin-top:0">검증 결과</h3>` + whatifResult(w);
  });
  $("#rSave").onclick = () => withBusy($("#rSave"), async () => {
    const c = chosen(); if (!c.length) return toast("항목을 선택하세요");
    await api(`/api/uploads/${uid}/scenarios`, { method: "POST", json: { name: `관계 추가 ${c.length}건`, kind: "관계 추천", changes: c } }); toast("What-if 시나리오로 저장했습니다");
  });
  $("#rXer").onclick = () => withBusy($("#rXer"), async () => {
    const c = chosen(); if (!c.length) return toast("항목을 선택하세요");
    await downloadPost(`/api/uploads/${uid}/xer_patch`, { changes: c }, "patched.xer");
  });
}

// ---------------------------------------------------------------- ⑦ 공종 분류
async function tabTrades(el, r, uid) {
  const st = await getAiStatus();
  el.innerHTML = `${aiOffNote(st)}<div class="panel"><div class="row" style="justify-content:space-between"><h3 style="margin:0">공종 분류 · 명칭 표준화</h3>
    <div class="row"><button class="btn" id="tRule" data-need="editor">규칙으로 재분류</button><button class="btn primary" id="tAi" data-need="editor" ${st.enabled ? "" : "disabled"}>✦ AI 분류·표준화</button></div></div>
    <p class="muted">액티비티를 표준 공종으로 분류합니다. 분류 결과는 검색, 리스크, 벤치마크(프로젝트 간 실적 비교)에 쓰입니다.</p><div id="tBody">불러오는 중...</div></div>`;
  const draw = (d) => {
    const by = Object.fromEntries(r.activities.map((a) => [a.code, a]));
    $("#tBody").innerHTML = `<p class="muted">분류 방식: ${esc(d.method)}</p>
      <table class="t"><thead><tr><th>공종</th><th class="num">작업 수</th><th class="num">완료</th><th class="num">최장경로</th><th class="num">잔여 작업일 합</th></tr></thead><tbody>
      ${d.summary.map((x) => `<tr><td><b>${esc(x.trade)}</b></td><td class="num">${x.count}</td><td class="num">${x.done}</td><td class="num">${x.critical}</td><td class="num">${x.rem_days}</td></tr>`).join("")}</tbody></table>
      <h4>액티비티별</h4><div class="scroll"><table class="t"><thead><tr><th>ID</th><th>원래 이름</th><th>표준 명칭</th><th>공종</th></tr></thead><tbody>
      ${Object.entries(d.map).map(([c, t]) => `<tr><td>${esc(c)}</td><td>${esc(by[c]?.name)}</td><td>${esc(d.std_names[c] || "")}</td><td>${esc(t)}</td></tr>`).join("")}</tbody></table></div>`;
  };
  draw(await api(`/api/uploads/${uid}/trades`));
  $("#tRule").onclick = () => withBusy($("#tRule"), async () => draw(await api(`/api/uploads/${uid}/trades?ai=0`, { method: "POST" })));
  $("#tAi").onclick = async () => { const x = await runLong("AI가 공종을 분류하는 중", "trades", (signal) => api(`/api/uploads/${uid}/trades?ai=1`, { method: "POST", signal })); if (x) draw(x); };
}

// ---------------------------------------------------------------- ⑧⑨ 리스크
function drawHist(cv, hist) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext("2d"); g.scale(dpr, dpr);
  if (!hist.length) return;
  const max = Math.max(...hist.map((h) => h[1])), bw = (W - 40) / hist.length;
  g.font = "11px sans-serif";
  hist.forEach(([d, n], i) => {
    const h = (n / max) * (H - 30); g.fillStyle = "#3b82f6"; g.fillRect(30 + i * bw + 1, H - 20 - h, bw - 2, h);
    if (i % Math.ceil(hist.length / 8) === 0) { g.fillStyle = "#6b7280"; g.fillText(d.slice(5), 30 + i * bw, H - 6); }
  });
}

// ---------------------------------------------------------------- ⑩ 벤치마크
async function tabBench(el, r, uid) {
  const b = await api(`/api/uploads/${uid}/benchmark`);
  el.innerHTML = `<div class="panel"><h3 style="margin-top:0">공종별 공기 벤치마크</h3>
    <p class="muted">팀이 올린 모든 프로젝트(${b.sample_projects}개)의 완료 작업에서 <b>실적 작업일 ÷ 계획 원공기</b> 비율을 공종별로 집계합니다. 1.2는 계획보다 20% 더 걸렸다는 뜻입니다. 업로드가 쌓일수록 정확해집니다.</p>
    <table class="t"><thead><tr><th>공종</th><th class="num">작업 수</th><th class="num">원공기 합</th><th class="num">잔여 합</th><th class="num">실적 표본</th><th class="num">실적 비율(중앙)</th><th class="num">P80</th></tr></thead><tbody>
    ${b.trades.map((x) => `<tr><td><b>${esc(x.trade)}</b></td><td class="num">${x.count}</td><td class="num">${x.orig_days}</td><td class="num">${x.rem_days}</td><td class="num">${x.hist_n}</td>
      <td class="num" style="color:${x.hist_median > 1.1 ? "var(--crit)" : ""}">${x.hist_median ?? "-"}</td><td class="num">${x.hist_p80 ?? "-"}</td></tr>`).join("")}</tbody></table></div>
    <div class="panel"><h3 style="margin-top:0">과소 계획 의심 작업</h3>
    ${b.flags.length ? `<table class="t"><thead><tr><th>ID</th><th>작업</th><th>공종</th><th class="num">계획 잔여</th><th class="num">실적 기준 예상</th><th class="num">TF</th></tr></thead><tbody>
      ${b.flags.map((x) => `<tr><td>${esc(x.code)}</td><td>${esc(x.name)}${x.longest ? ' <span class="tag crit">주공정</span>' : ""}</td><td>${esc(x.trade)}</td><td class="num">${x.planned}</td><td class="num">${x.expected}</td><td class="num">${fmtDays(x.tf)}</td></tr>`).join("")}</tbody></table>`
      : `<p class="muted">실적 표본이 부족하거나(공종별 3건 이상 필요) 과소 계획 의심 작업이 없습니다.</p>`}</div>`;
}

// ---------------------------------------------------------------- ⑪ 작업일보 → 진도 입력안
async function tabDaily(el, r, uid) {
  const st = await getAiStatus();
  el.innerHTML = `${aiOffNote(st)}<div class="panel"><h3 style="margin-top:0">작업일보로 진도 입력안 만들기</h3>
    <p class="muted">작업일보나 회의록 문장을 붙여 넣으면 착수·완료·공정률을 추출해 액티비티에 연결합니다. 담당자가 확인한 항목만 반영됩니다.</p>
    <div class="row"><label>일보 날짜 <input class="s" type="date" id="dDate" value="${r.data_date}"></label></div>
    <textarea id="dText" rows="7" style="width:100%;margin-top:8px" placeholder="예) 기초 철근/거푸집 작업 금일 착수, 30% 진행. 지하 배관 매설 완료."></textarea>
    <div class="row end"><button class="btn primary" id="dRun">진도 추출</button></div></div>
    <div class="panel" id="dOut" hidden></div><div class="panel" id="dRes" hidden></div>`;
  let data = null;
  const chosen = () => [...el.querySelectorAll(".dc:checked")].map((c) => data.changes[+c.dataset.i]);
  $("#dRun").onclick = () => withBusy($("#dRun"), async () => {
    data = await api(`/api/uploads/${uid}/daily`, { method: "POST", json: { text: $("#dText").value, date: $("#dDate").value } });
    $("#dOut").hidden = false;
    $("#dOut").innerHTML = `<h3 style="margin-top:0">추출 결과 <span class="muted" style="font-size:13px">(${data.method})</span></h3>
      ${data.items.length ? `<table class="t"><thead><tr><th></th><th>ID</th><th>작업</th><th>현재</th><th>구분</th><th>날짜</th><th class="num">공정률</th><th>근거</th><th class="num">신뢰도</th></tr></thead><tbody>
      ${data.items.map((x, i) => `<tr><td><input type="checkbox" class="dc" data-i="${i}" ${x.confidence >= 70 ? "checked" : ""}></td><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td>${esc(x.current)}</td>
        <td>${esc(x.event)}</td><td>${esc(x.date || "")}</td><td class="num">${x.pct ?? ""}</td><td class="wrap muted">${esc(x.evidence)}</td><td class="num">${x.confidence}</td></tr>`).join("")}</tbody></table>
      <div class="row end"><button class="btn" id="dTest">반영 결과 미리보기</button><button class="btn" id="dSave" data-need="editor">시나리오로 저장</button><button class="btn primary" id="dXer">진도 반영 XER 다운로드</button></div>`
      : `<p class="muted">액티비티와 연결되는 진도 정보를 찾지 못했습니다.</p>`}`;
    if (!data.items.length) return;
    $("#dTest").onclick = () => withBusy($("#dTest"), async () => {
      const w = await api(`/api/uploads/${uid}/whatif`, { method: "POST", json: { changes: chosen() } });
      $("#dRes").hidden = false; $("#dRes").innerHTML = `<h3 style="margin-top:0">반영 후 일정</h3>` + whatifResult(w);
    });
    $("#dSave").onclick = () => withBusy($("#dSave"), async () => {
      await api(`/api/uploads/${uid}/scenarios`, { method: "POST", json: { name: `작업일보 ${$("#dDate").value}`, kind: "진도 입력", changes: chosen() } }); toast("저장했습니다");
    });
    $("#dXer").onclick = () => withBusy($("#dXer"), () => downloadPost(`/api/uploads/${uid}/xer_patch`, { changes: chosen() }, "progress.xer"));
  });
}

// ================================================================ 2차: 벤치마크 반영 화면
function lineChart(cv, labels, series, opts = {}) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext("2d"); g.scale(dpr, dpr);
  const pad = { l: opts.left || 56, r: 12, t: 12, b: 26 };
  const vals = series.flatMap((s) => s.values).filter((v) => v !== null && v !== undefined);
  if (!vals.length || !labels.length) return;
  let lo = opts.min ?? Math.min(...vals), hi = opts.max ?? Math.max(...vals); if (hi === lo) { hi += 1; lo -= 1; }
  const X = (i) => pad.l + (labels.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (labels.length - 1)) * (W - pad.l - pad.r));
  const Y = (v) => H - pad.b - ((v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  g.font = "11px sans-serif"; g.strokeStyle = "#e5e7eb"; g.fillStyle = "#6b7280";
  for (let k = 0; k <= 4; k++) { const v = lo + (k * (hi - lo)) / 4; g.beginPath(); g.moveTo(pad.l, Y(v)); g.lineTo(W - pad.r, Y(v)); g.stroke(); g.fillText(opts.fmt ? opts.fmt(v) : Math.round(v), 4, Y(v) + 4); }
  const step = Math.ceil(labels.length / 10);
  labels.forEach((l, i) => { if (i % step === 0) g.fillText(l, X(i) - 20, H - 8); });
  series.forEach((s) => {
    g.strokeStyle = s.color; g.fillStyle = s.color; g.lineWidth = 2; g.setLineDash(s.dash || []); g.beginPath();
    let started = false;
    s.values.forEach((v, i) => { if (v === null || v === undefined) return; started ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)); started = true; });
    g.stroke(); g.setLineDash([]);
    if (s.dots) s.values.forEach((v, i) => { if (v !== null && v !== undefined) { g.beginPath(); g.arc(X(i), Y(v), 3.5, 0, 7); g.fill(); } });
  });
  if (opts.yTitle) { g.save(); g.fillStyle = "#6b7280"; g.translate(10, pad.t + 60); g.rotate(-Math.PI / 2); g.restore(); }
  attachTooltip(cv, labels, series, opts.fmt || ((v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v)));
}
const legend = (items) => `<div class="legend">${items.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join("")}</div>`;
const signed = (v) => (v > 0 ? "+" : "") + v;
const won = (v) => v === null || v === undefined ? "-" : (Math.abs(v) >= 1e8 ? (v / 1e8).toFixed(2) + "억" : Math.abs(v) >= 1e4 ? Math.round(v / 1e4).toLocaleString() + "만" : Math.round(v).toLocaleString());

// ---------------------------------------------------------------- 건전성 점수
async function tabHealth(el, r, uid) {
  const h = await api(`/api/uploads/${uid}/health`);
  const color = h.score >= 90 ? "var(--ok)" : h.score >= 75 ? "#65a30d" : h.score >= 60 ? "var(--warn)" : "var(--crit)";
  const groups = [...new Set(h.metrics.map((m) => m.group))];
  el.innerHTML = `<div class="row" style="gap:16px;align-items:stretch;margin-bottom:16px">
      <div class="panel score"><div class="muted">종합 건전성 점수</div><div class="big" style="color:${color}">${h.score}<small>/100</small></div>
        <div class="grade" style="background:${color}">${h.grade}</div><div class="muted" style="font-size:12px">${h.passed}/${h.evaluated} 항목 통과</div></div>
      <div class="panel" style="flex:1"><h4 style="margin-top:0">그룹별 점수</h4>
        ${Object.entries(h.groups).map(([g, v]) => `<div class="hbar"><span>${g}</span><div><i style="width:${v}%;background:${v >= 75 ? "var(--ok)" : v >= 60 ? "var(--warn)" : "var(--crit)"}"></i></div><b>${v}</b></div>`).join("")}
        <p class="muted" style="font-size:12px;margin-bottom:0">DCMA 14-Point, GAO 일정 평가 모범사례, AACE 권고에서 쓰는 점검 항목 ${h.metrics.length}개를 가중 평균했습니다. 기준값과 가중치는 <a href="#/p/${uid}/settings">설정</a>에서 바꿀 수 있습니다.</p></div></div>
    ${groups.map((g) => `<div class="panel"><h3 style="margin-top:0">${g}</h3><table class="t"><thead><tr><th>ID</th><th>항목</th><th>설명</th><th class="num">결과</th><th>기준</th><th class="num">점수</th><th>판정</th></tr></thead><tbody>
      ${h.metrics.filter((m) => m.group === g).map((m, i) => `<tr class="${m.items.length ? "clickable" : ""}" data-m="${m.id}">
        <td>${m.id}</td><td><b>${esc(m.name)}</b></td><td class="wrap muted">${esc(m.desc)}</td>
        <td class="num">${m.unit === "%" && m.total ? `${m.count}/${m.total} · ` : ""}${m.value}${m.unit === "%" ? "%" : m.unit === "개" ? "개" : ""}</td>
        <td>${m.cmp === "info" ? "참고" : (m.cmp === "le" ? "≤ " : "≥ ") + m.threshold + (m.unit === "%" ? "%" : "")}</td>
        <td class="num">${m.score ?? "-"}</td>
        <td>${m.pass === null ? '<span class="tag">참고</span>' : m.pass ? '<span class="tag ok">통과</span>' : '<span class="tag fail">미달</span>'}</td></tr>
        <tr hidden id="mi-${m.id}"><td></td><td colspan="6" class="dcma-items">${m.items.map(esc).join(", ")}</td></tr>`).join("")}</tbody></table></div>`).join("")}`;
  el.querySelectorAll("tr[data-m]").forEach((tr) => (tr.onclick = () => { const x = $(`#mi-${tr.dataset.m}`); if (x.querySelector("td:last-child").textContent) x.hidden = !x.hidden; }));
}

// ---------------------------------------------------------------- 포렌식
async function tabForensic(el, r, uid) {
  const list = (await api("/api/uploads")).filter((u) => u.name === r.name && u.id !== uid && u.data_date < r.data_date);
  el.innerHTML = `<div class="panel"><div class="row"><b>비교 기준</b><select class="s" id="fBase">${list.map((u) => `<option value="${u.id}">${u.data_date} · ${esc(u.note || u.filename)}</option>`).join("") || "<option value=''>이전 업데이트 없음</option>"}</select></div></div><div id="fBody">불러오는 중...</div>`;
  const draw = async () => {
    const f = await api(`/api/uploads/${uid}/forensic${$("#fBase").value ? "?base=" + $("#fBase").value : ""}`);
    const tr = f.trend;
    let html = `<div class="panel"><h3 style="margin-top:0">업데이트 추세</h3>
      ${legend([["#dc2626", "예상 준공 변동(누적, 일)"], ["#2563eb", "건전성 점수"], ["#16a34a", "공정률 %"]])}
      <canvas id="trendCv" style="width:100%;height:240px"></canvas>
      <table class="t"><thead><tr><th>Data Date</th><th>예상 준공</th><th class="num">변동</th><th class="num">공정률</th><th class="num">최장경로</th><th class="num">음수여유</th><th class="num">건전성</th><th class="num">DCMA</th></tr></thead><tbody>
      ${tr.map((x) => `<tr><td><a href="#/p/${x.id}/forensic">${x.data_date}</a></td><td>${x.finish}</td><td class="num" style="color:${x.finish_change > 0 ? "var(--crit)" : ""}">${signed(x.finish_change)}</td>
        <td class="num">${x.progress}%</td><td class="num">${x.longest}</td><td class="num">${x.negative_float}</td><td class="num">${x.health ?? "-"}</td><td class="num">${x.dcma_pass}/14</td></tr>`).join("")}</tbody></table></div>`;
    if (!f.available) html += `<div class="panel empty">${esc(f.message)}</div>`;
    else {
      const c = f.compression;
      html += `<div class="panel ${c.suspected ? "warn" : ""}"><h3 style="margin-top:0">공기 압축(Compression) 탐지 ${c.suspected ? '<span class="tag fail">의심</span>' : '<span class="tag ok">특이 없음</span>'}</h3>
        <p class="muted">${esc(c.note)} 최장경로 단축 합계 <b>${c.longest_path_cut_days}일</b>, 준공 변동 ${signed(c.finish_slip)}일.</p>
        ${c.items.length ? `<table class="t"><thead><tr><th>ID</th><th>작업</th><th class="num">잔여(전)</th><th class="num">예상 잔여</th><th class="num">잔여(후)</th><th class="num">진척 없는 단축</th><th>공정률</th></tr></thead><tbody>
        ${c.items.map((x) => `<tr><td>${esc(x.code)}</td><td>${esc(x.name)}${x.longest ? ' <span class="tag crit">주공정</span>' : ""}</td><td class="num">${x.rem_before}</td><td class="num">${x.expected}</td><td class="num">${x.rem_after}</td><td class="num" style="color:var(--crit)">-${x.cut}</td><td>${x.pct_before}% → ${x.pct_after}%</td></tr>`).join("")}</tbody></table>` : ""}</div>
        <div class="panel"><h3 style="margin-top:0">변경 로그 (${f.changes.items.length}건)</h3>
        <div class="chips">${Object.entries(f.changes.counts).map(([k, v]) => `<span class="chip filter" data-cat="${esc(k)}">${esc(k)} ${v}</span>`).join("")}<span class="chip filter on" data-cat="">전체</span></div>
        <div class="scroll"><table class="t" id="chgTable"><thead><tr><th>구분</th><th>ID</th><th>대상</th><th>변경 전</th><th>변경 후</th><th>비고</th></tr></thead><tbody>
        ${f.changes.items.map((x) => `<tr data-cat="${esc(x.category)}"><td>${esc(x.category)}</td><td>${esc(x.code)}</td><td class="wrap">${esc(x.name)}</td><td>${esc(x.before)}</td><td>${esc(x.after)}</td><td class="wrap ${x.note ? "warn-text" : ""}">${esc(x.note)}</td></tr>`).join("")}</tbody></table></div></div>`;
    }
    $("#fBody").innerHTML = html;
    const base = tr.length ? Date.parse(tr[0].finish) : 0;
    lineChart($("#trendCv"), tr.map((x) => x.data_date.slice(2)), [
      { name: "준공 변동(일)", color: "#dc2626", values: tr.map((x) => Math.round((Date.parse(x.finish) - base) / 864e5)), dots: true },
      { name: "건전성", color: "#2563eb", values: tr.map((x) => x.health), dots: true, dash: [4, 3] },
      { name: "공정률 %", color: "#16a34a", values: tr.map((x) => x.progress), dots: true, dash: [2, 3] }], { left: 36 });
    el.querySelectorAll(".chip.filter").forEach((ch) => (ch.onclick = () => {
      el.querySelectorAll(".chip.filter").forEach((x) => x.classList.toggle("on", x === ch));
      el.querySelectorAll("#chgTable tbody tr").forEach((tr) => (tr.hidden = ch.dataset.cat && tr.dataset.cat !== ch.dataset.cat));
    }));
  };
  $("#fBase").onchange = draw; draw();
}

// ---------------------------------------------------------------- 리스크 레지스터 + 시뮬레이션
async function tabRisk(el, r, uid) {
  const st = await getAiStatus();
  el.innerHTML = `<div class="panel"><div class="row" style="justify-content:space-between"><h3 style="margin:0">리스크 레지스터</h3>
      <div class="row"><button class="btn" id="rkExtract" data-need="editor" ${st.enabled ? "" : "disabled title='AI 미설정'"}>✦ 문서에서 리스크 찾기</button><button class="btn primary" id="rkAdd" data-need="editor">+ 리스크 추가</button></div></div>
      <p class="muted">리스크(아직 일어나지 않은 사건)를 영향받는 액티비티에 연결하면 몬테카를로 시뮬레이션에 반영됩니다. 노출도 = 확률 × 평균 영향일.</p>
      <div id="rkList"></div></div>
    <div class="panel"><div class="row" style="justify-content:space-between"><h3 style="margin:0">준공 리스크 시뮬레이션</h3>
      <div class="row"><label><input type="checkbox" id="simRisk" checked> 리스크 사건 반영</label><label><input type="checkbox" id="simUnc" checked> 공기 불확실성</label>
      <label class="muted">반복 <input class="s" id="simN" type="number" value="1000" style="width:80px"></label><button class="btn primary" id="simRun">실행</button></div></div>
      <div id="simBody" class="muted" style="margin-top:8px">실행하면 P50/P80/P90 준공일, 목표 달성 확률, 민감도(Tornado)를 계산합니다.</div></div>
    <dialog id="dlgRisk"><form method="dialog" id="fRisk"><h3>리스크</h3>
      <label>제목<input name="title" required></label><label>설명<input name="desc"></label>
      <label>분류<select name="category">${["설계", "인허가", "자재·장비", "인력", "기상", "민원·환경", "발주처", "협력업체", "기술", "기타"].map((c) => `<option>${c}</option>`).join("")}</select></label>
      <label>영향 액티비티 ID (쉼표로 구분)<input name="codes" placeholder="A2000, A2010"></label>
      <div class="row"><label>발생확률 %<input name="prob" type="number" min="0" max="100"></label><label>영향 최소(일)<input name="impact_min" type="number"></label>
      <label>최빈<input name="impact_ml" type="number"></label><label>최대<input name="impact_max" type="number"></label></div>
      <div class="row"><label>비용 영향(원)<input name="cost" type="number"></label><label>담당<input name="owner"></label><label>상태<select name="status"><option value="open">열림</option><option value="mitigating">대응중</option><option value="closed">종결</option></select></label></div>
      <label>대응 방안<input name="mitigation"></label>
      <div class="row end"><button class="btn" value="cancel" formnovalidate>취소</button><button class="btn primary" value="ok">저장</button></div></form></dialog>
    <dialog id="dlgExtract"><form method="dialog"><h3>문서에서 리스크 찾기</h3><p class="muted">회의록, 공문, 일보 등을 붙여 넣으세요. AI가 리스크 후보를 제안하면 검토 후 등록합니다.</p>
      <textarea id="exText" rows="10" style="width:100%"></textarea><div id="exOut"></div>
      <div class="row end"><button class="btn" value="cancel">닫기</button><button class="btn primary" id="exRun" type="button">찾기</button></div></form></dialog>`;
  let list = [];
  const load = async () => {
    list = await api(`/api/uploads/${uid}/risks`);
    $("#rkList").innerHTML = list.length ? `<table class="t"><thead><tr><th>리스크</th><th>분류</th><th>영향 작업</th><th class="num">확률</th><th>영향(일)</th><th class="num">노출도</th><th>대응</th><th>상태</th><th></th></tr></thead><tbody>
      ${list.map((x) => `<tr><td class="wrap"><b>${esc(x.title)}</b><div class="muted" style="font-size:12px">${esc(x.desc || "")}</div></td><td>${esc(x.category || "")}</td><td>${x.codes.map(esc).join(", ")}</td>
        <td class="num">${x.prob}%</td><td>${x.impact_min}/${x.impact_ml}/${x.impact_max}</td><td class="num"><b>${x.exposure_days}</b></td><td class="wrap">${esc(x.mitigation || "")}<div class="muted" style="font-size:12px">${esc(x.owner || "")}</div></td>
        <td><span class="tag ${x.status === "closed" ? "done" : x.status === "mitigating" ? "" : "fail"}">${{ open: "열림", mitigating: "대응중", closed: "종결" }[x.status]}</span></td>
        <td><button class="btn sm" data-edit="${x.id}">수정</button> <button class="btn sm danger" data-rm="${x.id}">삭제</button></td></tr>`).join("")}</tbody></table>`
      : `<p class="muted">등록된 리스크가 없습니다.</p>`;
    $("#rkList").querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => openForm(list.find((x) => x.id === b.dataset.edit))));
    $("#rkList").querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => { if (await ui.confirm("이 리스크를 삭제할까요?", { ok: "삭제", danger: true })) { await api(`/api/uploads/${uid}/risks/${b.dataset.rm}`, { method: "DELETE" }); load(); } }));
  };
  let editing = null;
  const openForm = (x = {}) => {
    editing = x.id || null; const f = $("#fRisk"); f.reset();
    for (const [k, v] of Object.entries(x)) if (f[k]) f[k].value = Array.isArray(v) ? v.join(", ") : v ?? "";
    $("#dlgRisk").showModal();
  };
  $("#fRisk").onsubmit = async (e) => {
    if (e.submitter?.value !== "ok") return; e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target)); d.codes = d.codes.split(/[,\s]+/).filter(Boolean); if (editing) d.id = editing;
    try { await api(`/api/uploads/${uid}/risks`, { method: "POST", json: d }); $("#dlgRisk").close(); load(); } catch (err) { toast(err.message); }
  };
  $("#rkAdd").onclick = () => openForm();
  $("#rkExtract").onclick = () => { $("#exOut").innerHTML = ""; $("#dlgExtract").showModal(); };
  $("#exRun").onclick = () => withBusy($("#exRun"), async () => {
    const xs = await api(`/api/uploads/${uid}/risks/extract`, { method: "POST", json: { text: $("#exText").value } });
    $("#exOut").innerHTML = xs.length ? `<table class="t">${xs.map((x, i) => `<tr><td><input type="checkbox" class="exc" data-i="${i}" checked></td><td class="wrap"><b>${esc(x.title)}</b><div class="muted">${esc(x.desc)}</div></td><td>${x.codes.join(", ")}</td><td>${x.prob}% · ${x.impact_ml}일</td></tr>`).join("")}</table>
      <div class="row end"><button class="btn primary" type="button" id="exSave">선택 항목 등록</button></div>` : `<p class="muted">찾은 리스크가 없습니다.</p>`;
    $("#exSave")?.addEventListener("click", async () => {
      for (const c of $("#exOut").querySelectorAll(".exc:checked")) await api(`/api/uploads/${uid}/risks`, { method: "POST", json: xs[+c.dataset.i] });
      $("#dlgExtract").close(); load(); toast("등록했습니다");
    });
  });
  $("#simRun").onclick = async () => {
    const m = await runLong(`몬테카를로 시뮬레이션 ${$("#simN").value}회`, "sim" + $("#simN").value, (signal) => api(`/api/uploads/${uid}/simulate?n=${$("#simN").value}&risks=${$("#simRisk").checked ? 1 : 0}&uncertainty=${$("#simUnc").checked ? 1 : 0}`, { signal }));
    if (!m) return;
    const maxImp = Math.max(1, ...m.risk_tornado.map((t) => t.impact_days));
    $("#simBody").classList.remove("muted");
    $("#simBody").innerHTML = `<div class="kpis">${kpi("결정론적 준공", m.deterministic)}${kpi("P50", m.p50)}${kpi("P80", m.p80, "crit")}${kpi("P90", m.p90)}
      ${m.prob_meet_target !== null ? kpi(`목표(${m.must_finish}) 달성 확률`, m.prob_meet_target + "%", m.prob_meet_target < 50 ? "crit" : "") : ""}</div>
      <canvas id="mcHist" style="width:100%;height:180px"></canvas><p class="muted">${esc(m.assumption)} · 반복 ${m.iterations}회</p>
      <div class="grid2"><div><h4>리스크 민감도 (발생 시 준공 영향)</h4>${m.risk_tornado.length ? m.risk_tornado.map((t) => `<div class="hbar"><span title="${esc(t.label)}">${esc(t.label)}</span><div><i style="width:${(100 * t.impact_days) / maxImp}%;background:var(--crit)"></i></div><b>+${t.impact_days}일</b></div>`).join("") : '<p class="muted">반영된 리스크가 없습니다.</p>'}</div>
      <div><h4>작업 공기 민감도 (상관계수)</h4>${m.activity_tornado.map((t) => `<div class="hbar"><span title="${esc(t.label)}">${esc(t.label)}</span><div><i style="width:${100 * t.correlation}%;background:var(--bar)"></i></div><b>${t.correlation}</b></div>`).join("") || '<p class="muted">없음</p>'}</div></div>
      <h4>주공정 지수</h4><table class="t"><tbody>${m.criticality.slice(0, 12).map((x) => `<tr><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td class="num">${x.index}%</td></tr>`).join("")}</tbody></table>`;
    drawHist($("#mcHist"), m.histogram);
  };
  load();
}

// ---------------------------------------------------------------- 지연 예측 (위험 점수 + 학습 모델)
async function tabPredict(el, r, uid) {
  const [rk, pr] = await Promise.all([api(`/api/uploads/${uid}/risk`), api(`/api/uploads/${uid}/prediction`)]);
  const md_ = pr.model;
  el.innerHTML = `<div class="panel ${md_.trained ? "" : "warn"}"><h3 style="margin-top:0">학습 기반 예측 모델</h3>
      ${md_.trained ? `<p>업데이트 이력 표본 <b>${md_.samples}</b>개로 학습했습니다. 검증 오차(MAE) <b>${md_.mae_days}일</b>, 설명력 R² <b>${md_.r2}</b>.</p>
        <p class="muted">영향 큰 요인: ${md_.importance.slice(0, 5).map((x) => `${x.feature}(${x.weight > 0 ? "+" : ""}${x.weight})`).join(", ")}</p>
        <table class="t"><thead><tr><th>ID</th><th>작업</th><th class="num">다음 업데이트 예상 순연(일)</th><th class="num">TF</th></tr></thead><tbody>
        ${pr.items.slice(0, 20).map((x) => `<tr><td>${esc(x.code)}</td><td>${esc(x.name)}${x.longest ? ' <span class="tag crit">주공정</span>' : ""}</td><td class="num" style="color:${x.predicted_slip > 3 ? "var(--crit)" : ""}">${x.predicted_slip}</td><td class="num">${fmtDays(x.tf)}</td></tr>`).join("")}</tbody></table>`
      : `<p>${esc(md_.message)}</p><p class="muted">그동안은 아래의 설명 가능한 규칙 기반 위험 점수를 사용하세요.</p>`}</div>
    <div class="panel"><h3 style="margin-top:0">지연 위험 점수</h3><p class="muted">${esc(rk.note)} (누적 업데이트 ${rk.history_updates}회)</p>
    <div class="scroll"><table class="t"><thead><tr><th>ID</th><th>작업</th><th>공종</th><th>상태</th><th>종료</th><th class="num">TF</th><th class="num">위험</th><th>사유</th></tr></thead><tbody>
    ${rk.items.map((x) => `<tr><td>${esc(x.code)}</td><td class="wrap">${esc(x.name)}</td><td>${esc(x.trade)}</td><td>${esc(x.status)}</td><td>${x.finish}</td><td class="num">${fmtDays(x.tf)}</td>
      <td class="num"><span class="tag ${x.score >= 50 ? "fail" : x.score >= 30 ? "" : "ok"}">${x.score}</span></td><td class="wrap">${x.reasons.map(esc).join(", ")}</td></tr>`).join("")}</tbody></table></div></div>`;
}

// ---------------------------------------------------------------- 자동 만회안
async function tabRecovery(el, r, uid) {
  el.innerHTML = `<div class="panel"><h3 style="margin-top:0">자동 만회안 탐색</h3>
    <p class="muted">목표 일수만큼 준공을 당기기 위해 최장경로 작업의 공기 단축(Crashing)과 병행(Fast-tracking) 조합을 자동으로 찾고, 재계산으로 검증합니다.</p>
    <div class="row"><label>만회 목표 <input class="s" id="rvDays" type="number" value="10" style="width:80px"> 일</label>
      <label>작업별 최대 단축률 <select class="s" id="rvRatio"><option value="0.2">20%</option><option value="0.3" selected>30%</option><option value="0.5">50%</option></select></label>
      <label>제외 작업 <input class="s" id="rvEx" placeholder="A1050, A2000" style="width:180px"></label>
      <button class="btn primary" id="rvRun">탐색</button></div>
    <details style="margin-top:8px"><summary class="muted">작업별 일당 단축 비용 입력 (선택)</summary><textarea id="rvCost" rows="3" style="width:100%" placeholder="A2010=3&#10;A3030=1.5"></textarea></details></div>
    <div id="rvOut"></div>`;
  $("#rvRun").onclick = async () => {
    const costs = Object.fromEntries($("#rvCost").value.split("\n").map((l) => l.split("=").map((x) => x.trim())).filter((x) => x.length === 2 && x[1]));
    const res = await runLong(`${$("#rvDays").value}일 만회안 탐색 중 (3가지 전략)`, "recovery", (signal) => api(`/api/uploads/${uid}/recovery`, { method: "POST", signal, json: { days: +$("#rvDays").value, max_ratio: +$("#rvRatio").value, costs, exclude: $("#rvEx").value.split(/[,\s]+/).filter(Boolean) } }));
    if (!res) return;
    $("#rvOut").innerHTML = `<p class="muted">${esc(res.note)}</p><div class="grid3">${res.options.map((o, i) => `<div class="panel option ${o.achieved ? "" : "dim"}">
      <div class="row" style="justify-content:space-between"><b>${esc(o.policy)}</b>${i === 0 && o.achieved ? '<span class="tag ok">추천</span>' : ""}</div>
      <div class="big">${o.gained_days}<small>일 만회</small></div><div class="muted">목표 ${o.target_days}일 ${o.achieved ? "달성" : "미달"} · 상대 비용 ${o.relative_cost}${o.finish_after ? ` · 준공 ${o.finish_after}` : ""}</div>
      ${o.crashed.length ? `<h4>공기 단축</h4><ul>${o.crashed.map((c) => `<li>${esc(c.code)} ${esc(c.name)} <b>-${c.days}일</b></li>`).join("")}</ul>` : ""}
      ${o.fast_tracked.length ? `<h4>병행 (FS→SS)</h4><ul>${o.fast_tracked.map((f) => `<li>${esc(f.pred)} → ${esc(f.succ)} SS+${f.lag}</li>`).join("")}</ul>` : ""}
      ${o.changes.length ? `<div class="row"><button class="btn sm" data-wi="${i}">What-if로 열기</button><button class="btn sm" data-sv="${i}">시나리오 저장</button></div>` : '<p class="muted">적용 가능한 조치가 없습니다.</p>'}</div>`).join("")}</div>`;
    $("#rvOut").querySelectorAll("[data-wi]").forEach((b) => (b.onclick = () => { sessionStorage.setItem("whatif:" + uid, JSON.stringify(res.options[+b.dataset.wi].changes)); location.hash = `#/p/${uid}/whatif`; }));
    $("#rvOut").querySelectorAll("[data-sv]").forEach((b) => (b.onclick = async () => {
      const o = res.options[+b.dataset.sv];
      await api(`/api/uploads/${uid}/scenarios`, { method: "POST", json: { name: `만회안 ${o.policy} ${o.gained_days}일`, kind: "만회안", changes: o.changes } }); toast("저장했습니다");
    }));
  };
}

// ---------------------------------------------------------------- 베이스라인·EVM
async function tabEvm(el, r, uid) {
  const [bls, ups] = await Promise.all([api(`/api/uploads/${uid}/baselines`), api("/api/uploads")]);
  const same = ups.filter((u) => u.name === r.name);
  el.innerHTML = `<div class="panel"><div class="row" style="justify-content:space-between"><div class="row"><b>베이스라인</b>
      <select class="s" id="blSel"><option value="target">P6 계획(Target) 날짜</option>${bls.map((b) => `<option value="${b.id}">${esc(b.label)} (DD ${b.data_date})</option>`).join("")}</select></div>
      <div class="row"><select class="s" id="blSrc">${same.map((u) => `<option value="${u.id}">${u.data_date} · ${esc(u.note || u.filename)}</option>`).join("")}</select>
      <input class="s" id="blLabel" placeholder="이름 (예: 최초 승인)"><button class="btn" id="blAdd" data-need="editor">베이스라인 지정</button></div></div></div>
    <div id="evBody"></div><div id="varBody"></div>`;
  $("#blAdd").onclick = async () => { await api(`/api/uploads/${uid}/baselines`, { method: "POST", json: { upload_id: $("#blSrc").value, label: $("#blLabel").value } }); toast("지정했습니다"); tabEvm(el, r, uid); };
  const draw = async () => {
    const b = $("#blSel").value;
    const [e, v] = await Promise.all([api(`/api/uploads/${uid}/evm?baseline=${b}`), api(`/api/uploads/${uid}/variance?baseline=${b}`)]);
    $("#evBody").innerHTML = !e.available ? `<div class="panel muted">${esc(e.message)}</div>` : `<div class="kpis">
      ${kpi("BAC (총예산)", won(e.bac))}${kpi("PV / EV / AC", `<span style="font-size:15px">${won(e.pv)} / ${won(e.ev)} / ${won(e.ac)}</span>`)}
      ${kpi("SPI", e.spi ?? "-", e.spi < 0.95 ? "crit" : "")}${kpi("CPI", e.cpi ?? "-", e.cpi < 0.95 ? "crit" : "")}
      ${kpi("EAC (실적+잔여)", won(e.eac))}${kpi("VAC", won(e.vac), e.vac < 0 ? "crit" : "")}</div>
      <div class="panel"><h3 style="margin-top:0">비용 S-Curve</h3>${legend([["#f59e0b", "PV (계획)"], ["#3b82f6", "현재 일정 예측"], ["#16a34a", "EV (업데이트별)"], ["#dc2626", "AC (업데이트별)"]])}
      <canvas id="evCv" style="width:100%;height:280px"></canvas></div>
      ${e.worst_cv.length ? `<div class="panel"><h3 style="margin-top:0">원가 초과 작업 (CV 작은 순)</h3><table class="t"><thead><tr><th>ID</th><th>작업</th><th class="num">BAC</th><th class="num">EV</th><th class="num">AC</th><th class="num">CV</th></tr></thead><tbody>
        ${e.worst_cv.map((x) => `<tr><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td class="num">${won(x.bac)}</td><td class="num">${won(x.ev)}</td><td class="num">${won(x.ac)}</td><td class="num" style="color:${x.cv < 0 ? "var(--crit)" : ""}">${won(x.cv)}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
    if (e.available) {
      const labels = e.curve.map((c) => c.date);
      const hist = Object.fromEntries((e.history || []).map((h) => [h.date, h]));
      const near = (key) => labels.map((d, i) => { const h = (e.history || []).find((x) => x.date >= d && (i + 1 >= labels.length || x.date < labels[i + 1])); return h ? h[key] : null; });
      lineChart($("#evCv"), labels.map((d) => d.slice(2)), [
        { name: "PV", color: "#f59e0b", values: e.curve.map((c) => c.pv) }, { name: "예측", color: "#3b82f6", values: e.curve.map((c) => c.forecast), dash: [5, 4] },
        { name: "EV", color: "#16a34a", values: near("ev"), dots: true }, { name: "AC", color: "#dc2626", values: near("ac"), dots: true }], { fmt: won, left: 52 });
    }
    $("#varBody").innerHTML = `<div class="panel"><h3 style="margin-top:0">베이스라인 대비 편차 <span class="muted" style="font-size:13px">(기준: ${esc(v.source)})</span></h3>
      <div class="kpis">${kpi("베이스라인 준공", v.bl_project_finish || "-")}${kpi("현재 예상 준공", v.project_finish)}${kpi("준공 편차", v.project_var === null ? "-" : signed(v.project_var) + "일", v.project_var > 0 ? "crit" : "")}${kpi("지연 작업 수", v.late_count)}</div>
      <div class="scroll"><table class="t"><thead><tr><th>ID</th><th>작업</th><th>상태</th><th>BL 시작</th><th>시작</th><th class="num">Δ</th><th>BL 종료</th><th>종료</th><th class="num">Δ</th></tr></thead><tbody>
      ${v.rows.slice(0, 300).map((x) => `<tr><td>${esc(x.code)}</td><td>${esc(x.name)}${x.longest ? ' <span class="tag crit">주공정</span>' : ""}</td><td>${esc(x.status)}</td><td>${x.bl_start || "-"}</td><td>${x.start}</td><td class="num">${x.start_var ?? "-"}</td><td>${x.bl_finish}</td><td>${x.finish}</td>
        <td class="num" style="color:${x.finish_var > 0 ? "var(--crit)" : x.finish_var < 0 ? "var(--ok)" : ""}">${signed(x.finish_var)}</td></tr>`).join("")}</tbody></table></div></div>`;
  };
  $("#blSel").onchange = draw; draw();
}

// ---------------------------------------------------------------- 자원 히스토그램
async function tabResources(el, r, uid) {
  const h = await api(`/api/uploads/${uid}/resources`);
  if (!h.series.length) { el.innerHTML = `<div class="panel empty">XER에 잔여 물량(TASKRSRC remain_qty)이 있는 자원 배정이 없습니다.</div>`; return; }
  const colors = ["#3b82f6", "#f59e0b", "#16a34a", "#8b5cf6", "#dc2626", "#0891b2", "#db2777"];
  el.innerHTML = `<div class="panel"><h3 style="margin-top:0">자원 히스토그램 (주간 잔여 물량, Early 일정 기준)</h3>
    ${legend(h.series.map((s, i) => [colors[i % colors.length], `${s.name} (최대 ${s.peak})`]))}<canvas id="rsCv" style="width:100%;height:300px"></canvas>
    <p class="muted">막대가 급격히 솟는 주는 자원 과부하 가능성이 있습니다. 여유가 있는 작업을 뒤로 미루면 평준화할 수 있습니다(What-if).</p></div>`;
  const cv = $("#rsCv"), dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext("2d"); g.scale(dpr, dpr);
  const tot = h.weeks.map((_, i) => h.series.reduce((a, s) => a + s.values[i], 0)), max = Math.max(...tot, 1);
  const bw = (W - 50) / h.weeks.length; g.font = "11px sans-serif";
  h.weeks.forEach((w, i) => {
    let y = H - 22;
    h.series.forEach((s, k) => { const hh = (s.values[i] / max) * (H - 40); g.fillStyle = colors[k % colors.length]; g.fillRect(44 + i * bw + 1, y - hh, bw - 2, hh); y -= hh; });
    if (i % Math.ceil(h.weeks.length / 10) === 0) { g.fillStyle = "#6b7280"; g.fillText(w.slice(2), 44 + i * bw, H - 6); }
  });
  g.fillStyle = "#6b7280"; g.fillText(Math.round(max), 4, 16);
}

// ---------------------------------------------------------------- 국내 기준
async function tabKorea(el, r, uid) {
  const k = await api(`/api/uploads/${uid}/korea`);
  el.innerHTML = `<div class="panel"><h3 style="margin-top:0">캘린더 법정공휴일 점검</h3>
      <p class="muted">Data Date부터 예상 준공까지의 법정공휴일·대체공휴일(${k.holidays.length}일)이 공정 캘린더에 비작업일로 들어 있는지 확인합니다. 임시공휴일·선거일은 <a href="#/admin">관리자 화면</a>에서 추가하세요.</p>
      ${k.calendars.map((c) => `<div class="cal-row"><b>${esc(c.name)}</b> ${c.missing.length ? `<span class="tag fail">누락 ${c.missing.length}일</span>` : '<span class="tag ok">이상 없음</span>'}
        ${c.note ? `<span class="muted"> ${esc(c.note)}</span>` : ""}
        ${c.missing.length ? `<div class="muted" style="font-size:12px;margin:4px 0">${c.missing.map((m) => `${m.date.slice(5)} ${esc(m.name)}`).join(", ")}</div>
          <button class="btn sm" data-fix="${c.clndr_id}">공휴일 반영 XER 다운로드</button> <button class="btn sm" data-wi="${c.clndr_id}">반영 시 일정 영향 보기</button>` : ""}</div>`).join("")}
      <div id="kWi"></div></div>
    <div class="panel"><h3 style="margin-top:0">기상 비작업일 기반 적정 공기 검토</h3>
      <p class="muted">월별 기상 비작업일(강우·강설·한파·폭염 등)을 현장 지역의 기상청 통계로 산정해 입력하세요. 필요 비작업일보다 캘린더 비작업일이 적은 달은 작업일을 과다하게 잡은 것입니다. 기준 캘린더: ${esc(k.default_calendar || "-")}</p>
      <div class="months">${Array.from({ length: 12 }, (_, i) => `<label>${i + 1}월<input class="s" type="number" step="0.5" min="0" data-m="${i + 1}" value="${k.weather_days[i + 1] ?? ""}"></label>`).join("")}</div>
      <div class="row end"><button class="btn primary" id="kSave" data-need="editor">저장 후 재검토</button></div>
      <table class="t"><thead><tr><th>월</th><th class="num">일수</th><th class="num">주말·공휴일</th><th class="num">기상</th><th class="num">필요 비작업일</th><th class="num">캘린더 비작업일</th><th class="num">부족</th></tr></thead><tbody>
      ${k.review.months.map((m) => `<tr><td>${m.month}</td><td class="num">${m.days}</td><td class="num">${m.holidays_weekends}</td><td class="num">${m.weather}</td><td class="num">${m.required_nonwork}</td><td class="num">${m.calendar_nonwork}</td>
        <td class="num" style="color:${m.shortage > 0 ? "var(--crit)" : ""}">${m.shortage || ""}</td></tr>`).join("")}</tbody></table>
      <p><b>부족 비작업일 합계: ${k.review.total_shortage_days}일</b> <span class="muted">${esc(k.review.note)}</span></p></div>`;
  const ch = (id) => [{ op: "add_holidays", clndr_ids: [id], dates: k.calendars.find((c) => c.clndr_id === id).missing.map((m) => m.date) }];
  el.querySelectorAll("[data-fix]").forEach((b) => (b.onclick = () => downloadPost(`/api/uploads/${uid}/xer_patch`, { changes: ch(b.dataset.fix) }, "holidays.xer")));
  el.querySelectorAll("[data-wi]").forEach((b) => (b.onclick = async () => { $("#kWi").innerHTML = whatifResult(await api(`/api/uploads/${uid}/whatif`, { method: "POST", json: { changes: ch(b.dataset.wi) } })); }));
  $("#kSave").onclick = async () => {
    const wd = Object.fromEntries([...el.querySelectorAll("[data-m]")].filter((x) => x.value !== "").map((x) => [x.dataset.m, +x.value]));
    await api(`/api/uploads/${uid}/settings`, { method: "PUT", json: { weather_days: wd } }); tabKorea(el, r, uid);
  };
}

// ---------------------------------------------------------------- 룩어헤드·PPC
const REASONS = ["선행작업 미완료", "자재 미입고", "인력 부족", "장비 고장", "도면·설계 변경", "기상", "검측·승인 지연", "기타"];
async function tabLookahead(el, r, uid) {
  const [la, p] = await Promise.all([api(`/api/uploads/${uid}/lookahead`), api(`/api/uploads/${uid}/ppc`)]);
  const thisWeek = la.weeks[0];
  el.innerHTML = `<div class="panel"><h3 style="margin-top:0">3주 룩어헤드 <span class="muted" style="font-size:13px">(${la.weeks[0]} 주부터)</span></h3>
      <p class="muted">CPM 일정에서 향후 3주 작업을 뽑았습니다. 협력업체가 이번 주에 하겠다고 약속한 작업을 등록하고, 주말에 완료 여부를 체크하면 PPC(계획 대비 완료율)가 집계됩니다. 착수를 막는 제약(도면·자재 등)도 함께 관리하세요.</p>
      <div class="scroll"><table class="t la"><thead><tr><th>ID</th><th>작업</th><th>기간</th><th class="num">TF</th>${la.weeks.map((w) => `<th>${w.slice(5)} 주</th>`).join("")}<th>제약</th><th>이번 주 약속</th></tr></thead><tbody>
      ${la.rows.map((a) => {
        const c = a.commitments.find((x) => x.week === thisWeek);
        return `<tr><td>${esc(a.code)}</td><td class="wrap">${esc(a.name)}${a.longest ? ' <span class="tag crit">주공정</span>' : ""}</td><td style="font-size:12px">${a.start.slice(5)}~${a.finish.slice(5)}</td><td class="num">${fmtDays(a.tf)}</td>
        ${la.weeks.map((w) => `<td class="wk ${a.weeks.includes(w) ? (a.longest ? "on crit" : "on") : ""}"></td>`).join("")}
        <td>${a.constraints.map((x) => `<span class="tag fail" title="${esc(x.desc)}">${esc(x.type)}</span>`).join(" ")} <button class="btn sm" data-con="${esc(a.code)}">+</button></td>
        <td>${c ? `<label><input type="checkbox" data-done="${c.id}" ${c.done ? "checked" : ""}> ${esc(c.company || "")}</label>
            ${!c.done ? `<select class="s sm" data-reason="${c.id}"><option value="">미완료 사유</option>${REASONS.map((x) => `<option ${c.reason === x ? "selected" : ""}>${x}</option>`).join("")}</select>` : ""}`
          : `<button class="btn sm" data-commit="${esc(a.code)}" data-name="${esc(a.name)}">약속 등록</button>`}</td></tr>`;
      }).join("")}</tbody></table></div></div>
    <div class="grid2"><div class="panel"><h3 style="margin-top:0">주간 PPC</h3><canvas id="ppcCv" style="width:100%;height:200px"></canvas>
      <table class="t"><tbody>${p.weeks.map((w) => `<tr><td>${w.week}</td><td class="num">${w.done}/${w.planned}</td><td class="num"><b>${w.ppc ?? "-"}%</b></td></tr>`).join("") || '<tr><td class="muted">아직 약속이 없습니다.</td></tr>'}</tbody></table></div>
      <div class="panel"><h3 style="margin-top:0">미완료 사유 · 협력업체별 PPC</h3>
      ${p.reasons.map(([k, v]) => `<div class="hbar"><span>${esc(k)}</span><div><i style="width:${(100 * v) / p.reasons[0][1]}%;background:var(--warn)"></i></div><b>${v}</b></div>`).join("") || '<p class="muted">없음</p>'}
      <table class="t" style="margin-top:10px"><tbody>${p.companies.map((c) => `<tr><td>${esc(c.company)}</td><td class="num">${c.done}/${c.planned}</td><td class="num">${c.ppc}%</td></tr>`).join("")}</tbody></table></div></div>
    <div class="panel"><h3 style="margin-top:0">제약 로그</h3><table class="t"><thead><tr><th>ID</th><th>유형</th><th>내용</th><th>담당</th><th>해소 기한</th><th>상태</th><th></th></tr></thead><tbody>
      ${la.constraints.map((x) => `<tr><td>${esc(x.code)}</td><td>${esc(x.type)}</td><td class="wrap">${esc(x.desc)}</td><td>${esc(x.owner || "")}</td>
        <td style="color:${x.status !== "해결" && x.due && x.due < la.data_date ? "var(--crit)" : ""}">${x.due || ""}</td>
        <td><select class="s sm" data-cst="${x.id}">${["미해결", "진행", "해결"].map((s) => `<option ${x.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></td>
        <td><button class="btn sm danger" data-cdel="${x.id}">삭제</button></td></tr>`).join("") || '<tr><td colspan="7" class="muted">등록된 제약이 없습니다.</td></tr>'}</tbody></table></div>`;
  const save = (kind, body) => api(`/api/uploads/${uid}/records/${kind}`, { method: "POST", json: body });
  const reload = () => tabLookahead(el, r, uid);
  el.querySelectorAll("[data-commit]").forEach((b) => (b.onclick = async () => {
    const v = await ui.form(`${b.dataset.commit} 이번 주 약속 등록`, [
      { name: "company", label: "수행 협력업체", value: store.get("lastCompany"), required: true },
      { name: "note", label: "메모(선택)", placeholder: "예: 2층 구간 완료 목표" }], { submit: "등록" });
    if (!v) return;
    store.set("lastCompany", v.company); await save("commit", { week: thisWeek, code: b.dataset.commit, name: b.dataset.name, company: v.company, note: v.note, done: false }); reload();
  }));
  const commits = la.rows.flatMap((a) => a.commitments);
  el.querySelectorAll("[data-done]").forEach((c) => (c.onchange = async () => { const x = commits.find((y) => y.id === c.dataset.done); await save("commit", { ...x, done: c.checked, reason: c.checked ? "" : x.reason }); reload(); }));
  el.querySelectorAll("[data-reason]").forEach((c) => (c.onchange = async () => { const x = commits.find((y) => y.id === c.dataset.reason); await save("commit", { ...x, reason: c.value }); }));
  el.querySelectorAll("[data-con]").forEach((b) => (b.onclick = async () => {
    const v = await ui.form(`${b.dataset.con} 제약 등록`, [
      { name: "type", label: "유형", type: "select", options: ["도면", "자재", "인력", "장비", "허가", "선행작업", "기타"], value: "자재" },
      { name: "desc", label: "내용", required: true, placeholder: "예: 철근 D25 입고 대기" },
      { name: "owner", label: "담당" }, { name: "due", label: "해소 기한", type: "date", value: thisWeek }], { submit: "등록" });
    if (!v) return;
    try { await save("constraint", { code: b.dataset.con, ...v, status: "미해결" }); reload(); } catch (e) { toast(e.message); }
  }));
  el.querySelectorAll("[data-cst]").forEach((sel) => (sel.onchange = async () => { const x = la.constraints.find((y) => y.id === sel.dataset.cst); await save("constraint", { ...x, status: sel.value }); }));
  el.querySelectorAll("[data-cdel]").forEach((b) => (b.onclick = async () => { await api(`/api/uploads/${uid}/records/constraint/${b.dataset.cdel}`, { method: "DELETE" }); reload(); }));
  if (p.weeks.length) lineChart($("#ppcCv"), p.weeks.map((w) => w.week.slice(5)), [{ name: "PPC %", color: "#2563eb", values: p.weeks.map((w) => w.ppc), dots: true }, { name: "목표 80%", color: "#9ca3af", values: p.weeks.map(() => 80), dash: [4, 4] }], { min: 0, max: 100, left: 30 });
}

// ---------------------------------------------------------------- 설정
async function tabSettings(el, r, uid) {
  const [st, defs] = await Promise.all([api(`/api/uploads/${uid}/settings`), api("/api/metrics/defaults")]);
  const ov = st.metric_overrides;
  el.innerHTML = `<div class="panel"><h3 style="margin-top:0">일정 계산 옵션</h3>
      <label><input type="checkbox" id="optPO" ${st.schedule_options.progress_override ? "checked" : ""}> Progress Override (착수된 작업은 선행 논리를 무시하고 Data Date부터 잔여 작업 진행)</label>
      <p class="muted">기본값은 Retained Logic(P6 기본)입니다. P6의 Schedule Options와 같게 맞추면 'P6 일정 비교' 일치율이 올라갑니다. 변경하면 이 프로젝트의 모든 업데이트를 다시 계산합니다.</p>
      <button class="btn primary" id="optSave" data-need="editor">저장 및 재계산</button></div>
    <div class="panel"><h3 style="margin-top:0">건전성 지표 기준값 (이 프로젝트)</h3>
      <p class="muted">비워 두면 팀 기본값(${Object.keys(st.team_metric_overrides).length ? "관리자 설정" : "표준값"})을 씁니다. 가중치 0은 점수에서 제외합니다.</p>
      <div class="scroll"><table class="t"><thead><tr><th>ID</th><th>그룹</th><th>항목</th><th>비교</th><th>기본 기준</th><th>기준</th><th>가중치</th><th>사용</th></tr></thead><tbody>
      ${defs.map((d) => { const o = ov[d.id] || {}; return `<tr><td>${d.id}</td><td>${d.group}</td><td>${esc(d.name)}</td><td>${d.cmp === "le" ? "≤" : d.cmp === "ge" ? "≥" : "참고"}</td><td>${d.threshold ?? "-"}${d.unit === "%" ? "%" : ""}</td>
        <td><input class="s" style="width:70px" data-id="${d.id}" data-k="threshold" value="${o.threshold ?? ""}" ${d.cmp === "info" ? "disabled" : ""}></td>
        <td><input class="s" style="width:60px" data-id="${d.id}" data-k="weight" value="${o.weight ?? ""}" placeholder="${d.weight}"></td>
        <td><input type="checkbox" data-id="${d.id}" data-k="enabled" ${o.enabled === false ? "" : "checked"}></td></tr>`; }).join("")}</tbody></table></div>
      <div class="row end"><button class="btn primary" id="mSave" data-need="editor">기준값 저장</button></div></div>`;
  $("#optSave").onclick = () => withBusy($("#optSave"), async () => { await api(`/api/uploads/${uid}/settings`, { method: "PUT", json: { schedule_options: { progress_override: $("#optPO").checked } } }); cache = {}; toast("재계산했습니다"); });
  $("#mSave").onclick = () => withBusy($("#mSave"), async () => {
    const out = {};
    el.querySelectorAll("[data-id]").forEach((x) => {
      const o = (out[x.dataset.id] ||= {});
      if (x.type === "checkbox") { if (!x.checked) o.enabled = false; } else if (x.value !== "") o[x.dataset.k] = +x.value;
    });
    await api(`/api/uploads/${uid}/settings`, { method: "PUT", json: { metric_overrides: Object.fromEntries(Object.entries(out).filter(([, v]) => Object.keys(v).length)) } });
    toast("저장했습니다");
  });
}

// ---------------------------------------------------------------- 새 공정표 만들기
async function showGenerate() {
  const [tpls, st] = await Promise.all([api("/api/templates"), getAiStatus()]);
  let dlg = $("#dlgGen");
  if (!dlg) { dlg = document.createElement("dialog"); dlg.id = "dlgGen"; document.body.appendChild(dlg); }
  dlg.innerHTML = `<form method="dialog" id="fGen"><h3>새 공정표 만들기</h3>
    <label>프로젝트명<input name="project" required></label><label>착공일<input name="start" type="date" required value="${new Date().toISOString().slice(0, 10)}"></label>
    <div class="seg"><label><input type="radio" name="mode" value="template" checked> 표준 템플릿</label><label><input type="radio" name="mode" value="ai" ${st.enabled ? "" : "disabled"}> ✦ 문서로 AI 생성${st.enabled ? "" : " (AI 미설정)"}</label></div>
    <div id="gTpl"><label>템플릿<select name="template">${tpls.map((t) => `<option value="${t.key}">${esc(t.name)} · ${t.activities}개 작업</option>`).join("")}</select></label>
      <label>공기 배율<input name="scale" type="number" step="0.1" value="1.0"></label></div>
    <div id="gAi" hidden><label>목표 공기(달력일, 선택)<input name="target_days" type="number"></label>
      <label>입찰·설계 문서 (PDF, DOCX, TXT · 20MB 이하)<input name="file" type="file" accept=".pdf,.docx,.txt"></label>
      <label>또는 내용 붙여넣기<textarea name="text" rows="5" style="width:100%"></textarea></label>
      <p class="muted" style="font-size:12px">문서 내용이 AI 서비스로 전송됩니다. 생성된 공정표는 초안이며 공기·논리를 반드시 검토하세요.</p></div>
    <div class="row end"><button class="btn" value="cancel" formnovalidate>취소</button><button class="btn primary" value="ok" id="gRun">만들기</button></div><p class="err" id="gErr"></p></form>`;
  const f = $("#fGen");
  f.querySelectorAll("[name=mode]").forEach((x) => (x.onchange = () => { $("#gTpl").hidden = f.mode.value !== "template"; $("#gAi").hidden = f.mode.value !== "ai"; }));
  f.onsubmit = async (e) => {
    if (e.submitter?.value !== "ok") return; e.preventDefault();
    const fd = new FormData(f); if (!f.file?.files?.length) fd.delete("file");
    await withBusy($("#gRun"), async () => {
      try {
        const res = await api("/api/generate", { method: "POST", body: fd });
        dlg.close(); if (res.assumptions?.length) ui.notice("AI가 사용한 가정", `<ul>${res.assumptions.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><p class="muted">초안입니다. 공기와 논리를 반드시 검토하세요.</p>`);
        location.hash = `#/p/${res.id}/gantt`;
      } catch (err) { $("#gErr").textContent = err.message; }
    }).catch(() => {});
  };
  dlg.showModal();
}

// ---------------------------------------------------------------- 로그인
let loginWait = null;
function showLogin() {
  if (loginWait) return loginWait;
  let dlg = $("#dlgLogin");
  if (!dlg) {
    dlg = document.createElement("dialog"); dlg.id = "dlgLogin";
    dlg.innerHTML = `<form method="dialog" id="fLogin"><h3>로그인</h3><label>아이디<input name="username" autocomplete="username" required></label>
      <label>비밀번호<input name="password" type="password" autocomplete="current-password" required></label>
      <div class="row end"><button class="btn primary" value="ok">로그인</button></div><p class="err" id="lgErr"></p></form>`;
    dlg.addEventListener("cancel", (e) => e.preventDefault());
    document.body.appendChild(dlg);
  }
  loginWait = new Promise((resolve) => {
    $("#fLogin").onsubmit = async (e) => {
      e.preventDefault();
      const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
      if (!r.ok) { $("#lgErr").textContent = (await r.json()).detail; return; }
      dlg.close(); loginWait = null; refreshMe(); resolve();
    };
    dlg.showModal();
  });
  return loginWait;
}
let me = null;
async function refreshMe() {
  try { me = await (await fetch("/api/me")).json(); } catch { me = null; }
  document.body.dataset.role = me?.role || "admin"; applyRole();
  const box = $("#userBox"); if (!box) return;
  const roleKo = { viewer: "조회", editor: "편집", admin: "관리자" };
  box.innerHTML = `<a href="#/learn">🎓 학습</a><button class="linkbtn" onclick="toggleTheme()" title="밝게/어둡게">◐ 테마</button><button class="linkbtn" onclick="showShortcuts()">⌨ 단축키</button>`
    + (me?.username ? `<span>${esc(me.username)} <span class="tag">${roleKo[me.role]}</span></span>${me.role === "admin" ? ' <a href="#/admin">관리</a>' : ""} <a href="#" id="lnkLogout">로그아웃</a>`
    : me?.mode === "open" ? '<a href="#/admin">관리</a>' : "");
  $("#lnkLogout")?.addEventListener("click", async (e) => { e.preventDefault(); await fetch("/api/logout", { method: "POST", headers: { "X-Requested-With": "fetch" } }); location.reload(); });
}

// ---------------------------------------------------------------- 관리자
async function showAdmin() {
  $("#crumb").textContent = "/ 관리";
  const [users, audit, aist, cfg] = await Promise.all([api("/api/admin/users").catch(() => []), api("/api/admin/audit").catch(() => []), api("/api/ai/status"), fetch("/api/config").then((x) => x.json())]);
  const anyUid = (await api("/api/uploads"))[0]?.id;
  const st = anyUid ? await api(`/api/uploads/${anyUid}/settings`) : { extra_holidays: [] };
  view.innerHTML = `<h2>관리</h2>
    <div class="panel"><h3 style="margin-top:0">사용자</h3>${cfg.login_required ? "" : `<p class="warn-text">아직 사용자 계정이 없어 누구나 접근할 수 있는 공개 모드입니다. 서버에서 <code>python -m app.auth create-admin 아이디</code>로 관리자를 만들거나 <code>ADMIN_USERNAME</code>/<code>ADMIN_PASSWORD</code> 환경변수를 설정하면 로그인이 켜집니다.</p>`}
      <table class="t"><thead><tr><th>아이디</th><th>역할</th><th>상태</th><th>최근 로그인</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr><td>${esc(u.username)}</td><td><select class="s sm" data-role="${esc(u.username)}">${["viewer", "editor", "admin"].map((r) => `<option ${u.role === r ? "selected" : ""}>${r}</option>`).join("")}</select></td>
        <td>${u.active ? "사용" : '<span class="tag fail">중지</span>'}</td><td>${(u.last_login || "").replace("T", " ")}</td>
        <td><button class="btn sm" data-act="${esc(u.username)}" data-v="${u.active ? 0 : 1}">${u.active ? "중지" : "재사용"}</button> <button class="btn sm" data-pw="${esc(u.username)}">비밀번호 재설정</button></td></tr>`).join("")}</tbody></table>
      ${cfg.login_required ? `<div class="row" style="margin-top:8px"><input class="s" id="nu" placeholder="아이디"><input class="s" id="np" type="password" placeholder="임시 비밀번호(10자 이상)">
        <select class="s" id="nr"><option>viewer</option><option selected>editor</option><option>admin</option></select><button class="btn primary" id="nAdd">추가</button></div>
        <p class="muted" style="font-size:12px">viewer: 조회·What-if 계산 / editor: 업로드·AI·리스크·시나리오 편집 / admin: 삭제·사용자·팀 설정</p>` : ""}</div>
    <div class="panel"><h3 style="margin-top:0">추가 휴일 (임시공휴일·선거일 등)</h3>
      <textarea id="exHol" rows="4" style="width:100%" placeholder="2026-06-03 지방선거">${st.extra_holidays.map((h) => `${h.date} ${h.name}`).join("\n")}</textarea>
      <div class="row end"><button class="btn primary" id="hSave">저장</button></div></div>
    <div class="panel"><h3 style="margin-top:0">AI 사용량</h3><p class="muted">모델 ${esc(aist.model)} · ${aist.enabled ? "사용 중" : "미설정"}</p>
      <table class="t"><thead><tr><th>기능</th><th class="num">호출</th><th class="num">입력 토큰</th><th class="num">출력 토큰</th><th class="num">실패</th></tr></thead><tbody>
      ${aist.usage.map((u) => `<tr><td>${esc(u.feature)}</td><td class="num">${u.n}</td><td class="num">${(u.tin || 0).toLocaleString()}</td><td class="num">${(u.tout || 0).toLocaleString()}</td><td class="num">${u.failed}</td></tr>`).join("") || '<tr><td class="muted">기록 없음</td></tr>'}</tbody></table></div>
    <div class="panel"><h3 style="margin-top:0">감사 로그 (최근 300건)</h3><div class="scroll"><table class="t"><thead><tr><th>시각</th><th>사용자</th><th>요청</th><th class="num">결과</th></tr></thead><tbody>
      ${audit.map((a) => `<tr><td>${a.at.replace("T", " ")}</td><td>${esc(a.username)}</td><td>${a.method} ${esc(a.path)}</td><td class="num">${a.status}</td></tr>`).join("")}</tbody></table></div></div>`;
  const reload = () => showAdmin();
  view.querySelectorAll("[data-role]").forEach((s) => (s.onchange = async () => { try { await api(`/api/admin/users/${encodeURIComponent(s.dataset.role)}`, { method: "PUT", json: { role: s.value } }); toast("변경했습니다"); } catch (e) { reload(); } }));
  view.querySelectorAll("[data-act]").forEach((b) => (b.onclick = async () => { await api(`/api/admin/users/${encodeURIComponent(b.dataset.act)}`, { method: "PUT", json: { active: b.dataset.v === "1" } }).catch(() => {}); reload(); }));
  view.querySelectorAll("[data-pw]").forEach((b) => (b.onclick = async () => { const v = await ui.form(`${b.dataset.pw} 비밀번호 재설정`, [{ name: "pw", label: "새 비밀번호 (10자 이상)", type: "password", required: true }]); const pw = v?.pw; if (pw) { await api(`/api/admin/users/${encodeURIComponent(b.dataset.pw)}`, { method: "PUT", json: { password: pw } }).catch(() => {}); toast("변경했습니다"); } }));
  $("#nAdd")?.addEventListener("click", async () => { await api("/api/admin/users", { method: "POST", json: { username: $("#nu").value, password: $("#np").value, role: $("#nr").value } }).catch(() => {}); reload(); });
  $("#hSave").onclick = async () => {
    const hs = $("#exHol").value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => ({ date: l.slice(0, 10), name: l.slice(11).trim() }));
    await api("/api/settings/team", { method: "PUT", json: { extra_holidays: hs } }); toast("저장했습니다");
  };
}

// ---------------------------------------------------------------- A3 인쇄용 공정표
async function showPrint(uid) {
  const u = await load(uid); const r = u.result;
  const acts = r.activities.filter((a) => a.status_code !== "TK_Complete" || !store.get("printHideDone"));
  const t0 = Math.min(...acts.map((a) => toT(a.start))) - 7 * dayMs, t1 = Math.max(...acts.map((a) => toT(a.finish))) + 14 * dayMs;
  const W = 1500, L = 560, RH = 16, rowsPerPage = 52;
  const X = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - 10);
  const months = monthTicks(t0, t1);
  const rows = []; let last = null;
  for (const a of acts) { if (a.wbs !== last) { rows.push({ wbs: a.wbs || "(WBS 없음)" }); last = a.wbs; } rows.push(a); }
  const pages = []; for (let i = 0; i < rows.length; i += rowsPerPage) pages.push(rows.slice(i, i + rowsPerPage));
  const head = `<g font-size="10" fill="#111">${months.map((t) => `<line x1="${X(t)}" y1="0" x2="${X(t)}" y2="${rowsPerPage * RH + 30}" stroke="#e5e7eb"/><text x="${X(t) + 2}" y="12">${new Date(t).getFullYear() % 100}.${new Date(t).getMonth() + 1}</text>`).join("")}
    <text x="4" y="24" font-weight="bold">ID</text><text x="70" y="24" font-weight="bold">액티비티명</text><text x="380" y="24" font-weight="bold">잔여</text><text x="410" y="24" font-weight="bold">시작</text><text x="470" y="24" font-weight="bold">종료</text><text x="530" y="24" font-weight="bold">TF</text></g>`;
  $("#crumb").textContent = "/ 인쇄";
  view.innerHTML = `<div class="noprint row" style="margin-bottom:10px"><button class="btn primary" onclick="window.print()">인쇄 / PDF 저장</button>
      <a class="btn" href="#/p/${uid}/gantt">돌아가기</a><span class="muted">A3 가로에 맞춰 ${pages.length}쪽으로 나눕니다. 브라우저 인쇄에서 'PDF로 저장'을 고르세요.</span></div>
    ${pages.map((pg, pi) => `<div class="print-page"><div class="ph"><b>${esc(r.name)}</b> 공정표 · Data Date ${r.data_date} · 예상 준공 ${r.finish}<span>${pi + 1} / ${pages.length}</span></div>
      <svg viewBox="0 0 ${W} ${rowsPerPage * RH + 34}" width="100%" font-family="sans-serif">${head}<g transform="translate(0,30)">
      ${pg.map((a, i) => { const y = i * RH; if (!a.id) return `<rect x="0" y="${y}" width="${W}" height="${RH}" fill="#f3f4f6"/><text x="4" y="${y + 11}" font-size="10" font-weight="bold">${esc(a.wbs)}</text>`;
        const s = toT(a.start), f = toT(a.finish) + dayMs, col = a.status_code === "TK_Complete" ? "#9ca3af" : a.longest || a.critical ? "#dc2626" : "#3b82f6";
        const bar = a.milestone ? `<path d="M${X(s)} ${y + 3} l5 5 l-5 5 l-5 -5z" fill="${col}"/>` : `<rect x="${X(s)}" y="${y + 4}" width="${Math.max(1.5, X(f) - X(s))}" height="8" fill="${col}"/>`;
        return `<text x="4" y="${y + 11}" font-size="9">${esc(a.code)}</text><text x="70" y="${y + 11}" font-size="9" fill="${a.longest ? "#b91c1c" : "#111"}">${esc(a.name.slice(0, 40))}</text>
          <text x="380" y="${y + 11}" font-size="9">${a.rem_dur}</text><text x="410" y="${y + 11}" font-size="9">${a.start.slice(2)}</text><text x="470" y="${y + 11}" font-size="9">${a.finish.slice(2)}</text><text x="530" y="${y + 11}" font-size="9">${a.tf ?? ""}</text>${bar}
          <line x1="0" y1="${y + RH}" x2="${W}" y2="${y + RH}" stroke="#f1f3f5"/>`; }).join("")}
      <line x1="${X(toT(r.data_date))}" y1="0" x2="${X(toT(r.data_date))}" y2="${pg.length * RH}" stroke="#16a34a" stroke-dasharray="4 3"/></g></svg>
      <div class="pf">빨강: 최장경로/주공정 · 파랑: 일반 · 회색: 완료 · 초록 점선: Data Date</div></div>`).join("")}`;
}

document.addEventListener("DOMContentLoaded", refreshMe);

// ================================================================ 3차: 화면 통합
function subTabs(el, items, key) {
  const cur = sessionStorage.getItem(key) || items[0][0];
  el.innerHTML = `<div class="seg-tabs" role="tablist">${items.map(([k, l]) => `<button role="tab" aria-selected="${k === cur}" class="${k === cur ? "on" : ""}" data-k="${k}">${l}</button>`).join("")}</div><div class="sub"></div>`;
  el.querySelectorAll(".seg-tabs button").forEach((b) => (b.onclick = () => { sessionStorage.setItem(key, b.dataset.k); subTabs(el, items, key); }));
  const it = items.find(([k]) => k === cur) || items[0];
  const sub = el.querySelector(".sub"); sub.dataset.uid = el.dataset.uid;
  it[2](sub);
}
async function tabAnalysis(el, r, uid) {
  subTabs(el, [["delay", "지연 원인", (s) => tabDelay(s, r, uid)], ["forensic", "변경 로그·압축·추세", (s) => tabForensic(s, r, uid)]], "sub:analysis");
}
const _tabHealthOnly = tabHealth;
tabHealth = async function (el, r, uid) {
  subTabs(el, [["score", "건전성 점수 (34개 지표)", (s) => _tabHealthOnly(s, r, uid)], ["dcma", "DCMA 14-Point와 조치 가이드", (s) => tabDcma(s, r)]], "sub:health");
};
const _tabRiskOnly = tabRisk;
tabRisk = async function (el, r, uid) {
  subTabs(el, [["reg", "리스크 레지스터·시뮬레이션", (s) => _tabRiskOnly(s, r, uid)], ["pred", "지연 예측·위험 점수", (s) => tabPredict(s, r, uid)]], "sub:risk");
};

// ---------------------------------------------------------------- ⑦ 홈: 오늘 확인할 것 + 관심 프로젝트
async function renderInbox(container) {
  const items = await api("/api/inbox").catch(() => []);
  const favs = JSON.parse(store.get("favs", "[]"));
  const mine = favs.length ? items.filter((x) => favs.includes(x.project)) : items;
  const rest = favs.length ? items.filter((x) => !favs.includes(x.project)) : [];
  const row = (x) => `<a class="inbox-item ${x.level}" href="#/p/${x.uid}/${x.tab}"><span class="sev" aria-label="${x.level === "high" ? "높음" : "보통"}">${x.level === "high" ? "✕" : "!"}</span>
    <b>${esc(x.project)}</b><span>${esc(x.text)}</span><span class="go">→</span></a>`;
  container.innerHTML = `<div class="panel"><div class="row" style="justify-content:space-between"><h3 style="margin:0">오늘 확인할 것 <span class="muted">(${items.length})</span></h3>
      <span class="muted" style="font-size:12px">${favs.length ? "★ 관심 프로젝트 우선" : "프로젝트 이름 옆 ★로 관심 프로젝트를 지정하세요"}</span></div>
    ${items.length ? `<div class="inbox">${mine.map(row).join("")}${rest.length ? `<details><summary class="muted">다른 프로젝트 ${rest.length}건</summary>${rest.map(row).join("")}</details>` : ""}</div>`
      : '<p class="muted">확인할 항목이 없습니다. 👍</p>'}</div>`;
}
