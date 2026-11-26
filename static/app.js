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
  opts.headers = { ...(opts.headers || {}), "X-App-Token": store.get("token"), "X-User": encodeURIComponent(store.get("uploader")) };
  if (opts.json !== undefined) { opts.body = JSON.stringify(opts.json); opts.headers["Content-Type"] = "application/json"; delete opts.json; }
  const r = await fetch(path, opts);
  if (r.status === 401) {
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
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  try {
    if (parts[0] === "p" && parts[1]) return await showProject(parts[1], parts[2] || "overview");
    if (parts[0] === "cmp" && parts[1] && parts[2]) return await showCompare(parts[1], parts[2]);
    return await showList();
  } catch (err) {
    view.innerHTML = `<div class="panel err">오류: ${esc(err.message)}</div>`;
  }
}

// ---------------------------------------------------------------- 목록
async function showList() {
  $("#crumb").textContent = "";
  const list = await api("/api/uploads");
  if (!list.length) {
    view.innerHTML = `<div class="panel empty"><h2>업로드된 공정표가 없습니다</h2>
      <p>오른쪽 위 <b>XER 업로드</b> 버튼으로 Primavera P6에서 내보낸 XER 파일을 올려 보세요.</p></div>`;
    return;
  }
  view.innerHTML = `
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
            <button class="btn sm danger" data-del="${u.id}">삭제</button></td></tr>`).join("")}
      </tbody></table></div>
  </div>`;
  if (list.length > 1) $("#cmpA").selectedIndex = 1;
  $("#btnCmp").onclick = () => (location.hash = `#/cmp/${$("#cmpA").value}/${$("#cmpB").value}`);
  view.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!confirm("이 업로드를 삭제할까요? 팀 전체에서 사라집니다.")) return;
    await api(`/api/uploads/${b.dataset.del}`, { method: "DELETE" });
    delete cache[b.dataset.del];
    toast("삭제되었습니다"); showList();
  }));
  view.querySelectorAll("[data-xer]").forEach((b) => (b.onclick = () => download(`/api/uploads/${b.dataset.xer}/xer`, "project.xer")));
}

// ---------------------------------------------------------------- 프로젝트
const TABS = [["overview", "개요"], ["gantt", "공정표"], ["critical", "주공정"], ["dcma", "DCMA 14 점검"],
  ["scurve", "S-Curve"], ["p6", "P6 일정 비교"]];
const AI_TABS = [["chat", "✦ AI 어시스턴트"], ["report", "월간 보고서"], ["delay", "지연 원인"], ["whatif", "What-if"],
  ["rels", "관계 추천"], ["trades", "공종 분류"], ["risk", "리스크"], ["bench", "벤치마크"], ["daily", "작업일보 진도"]];
let aiStatus = null;
async function getAiStatus() { if (!aiStatus) aiStatus = await api("/api/ai/status"); return aiStatus; }

async function load(uid) {
  if (!cache[uid]) cache[uid] = await api(`/api/uploads/${uid}`);
  return cache[uid];
}

