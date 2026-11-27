"use strict";
// ================================================================ 4차 화면: 상황판, 데이터 준비도, 알림함, 월간 점검 마법사, 비교 기준, SVG 차트 화면

// ---------------------------------------------------------------- ⑨ 비교 기준 (프로젝트별로 한 번 고르면 모든 화면에 적용)
function getBase(name) { return store.get("base:" + name, ""); }
function setBase(name, uid) { store.set("base:" + name, uid || ""); }
function baseQuery(name, first = "?") { const b = getBase(name); return b ? `${first}base=${encodeURIComponent(b)}` : ""; }

// ---------------------------------------------------------------- ③ 개요 → 상황판
const fmtDelta = (k) => {
  if (k.delta === null || k.delta === undefined || k.delta === 0) return k.delta === 0 ? `<span class="delta same">변화 없음</span>` : "";
  const better = k.good === "up" ? k.delta > 0 : k.delta < 0;
  return `<span class="delta ${better ? "good" : "bad"}">${k.delta > 0 ? "▲" : "▼"} ${Math.abs(k.delta)}${k.unit === "점" || k.unit === "%" || k.unit === "개" || k.unit === "일" ? k.unit : ""}</span>`;
};
function spark(series) {
  const v = series.filter((x) => x !== null && x !== undefined);
  if (v.length < 2) return "";
  const lo = Math.min(...v), hi = Math.max(...v), W = 90, H = 24;
  const pts = series.map((x, i) => (x === null || x === undefined ? null : `${((i / (series.length - 1)) * W).toFixed(1)},${(H - 2 - ((x - lo) / (hi - lo || 1)) * (H - 4)).toFixed(1)}`)).filter(Boolean);
  return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="1.6" points="${pts.join(" ")}"/></svg>`;
}
tabOverview = async function (el, r, uid) {
  el.innerHTML = `<div class="panel muted">상황을 정리하는 중...</div>`;
  const s = await api(`/api/uploads/${uid}/situation${baseQuery(r.name)}`);
  const lvl = { ok: ["ok", "✓ 정상 범위"], warn: ["warn", "! 주의"], bad: ["bad", "✕ 위험"] }[s.level];
  el.innerHTML = `
    <div class="sit ${lvl[0]}"><span class="sit-badge">${lvl[1]}</span><div><div class="sit-line">${esc(s.headline)}</div>
      <div class="muted fs12">${s.base_data_date ? `비교 기준: DD ${s.base_data_date}` : "비교할 이전 업데이트 없음"} · <a href="#/wizard/${uid}">월간 업데이트 점검 열기 →</a></div></div></div>
    <div class="kpis kpis6">${s.kpis.map((k) => `<div class="kpi"><div class="l">${esc(k.label)}</div>
      <div class="v ${k.key === "neg" && k.value ? "crit" : ""}">${k.value === null || k.value === undefined ? "-" : esc(String(k.value))}${k.unit && k.value !== null && typeof k.value === "number" ? `<small>${k.unit}</small>` : ""}</div>
      <div class="row" style="justify-content:space-between;gap:4px">${fmtDelta(k)}<span class="spk">${spark(k.series)}</span></div></div>`).join("")}</div>
    <div class="grid2">
      <div class="panel"><h3 class="mt0">이번 주 할 일 <span class="muted fs13">${s.todo_total > s.todo.length ? `(${s.todo_total}건 중 5건)` : ""}</span></h3>
        ${s.todo.map((t) => `<a class="inbox-item ${t.level}" href="#/p/${uid}/${t.tab}"><span class="sev">${t.level === "high" ? "✕" : t.level === "mid" ? "!" : "·"}</span><span style="grid-column:2/4">${esc(t.text)}</span><span class="go">→</span></a>`).join("")
          || '<p class="muted">✓ 급한 일이 없습니다.</p>'}</div>
      <div class="panel"><h3 class="mt0">마일스톤</h3>
        <table class="t" data-noexport><thead><tr><th>ID</th><th>마일스톤</th><th>예정</th><th>계획</th><th class="num">편차</th></tr></thead><tbody>
        ${s.milestones.map((m) => `<tr><td>${esc(m.code)}</td><td>${m.done ? "✓ " : ""}${esc(m.name)}</td><td>${m.finish}</td><td>${m.bl || "-"}</td>
          <td class="num" style="color:${(m.var || 0) > 0 ? "var(--crit-text)" : ""}">${m.var === null ? "-" : (m.var > 0 ? "+" : "") + m.var}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">마일스톤이 없습니다.</td></tr>'}</tbody></table></div></div>
    ${readinessPanel(s.readiness, uid)}`;
};

// ---------------------------------------------------------------- ⑤ 데이터 준비도
function readinessPanel(items, uid, compact = false) {
  const miss = items.filter((x) => !x.ok);
  return `<div class="panel readiness ${miss.length ? "" : "done"}"><div class="row between"><h3 class="m0">데이터 준비도 <span class="muted fs13">${items.length - miss.length}/${items.length}</span></h3>
      ${miss.length ? `<span class="muted fs12">빠진 데이터를 채우면 잠긴 분석이 열립니다</span>` : '<span class="chip ok">✓ 모든 분석 사용 가능</span>'}</div>
    <div class="ready-grid">${items.map((x) => `<div class="ready ${x.ok ? "ok" : "no"}"><span class="mk" aria-label="${x.ok ? "준비됨" : "없음"}">${x.ok ? "✓" : "✕"}</span>
      <div><b>${esc(x.label)}</b> <span class="muted">${esc(x.detail)}</span><div class="muted fs12">${x.ok ? "사용 가능: " : "잠김: "}${esc(x.unlocks)}</div>
      ${x.ok || compact ? "" : `<div class="fix">${esc(x.fix)} <a href="#/p/${uid}/${x.tab}">이동 →</a></div>`}</div></div>`).join("")}</div></div>`;
}

// ---------------------------------------------------------------- ⑥ 홈 알림함: 심각도 필터 · 내 프로젝트 · 확인함 · 오래된 항목 접기
renderInbox = async function (container) {
  const items = await api("/api/inbox").catch(() => []);
  const mine = new Set(Object.keys(me?.projects || {}));
  const favs = new Set(JSON.parse(store.get("favs", "[]")));
  const key = (x) => x.project + "|" + x.text;
  const dismissed = new Set(JSON.parse(store.get("inboxSeen:" + (me?.username || ""), "[]")));
  const st = JSON.parse(store.get("inboxFilter", '{"lv":"all","mine":true}'));
  const draw = () => {
    const isMine = (x) => !me?.username || mine.has(x.project) || favs.has(x.project) || me.role === "admin";
    let xs = items.filter((x) => !dismissed.has(key(x)));
    if (st.mine && (mine.size || favs.size)) xs = xs.filter(isMine);
    if (st.lv !== "all") xs = xs.filter((x) => x.level === st.lv);
    const stale = xs.filter((x) => x.text.startsWith("마지막 업데이트가"));
    const main = xs.filter((x) => !stale.includes(x));
    const row = (x) => `<div class="inbox-item ${x.level}"><span class="sev">${x.level === "high" ? "✕" : "!"}</span>
      <a href="#/p/${x.uid}/${x.tab}"><b>${esc(x.project)}</b> ${esc(x.text)}</a><button class="btn sm ghost" data-seen="${esc(key(x))}" title="확인함(숨기기)" aria-label="확인함">${icon("check", 14)}</button></div>`;
    container.innerHTML = `<div class="panel"><div class="row between"><h3 class="m0">오늘 확인할 것 <span class="muted">(${main.length})</span></h3>
      <div class="row" role="group" aria-label="필터"><div class="seg-tabs sm">${[["all", "전체"], ["high", "높음"], ["mid", "보통"]].map(([k, l]) => `<button class="${st.lv === k ? "on" : ""}" data-lv="${k}">${l}</button>`).join("")}</div>
        ${mine.size || favs.size ? `<label><input type="checkbox" id="ibMine" ${st.mine ? "checked" : ""}> 내 프로젝트·관심만</label>` : ""}
        ${dismissed.size ? `<button class="btn sm" id="ibReset">숨긴 항목 ${dismissed.size}개 다시 보기</button>` : ""}</div></div>
      <div class="inbox">${main.map(row).join("") || '<p class="muted">확인할 항목이 없습니다. 👍</p>'}
      ${stale.length ? `<details><summary class="muted">업데이트가 오래된 프로젝트 ${stale.length}건</summary>${stale.map(row).join("")}</details>` : ""}</div></div>`;
    container.querySelectorAll("[data-lv]").forEach((b) => (b.onclick = () => { st.lv = b.dataset.lv; store.set("inboxFilter", JSON.stringify(st)); draw(); }));
    $("#ibMine")?.addEventListener("change", (e) => { st.mine = e.target.checked; store.set("inboxFilter", JSON.stringify(st)); draw(); });
    $("#ibReset")?.addEventListener("click", () => { dismissed.clear(); store.set("inboxSeen:" + (me?.username || ""), "[]"); draw(); });
    container.querySelectorAll("[data-seen]").forEach((b) => (b.onclick = () => { dismissed.add(b.dataset.seen); store.set("inboxSeen:" + (me?.username || ""), JSON.stringify([...dismissed])); draw(); }));
  };
  draw();
};

// ---------------------------------------------------------------- ⑧ 월간 업데이트 점검 마법사
async function showWizard(uid) {
  const u = await load(uid); const r = u.result;
  ctx.uid = uid; ctx.result = r; ctx.tab = "wizard";
  $("#crumb").innerHTML = `/ <a href="#/p/${uid}/overview">${esc(r.name)}</a> / 월간 업데이트 점검`;
  view.innerHTML = `<div class="panel muted">점검하는 중... (건전성·지연 원인·변경 로그를 계산합니다)</div>`;
  const rv = await api(`/api/uploads/${uid}/review${baseQuery(r.name)}`);
  const done = JSON.parse(store.get("wiz:" + uid, "[]"));
  const cur = Math.min(+(sessionStorage.getItem("wizStep:" + uid) || 0), rv.steps.length - 1);
  const badge = (s) => s.ok === null ? '<span class="chip">정보</span>' : s.ok ? '<span class="chip ok">✓ 이상 없음</span>' : '<span class="chip warn">! 확인 필요</span>';
  const st = rv.steps[cur];
  view.innerHTML = `<div class="row between"><div><h2 class="m0">월간 업데이트 점검</h2>
      <div class="muted">${esc(r.name)} · DD ${rv.data_date}${rv.base_data_date ? ` (비교: DD ${rv.base_data_date})` : ""}</div></div>
      <div class="row"><button class="btn" id="wzUpload" data-need="editor">${icon("upload")} 새 업데이트 올리기</button><a class="btn" href="#/p/${uid}/overview">상황판</a></div></div>
    <ol class="stepper">${rv.steps.map((x, i) => `<li class="${i === cur ? "on" : ""} ${done.includes(x.key) ? "done" : ""}"><button data-st="${i}">
      <span class="n">${done.includes(x.key) ? "✓" : i + 1}</span><span>${esc(x.title)}</span>${x.ok === false ? '<span class="dot" aria-label="확인 필요"></span>' : ""}</button></li>`).join("")}</ol>
    <div class="panel wiz"><div class="row between"><h3 class="m0">${cur + 1}. ${esc(st.title)}</h3>${badge(st)}</div>
      <p style="font-size:16px">${esc(st.summary)}</p>
      ${st.issues.length ? `<ul>${st.issues.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${(st.detail || []).length ? `<details><summary>주의 변경 ${st.detail.length}건</summary><ul>${st.detail.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>` : ""}
      ${st.key === "report" ? `<p>엑셀 양식을 골라 이번 달 보고서를 만듭니다. 비교 기준(${rv.base_data_date || "없음"})이 그대로 적용됩니다.</p><a class="btn primary" href="#/reports/${uid}">엑셀 리포트 만들기 →</a>`
        : `<a class="btn" href="#/p/${uid}/${st.tab}">자세히 보기 →</a>`}
      <div class="nav mt16"><button class="btn" id="wzPrev" ${cur ? "" : "disabled"}>← 이전</button>
        <button class="btn primary" id="wzNext">${cur < rv.steps.length - 1 ? "확인했습니다 · 다음 →" : "점검 완료 ✓"}</button></div></div>`;
  applyRole(view);
  const go = (i) => { sessionStorage.setItem("wizStep:" + uid, String(i)); showWizard(uid); };
  view.querySelectorAll("[data-st]").forEach((b) => (b.onclick = () => go(+b.dataset.st)));
  $("#wzPrev").onclick = () => go(cur - 1);
  $("#wzNext").onclick = () => {
    if (!done.includes(st.key)) { done.push(st.key); store.set("wiz:" + uid, JSON.stringify(done)); }
    if (cur < rv.steps.length - 1) go(cur + 1); else { toast("이번 달 점검을 마쳤습니다 ✓"); location.hash = `#/p/${uid}/overview`; }
  };
  $("#wzUpload").onclick = () => $("#btnUpload").click();
}

// ---------------------------------------------------------------- ⑭ S-Curve · 자원 · 히스토그램 SVG 화면
tabScurve = function (el, r) {
  const sc = r.s_curve;
  el.innerHTML = `<div class="panel"><h3 class="mt0">S-Curve (원공기 가중 누적 공정률)</h3><div id="scHost"></div>
    <p class="muted">초록 점선은 Data Date, 실적 공정률은 ${sc.actual_pct}%입니다.</p></div>`;
  const ddIdx = sc.dates.findIndex((d) => d >= sc.data_date);
  const series = [];
  if (sc.baseline.some((v) => v > 0)) series.push({ name: "계획(Target)", color: "#d97706", values: sc.baseline });
  series.push({ name: "Early", color: "#2563eb", values: sc.early }, { name: "Late", color: "#7c3aed", values: sc.late });
  chartSvg($("#scHost"), { type: "line", labels: sc.dates.map((d) => d.slice(2).replace(/-/g, ".")), series, min: 0, max: 100, yFmt: (v) => v + "%", height: 380,
    title: "S-Curve", refLines: ddIdx >= 0 ? [{ x: ddIdx, label: `Data Date · 실적 ${sc.actual_pct}%` }] : [] });
};
tabResources = async function (el, r, uid) {
  const h = await api(`/api/uploads/${uid}/resources`);
  if (!h.series.length) { el.innerHTML = `<div class="panel empty">XER에 잔여 물량(TASKRSRC remain_qty)이 있는 자원 배정이 없습니다. <a href="#/p/${uid}/overview">데이터 준비도 보기</a></div>`; return; }
  const colors = ["#2563eb", "#d97706", "#16a34a", "#7c3aed", "#dc2626", "#0891b2", "#db2777"];
  el.innerHTML = `<div class="panel"><h3 class="mt0">자원 히스토그램 (주간 잔여 물량, Early 일정 기준)</h3><div id="rsHost"></div>
    <p class="muted">막대가 급격히 솟는 주는 자원 과부하 가능성이 있습니다. 여유가 있는 작업을 뒤로 미루면 평준화할 수 있습니다(What-if).</p></div>`;
  chartSvg($("#rsHost"), { type: "bar", stacked: true, labels: h.weeks.map((w) => w.slice(2)), series: h.series.map((s, i) => ({ name: `${s.name} (최대 ${s.peak})`, color: colors[i % colors.length], values: s.values })), height: 320, title: "자원 히스토그램", yTitle: "물량" });
};

// ---------------------------------------------------------------- ⑩ 읽기 전용 프로젝트: 편집 권한 요청
async function requestAccess(name) {
  const v = await ui.form(`'${name}' 편집 권한 요청`, [{ name: "message", label: "요청 사유(선택)", type: "textarea", rows: 3, placeholder: "예: 이번 달부터 리스크·제약 입력을 맡았습니다" }],
    { submit: "요청 보내기", intro: "프로젝트 소유자(없으면 관리자)에게 알림이 갑니다. 승인되면 알림으로 알려 드립니다." });
  if (!v) return;
  try { await api(`/api/projects/${encodeURIComponent(name)}/access-request`, { method: "POST", json: v }); toast("요청을 보냈습니다"); } catch (e) { toast(e.message); }
}
async function renderAccessRequests(box, name) {
  if (!ctx.canManage) return;
  const rq = await api(`/api/projects/${encodeURIComponent(name)}/access-requests`).catch(() => []);
  if (!rq.length) return;
  const d = document.createElement("div");
  d.className = "panel warn";
  d.innerHTML = `<h3 class="mt0">편집 권한 요청 ${rq.length}건</h3>${rq.map((x) => `<div class="row" style="justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--line)">
    <span><b>${esc(x.username)}</b> ${esc(x.message || "")} <span class="muted">${x.created_at.replace("T", " ").slice(5, 16)}</span></span>
    <span class="row"><select class="s sm" data-rr="${x.id}"><option value="member">멤버로</option><option value="owner">소유자로</option></select>
      <button class="btn sm primary" data-ok="${x.id}">승인</button><button class="btn sm" data-no="${x.id}">거절</button></span></div>`).join("")}`;
  box.prepend(d);
  const decide = async (id, approve) => {
    await api(`/api/projects/${encodeURIComponent(name)}/access-requests/${id}`, { method: "POST", json: { approve, role: d.querySelector(`[data-rr="${id}"]`).value } });
    toast(approve ? "승인했습니다" : "거절했습니다"); renderMembers(box, name);
  };
  d.querySelectorAll("[data-ok]").forEach((b) => (b.onclick = () => decide(b.dataset.ok, true)));
  d.querySelectorAll("[data-no]").forEach((b) => (b.onclick = () => decide(b.dataset.no, false)));
}
