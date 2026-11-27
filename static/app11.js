"use strict";
// ================================================================ PMS P3 (PMS 대시보드): 이슈 보드, AI 브리핑, 포트폴리오 질의

const SEV = { bad: ["bad", "위험"], warn: ["warn", "주의"] };
const IST = { new: "새로", ack: "확인", doing: "조치 중", resolved: "해결" };
const qs = () => new URLSearchParams(location.hash.split("?")[1] || "");

async function dashboardTop() {
  const [sum, list, brief] = await Promise.all([api("/api/issues/summary").catch(() => null), api("/api/issues").catch(() => []), api("/api/dashboard/briefing").catch(() => null)]);
  if (!sum) return;
  const box = document.createElement("div"); box.id = "issueBoard";
  box.innerHTML = `<div class="ib-grid">
    <div class="panel ib-sum"><h3 class="mt0">이슈</h3>
      <div class="ib-kpis"><a href="#/issues" class="ib-k bad"><span>위험</span><b>${sum.bad}</b></a><a href="#/issues" class="ib-k warn"><span>주의</span><b>${sum.open - sum.bad}</b></a>
        <a href="#/issues?status=new" class="ib-k"><span>새로</span><b>${sum.new}</b></a></div>
      <div class="inbox mt12">${list.slice(0, 5).map(issueRow).join("") || emptyState("열린 이슈가 없습니다 👍")}</div>
      ${list.length > 5 ? `<a class="btn sm mt8" href="#/issues">이슈 ${list.length}건 모두 보기 →</a>` : ""}</div>
    <div class="panel ib-brief"><div class="row between"><h3 class="m0">${icon("sparkles", 18)} 이번 주 브리핑</h3>
      <span class="row"><span class="chip">${brief?.method === "AI" ? "AI 작성" : "규칙 기반"}</span><button class="btn sm ghost" id="briefRe" title="다시 만들기">${icon("refresh", 14)}</button></span></div>
      <div class="brief-text" id="briefText">${brief ? md(brief.text) : '<p class="muted">브리핑을 만들 수 없습니다</p>'}</div>
      <p class="muted fs12">${brief?.at ? `${brief.at.replace("T", " ").slice(5, 16)} 작성` : ""} · 숫자는 대시보드 자료 기준이며 AI 금지 프로젝트는 AI에 보내지 않습니다</p>
      <form id="askForm" class="ask"><label class="sr-only" for="askQ">포트폴리오에 질문</label><input class="s" id="askQ" placeholder="전사 프로젝트에 질문 (예: 이번 달 마일스톤이 위험한 현장은?)">
        <button class="btn primary">질문</button></form><div id="askOut" class="ask-out" aria-live="polite"></div></div></div>`;
  view.querySelector(".page-head")?.after(box);
  bindIssueRows(box);
  $("#briefRe").onclick = () => withBusy($("#briefRe"), async () => { const b = await api("/api/dashboard/briefing?refresh=1"); $("#briefText").innerHTML = md(b.text); toast(b.method === "AI" ? "AI 브리핑을 다시 만들었습니다" : "규칙 기반 브리핑입니다 (AI 사용 불가)"); });
  $("#askForm").onsubmit = async (e) => {
    e.preventDefault(); const q = $("#askQ").value.trim(); if (!q) return;
    $("#askOut").innerHTML = `<div class="sk" style="height:60px"></div>`;
    try { const r = await api("/api/dashboard/ask", { method: "POST", json: { q } }); $("#askOut").innerHTML = `<div class="ai-box">${md(r.answer)}<p class="muted fs12">프로젝트 ${r.projects}개 자료 기준${r.excluded ? ` · AI 금지 ${r.excluded}개 제외` : ""} · AI 작성</p></div>`; }
    catch (err) { $("#askOut").innerHTML = `<p class="warn-text">${esc(err.message)}</p>`; }
  };
}
function issueRow(x) {
  return `<div class="inbox-item ${x.severity === "bad" ? "high" : "mid"}"><span class="sev">${x.severity === "bad" ? "✕" : "!"}</span>
    <a href="#/issues?id=${x.id}" data-issue="${x.id}"><b>${esc(x.project)}</b> ${esc(x.title)} <span class="muted fs12">· ${IST[x.status]}${x.occurrences > 1 ? ` · ${x.occurrences}회 지속` : ""}${x.assignee ? ` · 👤${esc(x.assignee)}` : ""}</span></a><span></span></div>`;
}
function bindIssueRows(root) {
  root.querySelectorAll("[data-issue]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); openIssue(a.dataset.issue); }));
}
async function openIssue(id) {
  const x = await api(`/api/issues/${id}`);
  const users = await userList();
  const canEdit = (me?.role || "admin") !== "viewer";
  const d = openDrawer(`${esc(x.project)} · 이슈`, `
    <div class="chips"><span class="status-badge ${SEV[x.severity][0]}">${SEV[x.severity][1]}</span><span class="chip">${esc(x.rule)}</span><span class="chip">${IST[x.status]}</span>${x.occurrences > 1 ? `<span class="chip warn">${x.occurrences}회 지속</span>` : ""}</div>
    <h3>${esc(x.title)}</h3><p class="pre">${esc(x.detail || "")}</p>
    <p class="muted fs12">처음 ${x.first_seen.replace("T", " ").slice(0, 16)} · 최근 ${x.last_seen.replace("T", " ").slice(0, 16)} · <a href="#/p/${x.upload_id}/overview">프로젝트 상황판 →</a></p>
    <div class="panel ai-panel"><div class="row between"><b>${icon("sparkles", 16)} 원인·조치 제안</b><button class="btn sm" id="isAi">${x.ai_text ? "다시 만들기" : "AI로 분석"}</button></div>
      <div id="isAiText">${x.ai_text ? md(x.ai_text) : '<p class="muted fs13">엔진의 지연 원인 분석을 근거로 원인 → 영향 → 권장 조치 → 담당을 정리합니다.</p>'}</div></div>
    ${canEdit ? `<h4>처리</h4><div class="row"><select class="s" id="isSt" aria-label="상태">${Object.entries(IST).map(([k, l]) => `<option value="${k}" ${x.status === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      <select class="s" id="isAs" aria-label="담당자"><option value="">담당자 없음</option>${users.map((u) => `<option ${x.assignee === u.username ? "selected" : ""}>${esc(u.username)}</option>`).join("")}</select></div>
      <label class="db mt8">메모<input class="s w100" id="isNote" placeholder="예: 협력사와 철골 반입 일정 재협의 (4/20)"></label><div class="row end"><button class="btn primary" id="isSave">저장</button></div>` : ""}
    <h4>이력</h4><ol class="is-hist">${x.history.slice().reverse().map((h) => `<li><span class="muted fs12">${h.at.replace("T", " ").slice(5, 16)}</span> ${esc(h.event)}${h.by ? ` · ${esc(h.by)}` : ""}${h.note ? `<div class="fs13">${esc(h.note)}</div>` : ""}</li>`).join("")}</ol>`, { width: "min(560px, 96vw)" });
  d.querySelector("#isAi").onclick = () => withBusy(d.querySelector("#isAi"), async () => {
    try { const r = await api(`/api/issues/${id}/ai`, { method: "POST", json: { refresh: !!x.ai_text } }); d.querySelector("#isAiText").innerHTML = md(r.text) + '<p class="muted fs12">AI 작성 · 확인 후 활용하세요</p>'; }
    catch (e) { d.querySelector("#isAiText").innerHTML = `<p class="warn-text">${esc(e.message)}</p>`; }
  });
  d.querySelector("#isSave")?.addEventListener("click", async () => {
    try {
      await api(`/api/issues/${id}`, { method: "POST", json: { status: d.querySelector("#isSt").value, assignee: d.querySelector("#isAs").value, note: d.querySelector("#isNote").value } });
      toast("저장했습니다"); openIssue(id); if (location.hash.startsWith("#/issues")) showIssues(true);
    } catch (e) { toast(e.message); }
  });
}
async function showIssues(keepDrawer = false) {
  $("#crumb").textContent = "/ 이슈"; ctx.uid = null;
  const q = qs();
  const st = { status: q.get("status") || "open", project: q.get("project") || "", sev: "" };
  view.innerHTML = `<div class="page-head"><div><h2>이슈</h2><p>게시될 때마다 규칙으로 찾은 공정 문제입니다. 조건이 풀리면 자동으로 해결됩니다.</p></div>
    ${me?.role === "admin" || !me?.username ? '<div class="row"><button class="btn" id="isEval">지금 다시 점검</button></div>' : ""}</div>
    <div class="row mb10"><div class="seg-tabs sm" role="group" aria-label="상태">${[["open", "열림"], ["new", "새로"], ["doing", "조치 중"], ["resolved", "해결"]].map(([k, l]) => `<button data-is="${k}" class="${st.status === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <select class="s sm" id="isSev" aria-label="심각도"><option value="">모든 심각도</option><option value="bad">위험</option><option value="warn">주의</option></select>
      <select class="s sm" id="isProj" aria-label="프로젝트"><option value="">모든 프로젝트</option></select></div><div id="isList"></div>`;
  const draw = async () => {
    const xs = await api(`/api/issues?status=${st.status}${st.project ? `&project=${encodeURIComponent(st.project)}` : ""}`);
    const projs = [...new Set(xs.map((x) => x.project))];
    if ($("#isProj").options.length === 1) $("#isProj").insertAdjacentHTML("beforeend", projs.map((p) => `<option ${p === st.project ? "selected" : ""}>${esc(p)}</option>`).join(""));
    const ys = xs.filter((x) => !st.sev || x.severity === st.sev);
    $("#isList").innerHTML = ys.length ? `<table class="t"><thead><tr><th>심각도</th><th>프로젝트</th><th>이슈</th><th>분류</th><th>상태</th><th>담당</th><th class="num">지속</th><th>최근</th></tr></thead><tbody>
      ${ys.map((x) => `<tr><td><span class="status-badge ${SEV[x.severity][0]}">${SEV[x.severity][1]}</span></td><td>${esc(x.project)}</td>
        <td class="wrap"><a href="#/issues?id=${x.id}" data-issue="${x.id}">${esc(x.title)}</a></td><td>${esc(x.rule)}</td><td>${IST[x.status]}</td><td>${esc(x.assignee || "")}</td>
        <td class="num">${x.occurrences}</td><td class="fs12">${x.last_seen.replace("T", " ").slice(5, 16)}</td></tr>`).join("")}</tbody></table>` : emptyState("해당하는 이슈가 없습니다");
    bindIssueRows($("#isList")); enhance($("#isList"));
  };
  view.querySelectorAll("[data-is]").forEach((b) => (b.onclick = () => { st.status = b.dataset.is; view.querySelectorAll("[data-is]").forEach((x) => x.classList.toggle("on", x === b)); draw(); }));
  $("#isSev").onchange = (e) => { st.sev = e.target.value; draw(); };
  $("#isProj").onchange = (e) => { st.project = e.target.value; draw(); };
  $("#isEval")?.addEventListener("click", () => withBusy($("#isEval"), async () => { await api("/api/admin/issues/evaluate", { method: "POST" }); toast("다시 점검했습니다"); draw(); }));
  await draw();
  if (q.get("id") && !keepDrawer) openIssue(q.get("id"));
}
// 대시보드 홈 맨 위에 이슈·브리핑
const _showList13 = showList;
showList = async function () { await _showList13(); if (isDashboard() && $(".page-head") && !$("#issueBoard")) await dashboardTop(); };
// 사이드바: 대시보드 판에 '이슈'
const _renderSide13 = renderSide;
renderSide = function () {
  _renderSide13();
  if (!isDashboard() || $("#side a[href='#/issues']")) return;
  $("#side a[href='#/']")?.insertAdjacentHTML("afterend", sideItem("#/issues", "alert", "이슈", location.hash.startsWith("#/issues")));
};
for (const fn of ["showIssues"]) { const o = window[fn]; eval(`${fn} = async function (...a) { ++navToken; return o(...a); }`); }

WHATSNEW["2.3"] = [
  { ic: "alert", t: "이슈 보드 (PMS 대시보드)", d: "게시될 때마다 준공 지연·직전 대비 악화·음수 여유·마일스톤·SPI·공정표 품질·의심 변경을 찾아 이슈로 만들고, 조건이 풀리면 자동 해결합니다.", go: "#/issues" },
  { ic: "sparkles", t: "이번 주 브리핑과 포트폴리오 질문", d: "대시보드 맨 위에서 꼭 볼 프로젝트와 이유를 보고, 전사 프로젝트에 질문할 수 있습니다. 이슈마다 AI 원인·조치 제안도 받을 수 있습니다." },
];