async function showProject(uid, tab) {
  const u = await load(uid);
  const r = u.result;
  $("#crumb").textContent = `/ ${r.name}`;
  view.innerHTML = `
    <div class="row" style="justify-content:space-between;margin-bottom:8px">
      <div><h2 style="margin:0">${esc(r.name)}</h2>
      <div class="muted">Data Date ${r.data_date} · 업로더 ${esc(u.uploader)} · ${esc(u.note || u.filename)}</div></div>
      <div class="row"><button class="btn" id="btnCsv">엑셀(CSV) 내보내기</button>
      <button class="btn" id="btnRecalc" title="최신 엔진으로 다시 계산">재계산</button></div>
    </div>
    ${r.warnings.map((w) => `<div class="panel err">⚠ ${esc(w)}</div>`).join("")}
    <nav class="tabs">${TABS.map(([k, l]) => `<a href="#/p/${uid}/${k}" class="${k === tab ? "on" : ""}">${l}</a>`).join("")}</nav>
    <nav class="tabs ai">${AI_TABS.map(([k, l]) => `<a href="#/p/${uid}/${k}" class="${k === tab ? "on" : ""}">${l}</a>`).join("")}</nav>
    <div id="tab"></div>`;
  $("#btnCsv").onclick = () => download(`/api/uploads/${uid}/activities.csv`, "activities.csv");
  $("#btnRecalc").onclick = async () => {
    await api(`/api/uploads/${uid}/recalc`, { method: "POST" });
    delete cache[uid]; toast("재계산 완료"); showProject(uid, tab);
  };
  const el = $("#tab");
  el.dataset.uid = uid;
  ({ overview: tabOverview, gantt: tabGantt, critical: tabCritical, dcma: tabDcma, scurve: tabScurve, p6: tabP6,
     chat: tabChat, report: tabReport, delay: tabDelay, whatif: tabWhatif, rels: tabRels, trades: tabTrades,
     risk: tabRisk, bench: tabBench, daily: tabDaily }[tab] || tabOverview)(el, r, uid);
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
  $("#btnDcmaAi").onclick = () => withBusy($("#btnDcmaAi"), async () => showGuide(await api(`/api/uploads/${uid}/dcma_guide?ai=1`)));
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
  el.innerHTML = `
    <div class="row" style="margin-bottom:10px">
      <input class="s" id="q" placeholder="ID / 이름 검색" style="width:220px">
      <label><input type="checkbox" id="fCrit"> 주공정/최장경로만</label>
      ${highlight.size ? `<label><input type="checkbox" id="fHl" checked> AI 답변 작업만 (${highlight.size})</label>` : ""}
      <label><input type="checkbox" id="fInc" checked> 완료 제외</label>
      <label><input type="checkbox" id="fBl" checked> 계획(Target) 표시</label>
      <label class="muted">배율 <select class="s" id="zoom"><option value="3">일</option><option value="1.2" selected>주</option><option value="0.35">월</option><option value="0.12">분기</option></select></label>
      <span class="spacer"></span>
      <div class="legend"><span><i style="background:var(--bar)"></i>일반</span><span><i style="background:var(--crit)"></i>주공정</span>
      <span><i style="background:var(--done)"></i>완료</span><span><i style="background:var(--bl);height:4px"></i>계획</span>
      <span><i style="background:#16a34a;width:2px"></i>Data Date</span></div>
    </div>
    <div class="gantt">
      <div class="g-left"><div class="g-row hdr"><div>ID</div><div>액티비티명</div><div>원공기</div><div>잔여</div><div>시작</div><div>종료</div><div>TF</div></div>
        <div class="g-body" id="gl"><div class="g-rows" id="glr"></div></div></div>
      <div class="g-right"><canvas class="g-head" id="gh"></canvas><div class="g-body" id="gr"><div id="grs"></div><canvas id="gc" style="position:sticky;top:0;left:0"></canvas></div></div>
    </div>
    <div class="panel detail" id="det"><span class="muted">행을 클릭하면 선·후행 관계를 볼 수 있습니다.</span></div>`;

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
      return `<div class="g-row ${cls}" data-id="${a.id}" style="top:${top}px"><div>${esc(a.code)}</div><div class="nm" title="${esc(a.name)}">${esc(a.name)}</div>
        <div class="num">${a.orig_dur}</div><div class="num">${a.rem_dur}</div><div>${a.start}</div><div>${a.finish}</div><div class="num">${fmtDays(a.tf)}</div></div>`;
    }).join("");
    // 캔버스
    const dpr = window.devicePixelRatio || 1;
    gc.width = W * dpr; gc.height = H * dpr; gc.style.width = W + "px"; gc.style.height = H + "px";
    gc.style.marginTop = -rows.length * RH + "px";
    gh.width = W * dpr; gh.height = 44 * dpr; gh.style.width = W + "px"; gh.style.height = "44px";
    const g = gc.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const h = gh.getContext("2d"); h.setTransform(dpr, 0, 0, dpr, 0, 0); h.fillStyle = "#f9fafb"; h.fillRect(0, 0, W, 44);
    const sx = gr.scrollLeft, sy = gr.scrollTop;
    const X = (t) => ((t - t0) / dayMs) * ppd - sx;
    // 눈금
    h.font = "11px sans-serif"; h.fillStyle = "#374151"; g.strokeStyle = "#eef0f3";
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
      if (!a.id) { g.fillStyle = "#f3f4f6"; g.fillRect(0, y, W, RH); continue; }
      if (sel === a.id) { g.fillStyle = "#dbeafe"; g.fillRect(0, y, W, RH); }
      const bl = $("#fBl").checked && a.bl_start && a.bl_finish;
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
      if (bl) { g.fillStyle = "#f59e0b"; const x = X(toT(a.bl_start)); g.fillRect(x, y + 18, Math.max(2, X(toT(a.bl_finish) + dayMs) - x), 4); }
      if (ppd >= 1) { g.fillStyle = "#374151"; g.font = "11px sans-serif"; g.fillText(a.name, X(f) + 8, y + 17); }
    }
    // 선택된 액티비티의 관계선
    if (sel) {
      const idx = Object.fromEntries(rows.map((a, i) => [a.id, i]));
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

route();

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
    <button class="btn primary" id="repGen">보고서 생성</button></div></div>
    <p class="muted">업데이트 비교(지연 원인), 주공정, 향후 1개월 작업, 리스크를 모아 보고서 초안을 만듭니다. 이전 업데이트는 같은 프로젝트 이름으로 자동 선택됩니다.</p>
    <div id="repBody"></div></div>`;
  draw(await api(`/api/uploads/${uid}/report`));
  $("#repGen").onclick = () => withBusy($("#repGen"), async () => draw(await api(`/api/uploads/${uid}/report?ai=${$("#repAi").checked ? 1 : 0}`, { method: "POST" })));
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
      <input class="s" id="wName" placeholder="시나리오 이름"><button class="btn" id="wSave">시나리오 저장</button>
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
    $("#wList").querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { if (confirm("삭제할까요?")) { await api(`/api/scenarios/${b.dataset.del}`, { method: "DELETE" }); loadList(); } }));
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
    <div class="row end"><button class="btn" id="rTest">선택 항목 What-if 검증</button><button class="btn" id="rSave">시나리오로 저장</button><button class="btn primary" id="rXer">선택 반영 XER 다운로드</button></div></div>
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
  $("#rAi").onclick = () => withBusy($("#rAi"), async () => draw(await api(`/api/uploads/${uid}/rel_suggest?ai=1`)));
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
    <div class="row"><button class="btn" id="tRule">규칙으로 재분류</button><button class="btn primary" id="tAi" ${st.enabled ? "" : "disabled"}>✦ AI 분류·표준화</button></div></div>
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
  $("#tAi").onclick = () => withBusy($("#tAi"), async () => draw(await api(`/api/uploads/${uid}/trades?ai=1`, { method: "POST" })));
}

// ---------------------------------------------------------------- ⑧⑨ 리스크
async function tabRisk(el, r, uid) {
  el.innerHTML = `<div class="panel"><div class="row" style="justify-content:space-between"><h3 style="margin:0">준공 리스크 (몬테카를로)</h3>
    <div class="row"><label class="muted">반복 <input class="s" id="mcN" type="number" value="500" style="width:80px"></label><button class="btn primary" id="mcRun">시뮬레이션 실행</button></div></div>
    <div id="mcBody" class="muted" style="margin-top:8px">잔여공기 불확실성을 반영해 준공일 분포를 계산합니다.</div></div>
    <div class="panel"><h3 style="margin-top:0">지연 위험 작업</h3><div id="rkBody" class="muted">계산 중...</div></div>`;
  $("#mcRun").onclick = () => withBusy($("#mcRun"), async () => {
    const m = await api(`/api/uploads/${uid}/montecarlo?n=${$("#mcN").value}`);
    $("#mcBody").classList.remove("muted");
    $("#mcBody").innerHTML = `<div class="kpis">${kpi("결정론적 준공", m.deterministic)}${kpi("P50", m.p50)}${kpi("P80", m.p80, "crit")}${kpi("P90", m.p90)}
      ${m.prob_meet_target !== null ? kpi(`목표(${m.must_finish}) 달성 확률`, m.prob_meet_target + "%", m.prob_meet_target < 50 ? "crit" : "") : ""}</div>
      <canvas id="mcHist" style="width:100%;height:200px"></canvas>
      <p class="muted">${esc(m.assumption)} · 반복 ${m.iterations}회</p>
      <h4>주공정 지수 (시뮬레이션 중 최장경로에 포함된 비율)</h4>
      <table class="t"><thead><tr><th>ID</th><th>작업</th><th class="num">주공정 지수</th></tr></thead><tbody>
      ${m.criticality.map((x) => `<tr><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td class="num">${x.index}%</td></tr>`).join("")}</tbody></table>`;
    drawHist($("#mcHist"), m.histogram);
  });
  const rk = await api(`/api/uploads/${uid}/risk`);
  $("#rkBody").classList.remove("muted");
  $("#rkBody").innerHTML = `<p class="muted">${esc(rk.note)} (누적 업데이트 ${rk.history_updates}회)</p>
    <div class="scroll"><table class="t"><thead><tr><th>ID</th><th>작업</th><th>공종</th><th>상태</th><th>종료</th><th class="num">TF</th><th class="num">위험</th><th>사유</th></tr></thead><tbody>
    ${rk.items.map((x) => `<tr><td>${esc(x.code)}</td><td class="wrap">${esc(x.name)}</td><td>${esc(x.trade)}</td><td>${esc(x.status)}</td><td>${x.finish}</td><td class="num">${fmtDays(x.tf)}</td>
      <td class="num"><span class="tag ${x.score >= 50 ? "fail" : x.score >= 30 ? "" : "ok"}">${x.score}</span></td><td class="wrap">${x.reasons.map(esc).join(", ")}</td></tr>`).join("")}</tbody></table></div>`;
}

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
      <div class="row end"><button class="btn" id="dTest">반영 결과 미리보기</button><button class="btn" id="dSave">시나리오로 저장</button><button class="btn primary" id="dXer">진도 반영 XER 다운로드</button></div>`
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
