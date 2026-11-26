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
  opts.headers = { ...(opts.headers || {}), "X-App-Token": store.get("token") };
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
    <div id="tab"></div>`;
  $("#btnCsv").onclick = () => download(`/api/uploads/${uid}/activities.csv`, "activities.csv");
  $("#btnRecalc").onclick = async () => {
    await api(`/api/uploads/${uid}/recalc`, { method: "POST" });
    delete cache[uid]; toast("재계산 완료"); showProject(uid, tab);
  };
  const el = $("#tab");
  ({ overview: tabOverview, gantt: tabGantt, critical: tabCritical, dcma: tabDcma, scurve: tabScurve, p6: tabP6 }[tab] || tabOverview)(el, r);
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
      <tr class="dx" id="dx${i}" hidden><td></td><td colspan="6" class="dcma-items">${d.items.map(esc).join(", ")}${d.items.length >= 200 ? " …" : ""}</td></tr>`).join("")}
    </tbody></table></div>`;
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
    const fc = $("#fCrit").checked, fi = $("#fInc").checked;
    const acts = r.activities.filter((a) =>
      (!q || a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)) &&
      (!fc || a.critical || a.longest) && (!fi || a.status_code !== "TK_Complete"));
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

  ["q", "fCrit", "fInc"].forEach((id) => $("#" + id).addEventListener("input", build));
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
