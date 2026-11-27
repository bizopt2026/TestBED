"use strict";
// ================================================================ 5차 화면: 압축 헤더, 보고서 센터, 홈 묶음, 설정 하위 탭, 로딩 뼈대,
// 월간 점검 팀 기록, 코멘트·@멘션, 담당자, 엑셀 붙여넣기, 사용자 설정(알림·시작 화면·용어), 상황판 해석, 분할 로딩

// ---------------------------------------------------------------- 공통
let _users = null;
async function userList() { if (!_users) _users = await api("/api/users").catch(() => []); return _users; }
const fmtAt = (s) => (s || "").replace("T", " ").slice(5, 16);
let prefs = { start_page: "home", term_mode: store.get("termMode", "mixed"), notify: [] };
async function loadPrefs() {
  if (!me?.username) return prefs;
  try { prefs = await api("/api/me/prefs"); store.set("termMode", prefs.term_mode); } catch {}
  return prefs;
}

// ---------------------------------------------------------------- ⑤ 로딩 뼈대
function skeleton(kind = "page") {
  const line = (w, h = 14) => `<span class="sk" style="width:${w};height:${h}px"></span>`;
  const card = `<div class="panel sk-card">${line("40%", 16)}${line("70%", 28)}${line("90%")}${line("60%")}</div>`;
  if (kind === "tab") return `<div class="skel" role="status" aria-busy="true" aria-label="불러오는 중"><div class="kpis">${Array(6).fill(`<div class="kpi">${line("60%")}${line("80%", 26)}</div>`).join("")}</div><div class="grid2">${card}${card}</div></div>`;
  if (kind === "project") return `<div class="skel" role="status" aria-busy="true" aria-label="불러오는 중"><div class="phead">${line("30%", 26)}${line("50%")}</div>${line("100%", 34)}${skeleton("tab")}</div>`;
  return `<div class="skel" role="status" aria-busy="true" aria-label="불러오는 중">${line("25%", 26)}<div class="cards">${card}${card}${card}</div>${card}</div>`;
}

// ---------------------------------------------------------------- ⑯ 대형 공정표: 요약(lite) 먼저, 액티비티 나중
const liteCache = {};
const FULL_TABS = new Set(["gantt", "critical", "scurve", "evm", "resources", "health", "analysis", "p6", "korea", "rels", "risk", "recovery", "whatif", "lookahead", "daily", "report", "trades", "bench"]);
async function loadHead(uid) {
  if (cache[uid]) return cache[uid];
  if (!liteCache[uid]) liteCache[uid] = await api(`/api/uploads/${uid}?lite=1`);
  return liteCache[uid];
}
const _fullLoading = {};
function loadFull(uid) {
  if (cache[uid]) return Promise.resolve(cache[uid]);
  return (_fullLoading[uid] ||= load(uid).finally(() => delete _fullLoading[uid]));
}

// ---------------------------------------------------------------- ① 압축 헤더 + 고정 미니 헤더
let navToken = 0;
// 6차 ② 화면 정리: 그룹마다 핵심 화면만 탭으로, 나머지는 '더보기'
GROUPS[0][1].splice(1, 0, ["timeline", "타임라인"]); TAB_GROUP.timeline = "현황"; TAB_LABEL.timeline = "타임라인";
const CORE_TABS = { viewer: ["overview", "timeline", "gantt", "critical", "health", "analysis", "risk", "lookahead", "xlsx"],
  editor: ["overview", "timeline", "gantt", "critical", "scurve", "health", "analysis", "risk", "recovery", "lookahead", "xlsx"] };
let myUsage = null;
function coreTab(k, cur) {
  if (k === cur || store.get("showAllTabs") === "1") return true;
  const role = me?.role === "viewer" ? "viewer" : "editor";
  return CORE_TABS[role].includes(k) || (myUsage?.[k] || 0) >= 3;
}
function hit(screen) { if (me?.username) api("/api/usage", { method: "POST", json: { screen } }).catch(() => {}); }
function groupNavHtml(uid, tab, cls = "groups") {
  return GROUPS.map(([g, ts]) => `<a href="#/p/${uid}/${ts[0][0]}" class="${TAB_GROUP[tab] === g ? "on" : ""}" ${TAB_GROUP[tab] === g ? 'aria-current="page"' : ""} ${cls === "groups" ? `title="${esc(g)}"` : ""}>${g}</a>`).join("");
}
const SHORT = { overview: "g o", timeline: "g t", gantt: "g g", critical: "g c", health: "g q", analysis: "g a", risk: "g r", recovery: "g m", lookahead: "g l", xlsx: "g p", settings: "g s" };
function tabNavHtml(uid, tab) {
  if (!TAB_GROUP[tab]) return "";
  const ts = GROUPS.find(([g]) => g === TAB_GROUP[tab])[1];
  const core = ts.filter(([k]) => coreTab(k, tab)), more = ts.filter(([k]) => !coreTab(k, tab));
  const a = ([k, l]) => `<a href="#/p/${uid}/${k}" class="${k === tab ? "on" : ""}" ${k === tab ? 'aria-current="page"' : ""} ${SHORT[k] ? `title="단축키 ${SHORT[k]}"` : ""}>${l}</a>`;
  return core.map(a).join("") + (more.length ? `<div class="menu-wrap"><button class="tab-more" id="btnMoreTabs" aria-haspopup="menu" aria-expanded="false">더보기 ${more.length} ▾</button>
    <div class="menu" id="moreTabs" role="menu" hidden>${more.map(([k, l]) => `<a role="menuitem" href="#/p/${uid}/${k}">${l}</a>`).join("")}
    <hr><button role="menuitem" id="btnAllTabs">모든 화면을 탭으로 보기</button></div></div>`
    : store.get("showAllTabs") === "1" ? `<button class="tab-more" id="btnFewTabs" title="자주 쓰는 화면만 탭으로">간단히 보기</button>` : "");
}
function bindTabNav() {
  if ($("#btnMoreTabs")) popMenu($("#btnMoreTabs"), $("#moreTabs"));
  $("#btnAllTabs")?.addEventListener("click", () => { store.set("showAllTabs", "1"); showProject(ctx.uid, ctx.tab, true); });
  $("#btnFewTabs")?.addEventListener("click", () => { store.set("showAllTabs", "0"); showProject(ctx.uid, ctx.tab, true); });
}
// 6차 ③ 프로젝트 빠른 전환: 최근·관심·검색
function rememberProject(name, uid) {
  const xs = JSON.parse(store.get("recentProj", "[]")).filter((x) => x.name !== name);
  xs.unshift({ name, uid }); store.set("recentProj", JSON.stringify(xs.slice(0, 8)));
}
function projSwitcherHtml(cur) {
  return `<div class="menu pop psw" id="projPop" role="dialog" aria-label="프로젝트 전환" hidden>
    <input class="s" id="pswQ" type="search" placeholder="프로젝트 검색" aria-label="프로젝트 검색"><div id="pswList" class="psw-list"></div></div>`;
}
function bindProjSwitcher(cur) {
  const list = () => {
    const q = ($("#pswQ").value || "").trim().toLowerCase();
    const latest = {}; (uploadsCache || []).forEach((u) => { if (!latest[u.name] || u.data_date > latest[u.name].data_date) latest[u.name] = u; });
    const favs = JSON.parse(store.get("favs", "[]"));
    const recent = JSON.parse(store.get("recentProj", "[]")).map((x) => x.name).filter((n) => latest[n] && n !== cur);
    const row = (n) => `<a href="#/p/${latest[n].id}/${ctx.tab && ctx.tab !== "settings" ? ctx.tab : "overview"}" class="psw-item"><b>${esc(n)}</b><span class="muted">DD ${latest[n].data_date}</span></a>`;
    if (q) { $("#pswList").innerHTML = Object.keys(latest).filter((n) => n.toLowerCase().includes(q)).map(row).join("") || '<p class="muted">없음</p>'; return; }
    $("#pswList").innerHTML = (recent.length ? `<div class="psw-h">최근 본 프로젝트</div>${recent.map(row).join("")}` : "") +
      (favs.filter((n) => latest[n] && n !== cur).length ? `<div class="psw-h">관심 프로젝트</div>${favs.filter((n) => latest[n] && n !== cur).map(row).join("")}` : "") +
      `<div class="psw-h">전체 (${Object.keys(latest).length})</div>${Object.keys(latest).filter((n) => n !== cur).slice(0, 15).map(row).join("")}`;
  };
  popMenu($("#btnProj"), $("#projPop"));
  $("#btnProj").addEventListener("click", () => { list(); setTimeout(() => $("#pswQ").focus(), 0); });
  $("#pswQ").oninput = list;
  $("#pswQ").onkeydown = (e) => { if (e.key === "Enter") $("#pswList a")?.click(); if (e.key === "ArrowDown") { e.preventDefault(); $("#pswList a")?.focus(); } };
}

// ---------------------------------------------------------------- ① 압축 헤더 + 고정 미니 헤더 (6차: 같은 프로젝트 안 탭 전환은 본문만 교체)
showProject = async function (uid, tab, force = false) {
  if (tab === "chat") setTimeout(() => openAiPanel(), 50);
  tab = String(tab).split("?")[0];
  tab = TAB_ALIAS[tab] || tab;
  const my = ++navToken;
  const light = !force && $("#phead")?.dataset.uid === uid && ctx.uid === uid;
  if (!light && ctx.uid !== uid) view.innerHTML = skeleton("project");
  const u = await loadHead(uid);
  const r = u.result;
  if (!myUsage && me?.username) myUsage = await api("/api/usage/mine").catch(() => ({}));
  if (!light) {
    const perm = await api(`/api/uploads/${uid}/perm`).catch(() => ({}));
    Object.assign(u, perm);
    if (!uploadsCache?.some((x) => x.id === uid)) uploadsCache = await api("/api/uploads");
  }
  if (my !== navToken) return;
  ctx.uid = uid; ctx.tab = tab;
  if (!light) { ctx.result = cache[uid]?.result || null; ctx.canWrite = u.can_write !== false; ctx.canManage = !!u.can_manage; }
  hit(tab); rememberProject(r.name, uid);
  $("#crumb").innerHTML = `/ <a href="#/p/${uid}/overview">${esc(r.name)}</a> / ${esc(TAB_LABEL[tab] || (tab === "settings" ? "설정" : ""))}`;
  if (light) {
    $("#gnav").innerHTML = groupNavHtml(uid, tab);
    $("#gset").classList.toggle("on", tab === "settings");
    $("#tnav").innerHTML = tabNavHtml(uid, tab); $("#tnav").hidden = !TAB_GROUP[tab];
    $("#mnav").innerHTML = groupNavHtml(uid, tab, "mini-groups");
    bindTabNav();
    $("#tab").innerHTML = skeleton("tab");
  } else {
    const roleLabel = { admin: "관리자", owner: "소유자", member: "멤버" }[u.my_role];
    const same = uploadsCache.filter((x) => x.name === r.name).sort((a, b) => (b.data_date + b.created_at).localeCompare(a.data_date + a.created_at));
    const latest = same[0]?.id === uid;
    const favs = JSON.parse(store.get("favs", "[]"));
    const baseOpts = same.filter((x) => x.id !== uid && x.data_date <= r.data_date);
    const bsel = baseOpts.find((x) => x.id === getBase(r.name));
    const baseLabel = bsel ? `DD ${bsel.data_date}` : "직전 자동";
    view.innerHTML = `
    <div class="phead compact" id="phead" data-uid="${uid}">
      <h2><div class="menu-wrap"><button class="pname-btn" id="btnProj" aria-haspopup="dialog" aria-expanded="false" title="다른 프로젝트로 전환"><span class="pname">${esc(r.name)}</span> <span class="caret" aria-hidden="true">▾</span></button>${projSwitcherHtml(r.name)}</div>
        <button class="btn icon fav ${favs.includes(r.name) ? "on" : ""}" id="btnFav" aria-label="관심 프로젝트" title="관심 프로젝트">★</button></h2>
      <select class="s sm" id="upSel" aria-label="업데이트 선택">${same.map((x) => `<option value="${x.id}" ${x.id === uid ? "selected" : ""}>DD ${x.data_date} · ${esc(x.note || x.filename)}</option>`).join("")}</select>
      ${latest ? '<span class="chip ok" title="가장 최근 업데이트">✓ 최신</span>' : '<span class="chip warn" title="최신 업데이트가 아닙니다">! <span class="hide-sm">최신 아님</span><span class="show-sm">이전</span></span>'}
      ${ctx.canWrite ? "" : `<button class="chip warn as-btn hide-sm" id="btnReqAccess" title="편집하려면 소유자에게 권한을 요청하세요">👁 읽기 전용 · 권한 요청</button>`}
      <span class="spacer"></span>
      <button class="btn sm ai-link" id="btnAi2" title="AI 어시스턴트 (Alt+A)">✦ AI</button>
      <div class="menu-wrap"><button class="btn sm" id="btnView" aria-haspopup="dialog" aria-expanded="false" aria-label="보기 설정">${icon("eye", 14)}<span class="hide-sm"> 보기 설정 <span class="muted">· 비교 ${esc(baseLabel)}</span></span> ▾</button>
        <div class="menu pop" id="viewPop" role="dialog" aria-label="보기 설정" hidden>
          <label class="muted" for="baseSel">비교 기준 <span style="font-size:11px">(업데이트 분석·상황판·리포트·공정표 겹쳐보기 공통)</span></label>
          <select class="s" id="baseSel"><option value="">직전 업데이트(자동)</option>${baseOpts.map((x) => `<option value="${x.id}" ${getBase(r.name) === x.id ? "selected" : ""}>DD ${x.data_date} · ${esc(x.note || x.filename)}</option>`).join("")}</select>
          <div class="kvline"><span class="muted">계산 방식</span><span class="chip">${r.options?.progress_override ? "Progress Override" : "Retained Logic"}</span><a href="#/p/${uid}/settings" data-sub="calc">변경</a></div>
          <div class="kvline"><span class="muted">내 권한</span>${ctx.canWrite ? `<span class="chip ok">✎ ${roleLabel || "편집 가능"}</span>` : '<span class="chip warn">👁 읽기 전용</span>'}<a href="#/p/${uid}/settings" data-sub="members">멤버</a></div>
          <div class="kvline"><span class="muted">액티비티</span><span>${r.activity_count ?? r.activities?.length ?? "-"}개 · DD ${r.data_date}</span></div>
        </div></div>
      <div class="menu-wrap"><button class="btn sm" id="btnWork" aria-haspopup="menu" aria-expanded="false">작업 ▾</button>
        <div class="menu" id="workMenu" role="menu" hidden>
          <a role="menuitem" href="#/wizard/${uid}">${icon("wand")}월간 점검</a>
          <a role="menuitem" href="#/reports/${uid}">${icon("sheet")}보고서 센터</a>
          <a role="menuitem" href="#/p/${uid}/timeline">🕘 타임라인</a>
          <a role="menuitem" href="#/field/${uid}">📱 현장 모드</a>
          ${ctx.canWrite ? "" : `<button role="menuitem" data-w="req">👁 편집 권한 요청</button>`}
          <button role="menuitem" data-w="help">? 이 화면 사용법</button>
          <button role="menuitem" data-w="recalc" data-need="editor">↻ 재계산</button>
        </div></div>
    </div>
    ${r.warnings.map((w) => `<div class="panel err">⚠ ${esc(w)}</div>`).join("")}
    <nav class="groups" aria-label="화면 그룹"><span id="gnav" class="gnav">${groupNavHtml(uid, tab)}</span>
      <button class="ai-link" id="btnAi" title="Alt+A">✦ AI 어시스턴트</button>
      <a href="#/p/${uid}/settings" id="gset" class="${tab === "settings" ? "on" : ""}" title="단축키 g s">⚙ 설정</a></nav>
    <nav class="tabs" id="tnav" aria-label="세부 화면" ${TAB_GROUP[tab] ? "" : "hidden"}>${tabNavHtml(uid, tab)}</nav>
    <div class="mini-head" id="miniHead" inert><b>${esc(r.name)}</b><span class="muted">DD ${r.data_date}</span><nav class="mini-groups" id="mnav" aria-label="화면 그룹(고정)">${groupNavHtml(uid, tab, "mini-groups")}</nav></div>
    <div id="mobileHint"></div>
    <div id="tab">${skeleton("tab")}</div>`;
    $("#upSel").onchange = (e) => (location.hash = `#/p/${e.target.value}/${ctx.tab}`);
    $("#baseSel").onchange = (e) => { setBase(r.name, e.target.value); toast("비교 기준을 바꿨습니다. 업데이트 분석·상황판·리포트에 적용됩니다."); showProject(uid, ctx.tab, true); };
    $("#btnReqAccess")?.addEventListener("click", () => requestAccess(r.name));
    $("#btnAi").onclick = () => openAiPanel();
    $("#btnAi2").onclick = () => openAiPanel();
    $("#btnFav").onclick = () => {
      const f = new Set(JSON.parse(store.get("favs", "[]"))); f.has(r.name) ? f.delete(r.name) : f.add(r.name);
      store.set("favs", JSON.stringify([...f])); $("#btnFav").classList.toggle("on", f.has(r.name));
    };
    popMenu($("#btnView"), $("#viewPop")); popMenu($("#btnWork"), $("#workMenu"));
    bindProjSwitcher(r.name);
    view.querySelectorAll("[data-sub]").forEach((a) => a.addEventListener("click", () => sessionStorage.setItem("sub:settings", a.dataset.sub)));
    $("#workMenu").querySelector('[data-w="help"]').onclick = () => openHelpFor(ctx.tab);
    $("#workMenu").querySelector('[data-w="req"]')?.addEventListener("click", () => requestAccess(r.name));
    $("#workMenu").querySelector('[data-w="recalc"]').onclick = async () => {
      await api(`/api/uploads/${uid}/recalc`, { method: "POST" });
      delete cache[uid]; delete liteCache[uid]; toast("재계산 완료"); showProject(uid, ctx.tab, true);
    };
    bindTabNav();
    applyRole(view);
    stickyHead();
    mobileFieldHint(uid);
  }
  // 탭 본문: 액티비티가 필요한 화면만 전체 데이터를 기다린다
  let full = cache[uid];
  if (!full && (FULL_TABS.has(tab) || !TAB_GROUP[tab] && tab !== "settings")) {
    full = await loadFull(uid);
    if (my !== navToken) return;
  } else if (!full) {
    loadFull(uid).then((f) => { if (ctx.uid === uid) ctx.result = f.result; }).catch(() => {});
  }
  if (full) ctx.result = full.result;
  const rr = full ? full.result : r;
  const el = $("#tab");
  el.innerHTML = "";
  el.dataset.uid = uid;
  try {
    await ({ overview: tabOverview, gantt: tabGantt, critical: tabCritical, dcma: tabDcma, scurve: tabScurve, p6: tabP6,
       chat: tabChat, report: tabReport, delay: tabDelay, whatif: tabWhatif, rels: tabRels, trades: tabTrades,
       risk: tabRisk, bench: tabBench, daily: tabDaily, health: tabHealth, forensic: tabForensic, predict: tabPredict,
       recovery: tabRecovery, evm: tabEvm, resources: tabResources, korea: tabKorea, lookahead: tabLookahead,
       settings: tabSettings, analysis: tabAnalysis, timeline: (e, x, id) => tabTimeline(e, x, id),
       xlsx: () => { location.hash = `#/reports/${uid}`; } }[tab] || tabOverview)(el, rr, uid);
  } catch (err) { if (my === navToken) el.innerHTML = errorPanel(err, true); }
  enhance(el);
  maybeStartTour(tab);
};
function popMenu(btn, menu) {
  const close = () => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.onclick = (e) => { e.stopPropagation(); const open = menu.hidden; document.querySelectorAll(".phead .menu").forEach((m) => (m.hidden = true)); menu.hidden = !open; btn.setAttribute("aria-expanded", String(open)); if (open) menu.querySelector("select,[role=menuitem]")?.focus(); };
  menu.addEventListener("click", (e) => { e.stopPropagation(); if (e.target.closest("a,[role=menuitem]")) close(); });
  menu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { close(); btn.focus(); }
    const items = [...menu.querySelectorAll("[role=menuitem]")]; if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  });
  document.addEventListener("click", close);
}
let _stickyObs = null;
function stickyHead() {
  _stickyObs?.disconnect();
  const ph = $("#phead"), mh = $("#miniHead"); if (!ph || !mh || !window.IntersectionObserver) return;
  _stickyObs = new IntersectionObserver(([e]) => { const on = !e.isIntersecting && mh.isConnected; mh.classList.toggle("on", on); mh.inert = !on; });
  _stickyObs.observe(ph);
}

// ---------------------------------------------------------------- ⑭ 상황판: '왜?' 안내 · 추세 기간 · 점검 기록 · 팀 코멘트
tabOverview = async function (el, r, uid) {
  el.innerHTML = skeleton("tab");
  const [s, st] = await Promise.all([api(`/api/uploads/${uid}/situation${baseQuery(r.name)}`), getAiStatus().catch(() => ({}))]);
  const order = (prefs.kpis && prefs.kpis.length ? prefs.kpis : KPI_DEFAULT);
  s.kpis = order.map((k) => s.kpis.find((x) => x.key === k)).filter(Boolean);
  const lvl = { ok: ["ok", "정상"], warn: ["warn", "주의"], bad: ["bad", "위험"] }[s.level];
  const ld = s.level_detail || { issues: {}, reasons: [] };
  const nIss = (ld.issues.bad || 0) + (ld.issues.warn || 0);
  const lvIcon = { ok: "check", warn: "alert", bad: "alert" }[s.level];
  const rv = s.review || {};
  el.innerHTML = `
    <div class="sit ${lvl[0]}"><span class="sit-badge">${typeof icon === "function" ? icon(lvIcon, 14) : ""}${lvl[1]}${nIss ? ` · 이슈 ${nIss}` : ""}</span><div><div class="sit-line">${esc(s.headline)}</div>
      ${ld.reasons.length ? `<div class="sit-why" aria-label="상태 판정 이유">${ld.reasons.map((t) => `<a href="${isDashboard?.() ? "#/issues" : `#/p/${uid}/analysis`}">${esc(t)}</a>`).join("")}${nIss > ld.reasons.length ? `<span class="muted fs12">외 ${nIss - ld.reasons.length}건</span>` : ""}</div>` : ""}
      <div class="muted fs12">${s.base_data_date ? `비교 기준: DD ${s.base_data_date}` : "비교할 이전 업데이트 없음"} ·
        ${rv.completed_by ? `<span class="chip ok">✓ 월간 점검 완료 · ${esc(rv.completed_by)} ${fmtAt(rv.completed_at)}</span>` : `<a href="#/wizard/${uid}">월간 업데이트 점검 ${Object.keys(rv.steps || {}).length ? `(${Object.keys(rv.steps).length}단계 확인됨) ` : ""}열기 →</a>`}</div></div></div>
    <div class="kpis ${s.kpis.length <= 4 ? "kpis4" : "kpis6"}">${s.kpis.map((k) => `<div class="kpi ${kTone(k)}">
      <div class="l">${esc(k.label)}${s.why?.[k.key] ? ` <button class="why" data-why="${k.key}" aria-expanded="false" aria-label="${esc(k.label)} 왜 이런가요?">왜?</button>` : ""}</div>
      <div class="v ${k.key === "neg" && k.value ? "crit" : ""}">${k.value === null || k.value === undefined ? "-" : esc(String(k.value))}${k.unit && k.value !== null && typeof k.value === "number" ? `<small>${k.unit}</small>` : ""}</div>
      <div class="row" style="justify-content:space-between;gap:4px">${fmtDelta(k)}<span class="spk" title="${esc(k.series_label || "")}">${spark(k.series)}</span></div>
      ${k.series_label && k.series.filter((x) => x !== null).length > 1 ? `<div class="muted spk-l">추세: ${esc(k.series_label)}</div>` : ""}
      ${s.why?.[k.key] ? `<div class="why-box" id="why-${k.key}" hidden>${esc(s.why[k.key].text)} <a href="#/p/${uid}/${s.why[k.key].tab}">자세히 →</a>
        ${st.enabled && me?.role !== "viewer" ? `<div><button class="btn sm ghost" data-whyai="${k.key}">✦ AI로 자세히</button></div><div class="why-ai" id="whyai-${k.key}"></div>` : ""}</div>` : ""}</div>`).join("")}</div>
    <div class="row end" style="margin:-6px 0 8px"><button class="btn sm ghost" id="kpiCfg" title="보일 지표와 순서를 고릅니다">⚙ 지표 고르기</button>
      <a class="btn sm ghost" href="#/p/${uid}/settings" data-sub="status" title="정상·주의·위험 판정 기준">상태 기준</a></div>
    <div class="grid2">
      <div class="panel"><h3 class="mt0">이번 주 할 일 <span class="muted fs13">${s.todo_total > s.todo.length ? `(${s.todo_total}건 중 5건)` : ""}</span></h3>
        ${s.todo.map((t) => `<a class="inbox-item ${t.level}" href="#/p/${uid}/${t.tab}"><span class="sev">${t.level === "high" ? "✕" : t.level === "mid" ? "!" : "·"}</span><span class="ib-span">${esc(t.text)}</span><span class="go">→</span></a>`).join("")
          || '<p class="muted">✓ 급한 일이 없습니다.</p>'}</div>
      <div class="panel"><h3 class="mt0">마일스톤</h3>
        <div class="scroll"><table class="t" data-noexport><thead><tr><th>ID</th><th>마일스톤</th><th>예정</th><th>계획</th><th class="num">편차</th></tr></thead><tbody>
        ${s.milestones.map((m) => `<tr><td>${esc(m.code)}</td><td>${m.done ? "✓ " : ""}${esc(m.name)}</td><td>${m.finish}</td><td>${m.bl || "-"}</td>
          <td class="num" style="color:${(m.var || 0) > 0 ? "var(--crit-text)" : ""}">${m.var === null ? "-" : (m.var > 0 ? "+" : "") + m.var}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">마일스톤이 없습니다.</td></tr>'}</tbody></table></div></div></div>
    ${readinessPanel(s.readiness, uid)}
    <div class="panel"><h3 class="mt0">팀 코멘트 <span class="muted fs13">@아이디로 동료를 부르면 알림이 갑니다</span></h3><div id="projComments"></div></div>`;
  el.querySelectorAll("[data-why]").forEach((b) => (b.onclick = () => {
    const box = $("#why-" + b.dataset.why); box.hidden = !box.hidden; b.setAttribute("aria-expanded", String(!box.hidden));
  }));
  commentThread($("#projComments"), uid, "project:" + r.name);
  el.querySelector('[data-sub="status"]').onclick = () => sessionStorage.setItem("sub:settings", "status");
  el.querySelectorAll("[data-whyai]").forEach((b) => (b.onclick = () => withBusy(b, async () => {
    try { const d = await api(`/api/uploads/${uid}/why/ai`, { method: "POST", json: { key: b.dataset.whyai } }); $("#whyai-" + b.dataset.whyai).innerHTML = md(d.text); }
    catch (e) { $("#whyai-" + b.dataset.whyai).textContent = e.message; }
  })));
  $("#kpiCfg").onclick = () => kpiConfig(uid, r);
};
function kTone(k) {
  if (k.key === "neg") return k.value ? "tone-bad" : "tone-good";
  if (k.key === "margin" && typeof k.value === "number") return k.value < 0 ? "tone-bad" : "tone-good";
  if (k.key === "spi" && typeof k.value === "number") return k.value < 0.8 ? "tone-bad" : k.value < 0.9 ? "tone-warn" : "tone-good";
  if (k.key === "health" && typeof k.value === "number") return k.value < 60 ? "tone-bad" : k.value < 75 ? "tone-warn" : "tone-good";
  if (!k.delta) return "";
  const better = k.good === "up" ? k.delta > 0 : k.delta < 0;
  return better ? "tone-good" : "tone-bad";
}
const KPI_DEFAULT = ["finish", "margin", "spi", "health"];   // 처음에는 4개: 준공·여유·SPI·건전성 (나머지는 '지표 고르기')
const KPI_LABEL = { finish: "예상 준공", margin: "목표 대비 여유", progress: "공정률", health: "건전성", spi: "SPI", neg: "음수 여유 작업" };
async function kpiConfig(uid, r) {
  let cur = [...(prefs.kpis?.length ? prefs.kpis : KPI_DEFAULT)];
  const d = _modal(`<form method="dialog" id="fKpi"><h3>상황판 지표 고르기</h3><p class="muted fs13">체크한 지표만 보이고, ↑↓로 순서를 바꿉니다. 내 계정에만 적용됩니다.</p>
    <ol id="kpiList" class="kpi-cfg"></ol><div class="row end"><button class="btn" value="cancel" formnovalidate>닫기</button><button class="btn" type="button" id="kpiReset">기본값</button><button class="btn primary" value="ok">저장</button></div></form>`);
  const all = () => [...cur, ...Object.keys(KPI_LABEL).filter((k) => !cur.includes(k))];
  const draw = () => {
    const xs = all();
    $("#kpiList").innerHTML = xs.map((k, i) => `<li><label class="chk"><input type="checkbox" data-k="${k}" ${cur.includes(k) ? "checked" : ""}> ${KPI_LABEL[k]}</label>
      <span><button type="button" class="btn sm ghost" data-up="${i}" aria-label="${KPI_LABEL[k]} 위로" ${i ? "" : "disabled"}>↑</button><button type="button" class="btn sm ghost" data-dn="${i}" aria-label="${KPI_LABEL[k]} 아래로" ${i < xs.length - 1 ? "" : "disabled"}>↓</button></span></li>`).join("");
    $("#kpiList").querySelectorAll("[data-k]").forEach((c) => (c.onchange = () => { cur = all().filter((k) => k === c.dataset.k ? c.checked : cur.includes(k)); draw(); }));
    const mv = (i, dlt) => { const xs2 = all(); [xs2[i], xs2[i + dlt]] = [xs2[i + dlt], xs2[i]]; cur = xs2.filter((k) => cur.includes(k)); draw(); };
    $("#kpiList").querySelectorAll("[data-up]").forEach((b) => (b.onclick = () => mv(+b.dataset.up, -1)));
    $("#kpiList").querySelectorAll("[data-dn]").forEach((b) => (b.onclick = () => mv(+b.dataset.dn, 1)));
  };
  draw();
  $("#kpiReset").onclick = () => { cur = [...KPI_DEFAULT]; draw(); };
  $("#fKpi").onsubmit = async (e) => {
    if (e.submitter?.value !== "ok") return; e.preventDefault();
    if (!cur.length) return toast("지표를 하나 이상 고르세요");
    if (me?.username) prefs = await api("/api/me/prefs", { method: "PUT", json: { kpis: cur } }); else prefs.kpis = cur;
    d.close(); showProject(uid, "overview", true);
  };
}

// ---------------------------------------------------------------- ⑧ 코멘트·@멘션
async function commentThread(box, uid, target, { compact = false } = {}) {
  if (!box) return;
  const items = await api(`/api/uploads/${uid}/comments?target=${encodeURIComponent(target)}`).catch(() => []);
  const open = items.filter((c) => !c.resolved), done = items.filter((c) => c.resolved);
  const one = (c) => `<div class="cmt ${c.resolved ? "resolved" : ""}" id="c-${c.id}"><div class="cmt-h"><b>${esc(c.author)}</b><span class="muted">${fmtAt(c.created_at)}</span>
      ${c.resolved ? `<span class="chip ok">✓ 해결${c.resolved_by ? " · " + esc(c.resolved_by) : ""}</span>` : ""}<span class="spacer"></span>
      <button class="btn sm ghost" data-res="${c.id}" data-v="${c.resolved ? 0 : 1}">${c.resolved ? "다시 열기" : "해결"}</button>
      ${c.author === me?.username || me?.role === "admin" || !me?.username ? `<button class="btn sm ghost" data-cdel="${c.id}" aria-label="코멘트 삭제">✕</button>` : ""}</div>
    <div class="cmt-b">${esc(c.text).replace(/@([\w.\-가-힣]+)/g, '<span class="mention">@$1</span>')}</div></div>`;
  box.innerHTML = `${open.map(one).join("") || (compact ? "" : '<p class="muted">아직 코멘트가 없습니다.</p>')}
    ${done.length ? `<details><summary class="muted">해결된 코멘트 ${done.length}건</summary>${done.map(one).join("")}</details>` : ""}
    <form class="cmt-form"><div class="mention-wrap"><textarea class="s" rows="2" placeholder="코멘트 (예: @kim 자재 반입 일정 확인 부탁드립니다)" aria-label="코멘트 입력"></textarea>
      <div class="mention-list" role="listbox" aria-label="언급할 사용자" hidden></div></div><button class="btn sm primary">남기기</button></form>`;
  const ta = box.querySelector("textarea"), ml = box.querySelector(".mention-list");
  ta.addEventListener("input", async () => {
    const m = ta.value.slice(0, ta.selectionStart).match(/@([\w.\-가-힣]*)$/);
    if (!m) { ml.hidden = true; return; }
    const us = (await userList()).filter((u) => u.username.startsWith(m[1])).slice(0, 6);
    ml.innerHTML = us.map((u) => `<button type="button" role="option" data-u="${esc(u.username)}">@${esc(u.username)}</button>`).join("");
    ml.hidden = !us.length;
    ml.querySelectorAll("[data-u]").forEach((b) => (b.onclick = () => {
      const pos = ta.selectionStart, before = ta.value.slice(0, pos).replace(/@[\w.\-가-힣]*$/, "@" + b.dataset.u + " ");
      ta.value = before + ta.value.slice(pos); ml.hidden = true; ta.focus();
    }));
  });
  box.querySelector("form").onsubmit = async (e) => {
    e.preventDefault(); if (!ta.value.trim()) return;
    try { const res = await api(`/api/uploads/${uid}/comments`, { method: "POST", json: { target, text: ta.value } });
      toast(res.mentions.length ? `코멘트를 남기고 ${res.mentions.join(", ")} 님께 알렸습니다` : "코멘트를 남겼습니다"); commentThread(box, uid, target, { compact });
    } catch (err) { toast(err.message); }
  };
  box.querySelectorAll("[data-res]").forEach((b) => (b.onclick = async () => {
    try { await api(`/api/uploads/${uid}/comments/${b.dataset.res}/resolve`, { method: "POST", json: { resolved: b.dataset.v === "1" } }); commentThread(box, uid, target, { compact }); } catch (err) { toast(err.message); }
  }));
  box.querySelectorAll("[data-cdel]").forEach((b) => (b.onclick = async () => {
    if (!(await ui.confirm("이 코멘트를 지울까요?", { ok: "삭제", danger: true }))) return;
    await api(`/api/uploads/${uid}/comments/${b.dataset.cdel}`, { method: "DELETE" }); commentThread(box, uid, target, { compact });
  }));
  const hl = new URLSearchParams(location.hash.split("?")[1] || "").get("c");
  if (hl) box.querySelector("#c-" + hl)?.classList.add("flash");
}
function openComments(uid, target, title) {
  const d = openDrawer(`💬 ${esc(title)}`, `<div id="drawerCmt"></div>`);
  commentThread(d.querySelector("#drawerCmt"), uid, target);
}

// ---------------------------------------------------------------- ⑦ 월간 점검: 팀 기록(확인자·시각·메모)
showWizard = async function (uid) {
  ++navToken;
  view.innerHTML = skeleton("tab");
  const u = await loadHead(uid); const r = u.result;
  const perm = await api(`/api/uploads/${uid}/perm`).catch(() => ({}));
  ctx.uid = uid; ctx.result = cache[uid]?.result || null; ctx.tab = "wizard"; ctx.canWrite = perm.can_write !== false;
  $("#crumb").innerHTML = `/ <a href="#/p/${uid}/overview">${esc(r.name)}</a> / 월간 업데이트 점검`;
  const rv = await api(`/api/uploads/${uid}/review${baseQuery(r.name)}`);
  const so = rv.signoff || { steps: {} };
  const signed = (k) => so.steps?.[k];
  const cur = Math.min(+(sessionStorage.getItem("wizStep:" + uid) || 0), rv.steps.length - 1);
  const badge = (s) => s.ok === null ? '<span class="chip">정보</span>' : s.ok ? '<span class="chip ok">✓ 이상 없음</span>' : '<span class="chip warn">! 확인 필요</span>';
  const st = rv.steps[cur], sg = signed(st.key);
  view.innerHTML = `<div class="row between"><div><h2 class="m0">월간 업데이트 점검</h2>
      <div class="muted">${esc(r.name)} · DD ${rv.data_date}${rv.base_data_date ? ` (비교: DD ${rv.base_data_date})` : ""}</div></div>
      <div class="row">${so.completed_by ? `<span class="chip ok">✓ 점검 완료 · ${esc(so.completed_by)} ${fmtAt(so.completed_at)}</span>` : `<span class="chip">${Object.keys(so.steps || {}).length}/${rv.steps.length} 단계 확인</span>`}
        <button class="btn" id="wzUpload" data-need="editor">${icon("upload")} 새 업데이트 올리기</button><a class="btn" href="#/p/${uid}/overview">상황판</a></div></div>
    <ol class="stepper">${rv.steps.map((x, i) => `<li class="${i === cur ? "on" : ""} ${signed(x.key) ? "done" : ""}"><button data-st="${i}" title="${signed(x.key) ? `확인: ${esc(signed(x.key).by)} ${fmtAt(signed(x.key).at)}` : "미확인"}">
      <span class="n">${signed(x.key) ? "✓" : i + 1}</span><span>${esc(x.title)}</span>${x.ok === false ? '<span class="dot" aria-label="확인 필요"></span>' : ""}</button></li>`).join("")}</ol>
    <div class="panel wiz"><div class="row between"><h3 class="m0">${cur + 1}. ${esc(st.title)}</h3>${badge(st)}</div>
      <p style="font-size:16px">${esc(st.summary)}</p>
      ${st.issues.length ? `<ul>${st.issues.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${(st.detail || []).length ? `<details><summary>주의 변경 ${st.detail.length}건</summary><ul>${st.detail.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>` : ""}
      ${st.key === "report" ? `<p>보고서 센터에서 이번 달 출력물을 만듭니다. 비교 기준(${rv.base_data_date || "없음"})이 그대로 적용됩니다.</p><a class="btn primary" href="#/reports/${uid}">보고서 센터 열기 →</a>`
        : `<a class="btn" href="#/p/${uid}/${st.tab}">자세히 보기 →</a>`}
      <div class="signoff">${sg ? `<div class="chip ok">✓ ${esc(sg.by)} 님이 ${fmtAt(sg.at)}에 확인${sg.note ? ` · “${esc(sg.note)}”` : ""}</div>` : '<div class="muted">아직 이 단계를 확인한 사람이 없습니다.</div>'}
        ${ctx.canWrite ? `<label class="muted db mt8">확인 메모 (선택, 팀에 공유)<input class="s" id="wzNote" style="width:100%" maxlength="500" value="${esc(sg?.note || "")}" placeholder="예: 철골 공기 단축은 협력사 회의 결과 반영"></label>` : ""}</div>
      <div class="nav mt16"><button class="btn" id="wzPrev" ${cur ? "" : "disabled"}>← 이전</button>
        <button class="btn primary" id="wzNext">${ctx.canWrite ? (cur < rv.steps.length - 1 ? "확인했습니다 · 다음 →" : "점검 완료 ✓") : (cur < rv.steps.length - 1 ? "다음 →" : "상황판으로")}</button></div></div>`;
  applyRole(view);
  const go = (i) => { sessionStorage.setItem("wizStep:" + uid, String(i)); showWizard(uid); };
  view.querySelectorAll("[data-st]").forEach((b) => (b.onclick = () => go(+b.dataset.st)));
  $("#wzPrev").onclick = () => go(cur - 1);
  $("#wzNext").onclick = async () => {
    if (ctx.canWrite) {
      try {
        const res = await api(`/api/uploads/${uid}/review/sign`, { method: "POST", json: { key: st.key, note: $("#wzNote")?.value || "" } });
        if (cur === rv.steps.length - 1 || res.completed_by && !so.completed_by) {
          if (res.completed_by) { toast("이번 달 점검을 마쳤습니다 ✓ 팀에 기록되었습니다"); location.hash = `#/p/${uid}/overview`; return; }
          const left = rv.steps.findIndex((x) => !res.steps[x.key]);
          if (left >= 0) { toast("확인하지 않은 단계가 남아 있습니다"); return go(left); }
        }
      } catch (e) { return toast(e.message); }
    }
    if (cur < rv.steps.length - 1) go(cur + 1); else location.hash = `#/p/${uid}/overview`;
  };
  $("#wzUpload").onclick = () => $("#btnUpload").click();
  if (sessionStorage.getItem("tour")) maybeStartTour("wizard");
};

// ---------------------------------------------------------------- ③ 홈: 프로젝트 단위 묶음 · 정렬·필터 · ⑨ 내게 배정된 일
function projectLevel(p) {
  if ((p.margin ?? 0) < 0 || p.negative_float > 0 || (p.health ?? 100) < 60) return "bad";
  if ((p.slip ?? 0) > 0 || (p.health ?? 100) < 75 || (p.spi ?? 1) < 0.9 || p.open_risks > 0) return "warn";
  return "ok";
}
showList = async function () {
  $("#crumb").textContent = "";
  view.innerHTML = skeleton();
  const my = ++navToken;
  const [list, pf] = await Promise.all([api("/api/uploads"), api("/api/portfolio")]);
  if (my !== navToken) return;  // 그 사이 다른 화면으로 이동함
  if (!list.length) {
    view.innerHTML = `<div class="panel empty"><h2>업로드된 공정표가 없습니다</h2>
      <p>P6 XER 또는 MS Project 파일을 올리거나, 템플릿·문서로 초기 공정표를 만들어 보세요.</p>
      <div class="row center"><button class="btn primary" onclick="$('#btnUpload').click()">파일 업로드</button>
      <button class="btn" onclick="showGenerate()">새 공정표 만들기</button></div></div>`;
    return;
  }
  const sig = (v, good, warn) => v === null || v === undefined ? "" : v >= good ? "ok" : v >= warn ? "warn" : "bad";
  const st = JSON.parse(store.get("pfView", '{"sort":"risk","lv":"all"}'));
  const favs = JSON.parse(store.get("favs", "[]"));
  const byName = {}; list.forEach((u) => (byName[u.name] ||= []).push(u));
  const lvAll = pf.map((p) => p.level || projectLevel(p)); const cnt = (k) => lvAll.filter((x) => x === k).length;
  const avgH = pf.length ? Math.round(pf.reduce((a, p) => a + (p.health || 0), 0) / pf.length) : "-";
  const nextFin = pf.map((p) => p.finish).sort()[0];
  view.innerHTML = `<div class="page-head"><div><h2>홈</h2><p>${me?.username ? `${esc(me.username)} 님, ` : ""}팀 프로젝트 ${pf.length}개의 현재 상황입니다.</p></div>
    <div class="row"><button class="btn" onclick="showGenerate()" data-need="editor">${icon("sparkles", 15)} 새 공정표 만들기</button><button class="btn primary" onclick="$('#btnUpload').click()" data-need="editor">${icon("upload", 15)} 업데이트 올리기</button></div></div>
  <div class="sum-band">
    <div class="s"><div class="l">프로젝트 상태</div><div class="v">${pf.length}<small class="muted" style="font-size:13px;font-weight:500"> 개</small></div>
      <div class="dist" role="img" aria-label="정상 ${cnt("ok")}, 주의 ${cnt("warn")}, 위험 ${cnt("bad")}">${["ok", "warn", "bad"].map((k) => `<i class="${k}" style="width:${pf.length ? (100 * cnt(k)) / pf.length : 0}%"></i>`).join("")}</div>
      <div class="muted" style="font-size:12px;margin-top:6px">정상 ${cnt("ok")} · 주의 ${cnt("warn")} · 위험 ${cnt("bad")}</div></div>
    <div class="s"><div class="l">평균 건전성</div><div class="v">${avgH}<small class="muted" style="font-size:13px;font-weight:500"> 점</small></div></div>
    <div class="s"><div class="l">열린 리스크</div><div class="v">${pf.reduce((a, p) => a + (p.open_risks || 0), 0)}</div></div>
    <div class="s"><div class="l">월간 점검 완료</div><div class="v">${pf.filter((p) => p.review?.completed_by).length}<small class="muted" style="font-size:13px;font-weight:500"> / ${pf.length}</small></div></div>
    <div class="s"><div class="l">가장 빠른 준공</div><div class="v" style="font-size:20px">${nextFin || "-"}</div></div>
  </div>
  <div class="home-grid"><div>
  <div class="row" style="justify-content:space-between;margin-bottom:12px"><h3 class="m0">포트폴리오 <span class="muted" id="pfCount"></span></h3>
    <div class="row"><label class="muted">정렬 <select class="s sm" id="pfSort">${[["risk", "위험 높은 순"], ["slip", "지연 큰 순"], ["recent", "최근 업데이트 순"], ["name", "이름 순"]].map(([k, l]) => `<option value="${k}" ${st.sort === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <div class="seg-tabs sm" role="group" aria-label="상태 필터">${[["all", "전체"], ["bad", "위험"], ["warn", "주의"], ["ok", "정상"]].map(([k, l]) => `<button class="${st.lv === k ? "on" : ""}" data-lv="${k}">${l}</button>`).join("")}</div>
      </div></div>
  <div class="cards" id="pfCards"></div></div>
  <aside><div id="myTasks"></div><div id="inbox"></div></aside></div>
  <div class="panel">
    <div class="row between mb10">
      <h3 class="m0">팀 공정표 <span class="muted">(프로젝트 ${Object.keys(byName).length} · 업데이트 ${list.length})</span></h3>
      <div class="row"><span class="muted">업데이트 비교:</span>
        <select class="s" id="cmpA" aria-label="비교 이전">${list.map((u) => `<option value="${u.id}">${esc(u.name)} · ${u.data_date}</option>`).join("")}</select><span>→</span>
        <select class="s" id="cmpB" aria-label="비교 이후">${list.map((u) => `<option value="${u.id}">${esc(u.name)} · ${u.data_date}</option>`).join("")}</select>
        <button class="btn" id="btnCmp">비교</button></div></div>
    <div class="proj-groups">${Object.entries(byName).map(([n, ups]) => {
      ups.sort((a, b) => (b.data_date + b.created_at).localeCompare(a.data_date + a.created_at)); const top = ups[0];
      return `<details class="pgroup"><summary><span class="pg-name"><b>${esc(n)}</b> <span class="muted">${esc(top.filename)}</span></span>
          <span>DD ${top.data_date}</span><span>준공 ${top.finish}</span><span class="muted">${ups.length}회 업데이트</span>
          <span class="muted pg-more">이력 ▾</span></summary>
        <div class="row" style="margin:0 12px 6px"><a class="btn sm primary" href="#/p/${top.id}/overview">최신 업데이트 열기 →</a></div>
        <table class="t" data-noexport><thead><tr><th>Data Date</th><th>예상 준공</th><th class="num">액티비티</th><th>메모</th><th>업로더</th><th>업로드 시각</th><th></th></tr></thead><tbody>
        ${ups.map((u, i) => `<tr><td><a href="#/p/${u.id}/overview">${u.data_date}</a>${i === 0 ? ' <span class="chip ok">최신</span>' : ""}</td><td>${u.finish}</td><td class="num">${u.activities}</td>
          <td class="wrap">${esc(u.note)}</td><td>${esc(u.uploader)}</td><td>${u.created_at.replace("T", " ").slice(0, 16)}</td>
          <td><button class="btn sm" data-xer="${u.id}">XER</button>${ups[i + 1] ? ` <a class="btn sm" href="#/cmp/${ups[i + 1].id}/${u.id}">직전 비교</a>` : ""}
            <button class="btn sm danger" data-del="${u.id}" data-need="admin">삭제</button></td></tr>`).join("")}</tbody></table></details>`;
    }).join("")}</div></div>`;
  const draw = () => {
    let xs = pf.map((p) => ({ ...p, lv: p.level || projectLevel(p) }));
    if (st.lv !== "all") xs = xs.filter((p) => p.lv === st.lv);
    const rank = { bad: 0, warn: 1, ok: 2 };
    const cmp = { risk: (a, b) => rank[a.lv] - rank[b.lv] || (a.margin ?? 1e9) - (b.margin ?? 1e9), slip: (a, b) => (b.slip ?? -1e9) - (a.slip ?? -1e9),
      recent: (a, b) => (b.data_date + (b.created_at || "")).localeCompare(a.data_date + (a.created_at || "")), name: (a, b) => a.name.localeCompare(b.name) }[st.sort];
    xs.sort((a, b) => favs.includes(b.name) - favs.includes(a.name) || cmp(a, b));
    $("#pfCount").textContent = `(${xs.length}/${pf.length})`;
    const LV = { ok: "정상", warn: "주의", bad: "위험" };
    $("#pfCards").innerHTML = xs.map((p) => `<div class="card lv-${p.lv} ${favs.includes(p.name) ? "fav" : ""}">
      <a class="card-main" href="#/p/${p.id}/overview">
        <div class="pc-head"><div><b>${favs.includes(p.name) ? "★ " : ""}${esc(p.name)}</b><div class="pc-sub">Data Date ${p.data_date} · 업데이트 ${p.updates}회</div></div><span class="status-badge ${p.lv}">${LV[p.lv]}</span></div>
        <div class="pc-finish"><span class="d">${p.finish}</span><span class="l">예상 준공</span></div>
        <div class="pc-stats">
          <div><div class="l">목표 대비</div><div class="v ${p.margin === null ? "" : p.margin >= 0 ? "ok" : "bad"}">${p.margin === null ? "-" : (p.margin >= 0 ? "+" : "") + p.margin + "일"}</div></div>
          <div><div class="l">건전성</div><div class="v ${sig(p.health, 75, 60)}">${p.health ?? "-"}</div></div>
          <div><div class="l">SPI</div><div class="v ${p.spi === null ? "" : sig(p.spi, 0.95, 0.85)}">${p.spi ?? "-"}</div></div></div>
        <div class="bar" title="공정률 ${p.progress}%"><i style="width:${p.progress}%"></i></div>
        <div class="pc-foot"><span>공정률 ${p.progress}%</span>
          ${p.slip !== null && p.slip !== 0 ? `<span class="${p.slip > 0 ? "bad" : "ok"}">전회 대비 ${p.slip > 0 ? "+" : ""}${p.slip}일</span>` : ""}
          ${p.open_risks ? `<span>리스크 ${p.open_risks}</span>` : ""}${p.negative_float ? `<span class="bad">음수 여유 ${p.negative_float}</span>` : ""}
          <span class="${p.review?.completed_by ? "ok" : ""}" title="${p.review?.completed_at ? fmtAt(p.review.completed_at) : ""}">${p.review?.completed_by ? `✓ 점검 ${esc(p.review.completed_by)}` : `점검 ${p.review?.steps || 0}/6`}</span></div></a>
      ${p.history?.length > 1 ? `<details class="card-hist"><summary>업데이트 이력 ${p.history.length}</summary>${p.history.map((h, i) => `<a href="#/p/${h.id}/overview" class="hist-row"><span>DD ${h.data_date}</span><span>${h.finish}</span>
        ${p.history[i + 1] ? `<span class="${h.finish > p.history[i + 1].finish ? "crit" : ""}">${h.finish > p.history[i + 1].finish ? "▼ 지연" : h.finish < p.history[i + 1].finish ? "▲ 단축" : "="}</span>` : "<span></span>"}</a>`).join("")}</details>` : ""}</div>`).join("")
      || '<p class="muted">조건에 맞는 프로젝트가 없습니다.</p>';
  };
  draw();
  $("#pfSort").onchange = (e) => { st.sort = e.target.value; store.set("pfView", JSON.stringify(st)); draw(); };
  view.querySelectorAll("[data-lv]").forEach((b) => (b.onclick = () => { st.lv = b.dataset.lv; store.set("pfView", JSON.stringify(st)); view.querySelectorAll("[data-lv]").forEach((x) => x.classList.toggle("on", x === b)); draw(); }));
  renderInbox($("#inbox"));
  renderMyTasks($("#myTasks"));
  enhance(view);
  if (list.length > 1) $("#cmpA").selectedIndex = 1;
  $("#btnCmp").onclick = () => (location.hash = `#/cmp/${$("#cmpA").value}/${$("#cmpB").value}`);
  view.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!(await ui.confirm("이 업로드를 삭제할까요? 팀 전체에서 사라집니다.", { ok: "삭제", danger: true }))) return;
    delete cache[b.dataset.del]; delete liteCache[b.dataset.del];
    await deleteWithUndo(`/api/uploads/${b.dataset.del}`, "업로드", () => { uploadsCache = null; showList(); });
  }));
  view.querySelectorAll("[data-xer]").forEach((b) => (b.onclick = () => download(`/api/uploads/${b.dataset.xer}/xer`, "project.xer")));
};
async function renderMyTasks(box) {
  if (!me?.username) return;
  const xs = await api("/api/my/tasks").catch(() => []);
  if (!xs.length) { box.innerHTML = ""; return; }
  const today = new Date().toISOString().slice(0, 10);
  box.innerHTML = `<div class="panel"><h3 class="mt0">내게 배정된 일 <span class="muted">(${xs.length})</span></h3><div class="inbox">
    ${xs.map((t) => `<a class="inbox-item ${t.due && t.due < today ? "high" : "mid"}" href="#/p/${t.uid}/${t.tab}${t.kind === "멘션" ? "?c=" + t.id : ""}">
      <span class="sev">${t.kind === "멘션" ? "@" : t.kind === "리스크" ? "!" : "▣"}</span>
      <span><span class="tag">${esc(t.kind)}</span> <b>${esc(t.project)}</b> ${esc(t.text)}</span>
      <span class="${t.due && t.due < today ? "crit" : "muted"}">${t.due ? (t.due < today ? "기한 지남 " : "기한 ") + t.due : ""}</span></a>`).join("")}</div></div>`;
}

// ---------------------------------------------------------------- ④ 설정 하위 탭
tabSettings = async function (el, r, uid) {
  subTabs(el, [["members", "멤버·권한", (s) => renderMembers(s, r.name)], ["calc", "계산 옵션", (s) => settingsCalc(s, r, uid)],
    ["quality", "품질 기준", (s) => settingsQuality(s, r, uid)], ["status", "상태 기준", (s) => settingsStatus(s, r, uid)]], "sub:settings");
};
async function settingsCalc(el, r, uid) {
  const st = await api(`/api/uploads/${uid}/settings`);
  el.innerHTML = `<div class="panel"><h3 class="mt0">일정 계산 옵션</h3>
      <label><input type="checkbox" id="optPO" ${st.schedule_options.progress_override ? "checked" : ""}> Progress Override (착수된 작업은 선행 논리를 무시하고 Data Date부터 잔여 작업 진행)</label>
      <p class="muted">기본값은 Retained Logic(P6 기본)입니다. P6의 Schedule Options와 같게 맞추면 'P6 일정 비교' 일치율이 올라갑니다. 변경하면 이 프로젝트의 모든 업데이트를 다시 계산합니다.</p>
      <button class="btn primary" id="optSave" data-need="editor">저장 및 재계산</button></div>`;
  applyRole(el);
  $("#optSave").onclick = () => withBusy($("#optSave"), async () => {
    await api(`/api/uploads/${uid}/settings`, { method: "PUT", json: { schedule_options: { progress_override: $("#optPO").checked } } });
    cache = {}; Object.keys(liteCache).forEach((k) => delete liteCache[k]); toast("재계산했습니다"); showProject(uid, "settings");
  });
}
async function settingsQuality(el, r, uid) {
  const [st, defs] = await Promise.all([api(`/api/uploads/${uid}/settings`), api("/api/metrics/defaults")]);
  const ov = st.metric_overrides;
  el.innerHTML = `<div class="panel"><h3 class="mt0">건전성 지표 기준값 (이 프로젝트)</h3>
      <p class="muted">비워 두면 팀 기본값(${Object.keys(st.team_metric_overrides).length ? "관리자 설정" : "표준값"})을 씁니다. 가중치 0은 점수에서 제외합니다.</p>
      <div class="scroll"><table class="t"><thead><tr><th>ID</th><th>그룹</th><th>항목</th><th>비교</th><th>기본 기준</th><th>기준</th><th>가중치</th><th>사용</th></tr></thead><tbody>
      ${defs.map((d) => { const o = ov[d.id] || {}; return `<tr><td>${d.id}</td><td>${d.group}</td><td>${esc(d.name)}</td><td>${d.cmp === "le" ? "≤" : d.cmp === "ge" ? "≥" : "참고"}</td><td>${d.threshold ?? "-"}${d.unit === "%" ? "%" : ""}</td>
        <td><input class="s" style="width:70px" data-id="${d.id}" data-k="threshold" value="${o.threshold ?? ""}" ${d.cmp === "info" ? "disabled" : ""} aria-label="${esc(d.name)} 기준"></td>
        <td><input class="s" style="width:60px" data-id="${d.id}" data-k="weight" value="${o.weight ?? ""}" placeholder="${d.weight}" aria-label="${esc(d.name)} 가중치"></td>
        <td><input type="checkbox" data-id="${d.id}" data-k="enabled" ${o.enabled === false ? "" : "checked"} aria-label="${esc(d.name)} 사용"></td></tr>`; }).join("")}</tbody></table></div>
      <div class="row end"><button class="btn primary" id="mSave" data-need="editor">기준값 저장</button></div></div>`;
  applyRole(el); enhance(el);
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

// ---------------------------------------------------------------- ⑩ 엑셀 붙여넣기 일괄 입력
const BULK = {
  constraint: { label: "제약", cols: [["code", "작업 ID"], ["type", "유형"], ["desc", "내용"], ["owner", "담당(업체)"], ["assignee", "담당자 아이디"], ["due", "해소 기한"], ["status", "상태"]] },
  commit: { label: "주간 약속", cols: [["week", "주(월요일)"], ["code", "작업 ID"], ["name", "작업명"], ["company", "협력업체"], ["note", "메모"]] },
  risk: { label: "리스크", cols: [["title", "제목"], ["category", "분류"], ["codes", "영향 작업 ID"], ["prob", "확률%"], ["impact_min", "영향 최소"], ["impact_ml", "영향 최빈"], ["impact_max", "영향 최대"], ["cost", "비용"], ["owner", "담당"], ["assignee", "담당자 아이디"], ["due", "기한"], ["mitigation", "대응 방안"]] },
};
function parsePaste(text, kind) {
  const spec = BULK[kind].cols;
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (!lines.length) return [];
  const split = (l) => (l.includes("\t") ? l.split("\t") : l.split(",")).map((x) => x.trim().replace(/^"|"$/g, ""));
  const head = split(lines[0]);
  const find = (h) => spec.findIndex(([k, l]) => h === k || h === l || l.startsWith(h) || h.replace(/\s/g, "") === l.replace(/\s/g, ""));
  const mapped = head.map(find);
  const hasHeader = mapped.filter((i) => i >= 0).length >= Math.min(2, head.length);
  const order = hasHeader ? mapped : spec.map((_, i) => i);
  const norm = (v) => { const m = v.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/); return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : v; };
  return lines.slice(hasHeader ? 1 : 0).map((l) => {
    const cells = split(l), o = {};
    cells.forEach((v, i) => { const j = order[i]; if (j === undefined || j < 0 || v === "") return; const k = spec[j][0];
      o[k] = ["prob", "impact_min", "impact_ml", "impact_max", "cost"].includes(k) ? +v.replace(/[,%]/g, "") : k === "codes" ? v.split(/[\s,;]+/).filter(Boolean) : norm(v); });
    return o;
  });
}
async function bulkPaste(uid, kind, onDone) {
  const spec = BULK[kind];
  const d = _modal(`<form method="dialog" id="fBulk" style="min-width:min(760px,92vw)"><h3>엑셀에서 붙여넣기 · ${spec.label}</h3>
    <p class="muted fs13">엑셀에서 표를 복사(Ctrl+C)해 아래에 붙여넣으세요(Ctrl+V). 첫 줄이 머리글이면 열 이름으로 맞추고, 없으면 다음 순서로 읽습니다:<br><b>${spec.cols.map(([, l]) => l).join(" · ")}</b></p>
    <textarea id="bkText" rows="8" style="width:100%" aria-label="붙여넣을 표" placeholder="${spec.cols.map(([, l]) => l).join("\t")}"></textarea>
    <div class="row"><button type="button" class="btn" id="bkTpl">머리글 줄 복사</button><span class="spacer"></span><button type="button" class="btn" id="bkCheck">미리보기·검사</button></div>
    <div id="bkOut" aria-live="polite"></div>
    <div class="row end"><button class="btn" value="cancel" formnovalidate>닫기</button><button class="btn primary" value="ok" id="bkSave" disabled>저장</button></div></form>`);
  let rows = [];
  $("#bkTpl").onclick = () => copyText(spec.cols.map(([, l]) => l).join("\t"));
  $("#bkCheck").onclick = async () => {
    rows = parsePaste($("#bkText").value, kind);
    if (!rows.length) { $("#bkOut").innerHTML = '<p class="err">붙여넣은 내용이 없습니다.</p>'; return; }
    const res = await api(`/api/uploads/${uid}/bulk/${kind}`, { method: "POST", json: { rows, dry_run: true } });
    const bad = new Map(res.errors.map((e) => [e.row, e.error]));
    $("#bkOut").innerHTML = `<p><b>${res.valid}행 저장 가능</b>${res.errors.length ? ` · <span class="crit">${res.errors.length}행 오류(저장 시 제외)</span>` : ""}</p>
      <div class="scroll" style="max-height:260px"><table class="t" data-noexport><thead><tr><th>#</th>${spec.cols.map(([, l]) => `<th>${esc(l)}</th>`).join("")}<th>검사</th></tr></thead><tbody>
      ${rows.slice(0, 200).map((x, i) => `<tr class="${bad.has(i + 1) ? "bad-row" : ""}"><td>${i + 1}</td>${spec.cols.map(([k]) => `<td>${esc(Array.isArray(x[k]) ? x[k].join(", ") : x[k] ?? "")}</td>`).join("")}
        <td>${bad.has(i + 1) ? `<span class="crit">✕ ${esc(bad.get(i + 1))}</span>` : "✓"}</td></tr>`).join("")}</tbody></table></div>`;
    $("#bkSave").disabled = !res.valid;
  };
  $("#fBulk").onsubmit = async (e) => {
    if (e.submitter?.value !== "ok") return; e.preventDefault();
    const res = await api(`/api/uploads/${uid}/bulk/${kind}`, { method: "POST", json: { rows } });
    d.close(); toast(`${res.saved}건을 저장했습니다${res.errors.length ? ` (${res.errors.length}건 제외)` : ""}`); onDone?.();
  };
}

// ---------------------------------------------------------------- ⑨ 담당자(사용자)·기한: 리스크·제약 화면 보강
const _tabLookahead0 = tabLookahead;
tabLookahead = async function (el, r, uid) {
  await _tabLookahead0(el, r, uid);
  const la = await api(`/api/uploads/${uid}/lookahead`);
  const users = await userList();
  const cl = [...el.querySelectorAll(".panel h3")].find((h) => h.textContent.startsWith("제약 로그"));
  if (cl) {
    cl.insertAdjacentHTML("afterend", `<div class="row" style="margin:-4px 0 8px"><span class="muted fs12">담당자를 지정하면 그 사람의 홈 '내게 배정된 일'과 알림에 나타납니다.</span><span class="spacer"></span>
      <button class="btn sm" id="laBulkC" data-need="editor">제약 엑셀 붙여넣기</button><button class="btn sm" id="laBulkK" data-need="editor">약속 엑셀 붙여넣기</button></div>`);
    $("#laBulkC").onclick = () => bulkPaste(uid, "constraint", () => tabLookahead(el, r, uid));
    $("#laBulkK").onclick = () => bulkPaste(uid, "commit", () => tabLookahead(el, r, uid));
    const tbl = cl.parentElement.querySelector("table");
    tbl.querySelector("thead tr th:nth-child(4)").insertAdjacentHTML("afterend", "<th>담당자</th>");
    tbl.querySelectorAll("[data-cst]").forEach((s) => {
      const x = la.constraints.find((y) => y.id === s.dataset.cst);
      s.closest("tr").querySelector("td:nth-child(4)").insertAdjacentHTML("afterend", `<td><select class="s sm" data-asg="${x.id}" aria-label="담당자" ${ctx.canWrite ? "" : "disabled"}><option value="">-</option>${users.map((u) => `<option ${x.assignee === u.username ? "selected" : ""}>${esc(u.username)}</option>`).join("")}</select></td>`);
    });
    tbl.querySelectorAll("[data-asg]").forEach((s) => (s.onchange = async () => {
      const x = la.constraints.find((y) => y.id === s.dataset.asg);
      if (await saveRec(`/api/uploads/${uid}/records/constraint`, { ...x, assignee: s.value, base_updated_at: x.updated_at }, () => tabLookahead(el, r, uid))) {
        toast(s.value ? `${s.value} 님을 담당자로 지정했습니다` : "담당자를 비웠습니다"); tabLookahead(el, r, uid);
      }
    }));
    // 6차: 해소 기한 표에서 바로 고치기
    if (ctx.canWrite) tbl.querySelectorAll("[data-cst]").forEach((sel) => {
      const x = la.constraints.find((y) => y.id === sel.dataset.cst);
      const td = sel.closest("td").previousElementSibling;
      td.innerHTML = `<input class="s sm" type="date" value="${x.due || ""}" aria-label="해소 기한" style="${x.status !== "해결" && x.due && x.due < la.data_date ? "border-color:var(--crit)" : ""}">`;
      td.firstChild.onchange = async (e) => { if (await saveRec(`/api/uploads/${uid}/records/constraint`, { ...x, due: e.target.value, base_updated_at: x.updated_at }, () => tabLookahead(el, r, uid))) { toast("기한을 바꿨습니다"); tabLookahead(el, r, uid); } };
    });
    applyRole(cl.parentElement);
  }
};

// ---------------------------------------------------------------- ② 보고서 센터 (Word · 엑셀 · A3 · CSV + 출력물 이력)
const _showReports0 = showReports;
showReports = async function (preUid) {
  ++navToken;
  view.innerHTML = skeleton();
  await _showReports0(preUid);
  $("#crumb").textContent = "/ 보고서 센터";
  const h2 = view.querySelector("h2"); if (h2) h2.textContent = "🗂 보고서 센터";
  h2?.insertAdjacentHTML("afterend", `<div class="out-cards" role="list">
    <div class="out-card" role="listitem"><b>📝 Word 월간 보고서</b><span class="muted">AI 초안 + 직접 편집, .docx</span><div class="row"><a class="btn sm" id="ocWordEdit">작성·편집</a><button class="btn sm" id="ocWord">바로 내려받기</button></div></div>
    <div class="out-card on" role="listitem"><b>📊 엑셀 양식 리포트</b><span class="muted">회사 양식(.xlsx)에 자동 채움 · 아래 ①~③</span><div class="row"><a class="btn sm" href="#rpGo" onclick="event.preventDefault();$('#rpGo').scrollIntoView({block:'center'});$('#rpGo').focus()">아래에서 만들기</a></div></div>
    <div class="out-card" role="listitem"><b>🖨 A3 공정표 인쇄</b><span class="muted">바 차트 A3 가로, PDF로 저장 가능</span><div class="row"><a class="btn sm" id="ocPrint">인쇄 화면</a></div></div>
    <div class="out-card" role="listitem"><b>📄 CSV 데이터</b><span class="muted">전체 액티비티 표, 엑셀에서 열기</span><div class="row"><button class="btn sm" id="ocCsv">내려받기</button></div></div></div>
    <p class="muted fs13">카드의 출력물은 아래 ② 에서 고른 프로젝트·업데이트 기준으로 만듭니다.</p>`);
  const cur = () => $("#rpUp")?.value;
  $("#ocWordEdit").onclick = () => (location.hash = `#/p/${cur()}/report`);
  $("#ocWord").onclick = () => download(`/api/uploads/${cur()}/report.docx`, "report.docx");
  $("#ocPrint").onclick = () => (location.hash = `#/print/${cur()}`);
  $("#ocCsv").onclick = () => download(`/api/uploads/${cur()}/activities.csv`, "activities.csv");
  // 이력: 출력물 종류 열 + 필터
  const hist = await api("/api/reports/history").catch(() => []);
  const hp = [...view.querySelectorAll(".panel h3")].find((h) => h.textContent.startsWith("최근 생성 이력"));
  if (hp) {
    const types = [...new Set(hist.map((h) => h.type || "엑셀 양식"))];
    const panel = hp.parentElement;
    const drawH = (t) => {
      const xs = hist.filter((h) => !t || (h.type || "엑셀 양식") === t).slice(0, 20);
      panel.innerHTML = `<div class="row between"><h3 class="m0">최근 출력물 이력</h3>
        <select class="s sm" id="hType" aria-label="출력물 종류"><option value="">전체 종류</option>${types.map((x) => `<option ${x === t ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div>
        <table class="t" data-noexport><thead><tr><th>시각</th><th>종류</th><th>프로젝트</th><th>양식</th><th>작성자</th></tr></thead><tbody>
        ${xs.map((h) => `<tr><td>${fmtAt(h.created_at)}</td><td><span class="tag">${esc(h.type || "엑셀 양식")}</span></td><td>${esc(h.project)} <span class="muted">${h.data_date}</span></td>
          <td>${esc(h.type && h.type !== "엑셀 양식" ? "-" : h.template)}</td><td>${esc(h.author)}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">이력이 없습니다.</td></tr>'}</tbody></table>`;
      $("#hType").onchange = (e) => drawH(e.target.value);
    };
    drawH("");
  }
  if (sessionStorage.getItem("tour")) maybeStartTour("reports");
};
const _showPrint0 = showPrint;
showPrint = async function (uid) {
  await _showPrint0(uid);
  api(`/api/uploads/${uid}/outputs/log`, { method: "POST", json: { kind: "print" } }).catch(() => {});
};
// 그룹 메뉴의 '엑셀 리포트' → 보고서 센터
GROUPS.forEach(([, ts]) => ts.forEach((t) => { if (t[0] === "xlsx") t[1] = "보고서 센터"; }));
TAB_LABEL.xlsx = "보고서 센터";

// ---------------------------------------------------------------- ⑪⑫⑬ 사용자 설정: 알림 종류 · 시작 화면 · 용어 표기
async function showPrefs() {
  const p = await loadPrefs();
  const types = p.types || {};
  const d = _modal(`<form method="dialog" id="fPrefs"><h3>⚙ 환경 설정</h3>
    <h4>시작 화면</h4><p class="muted fs13">로그인 후 처음 열 화면입니다.</p>
    <select class="s" name="start_page" style="width:100%">${[["home", "홈 (오늘 확인할 것 + 포트폴리오)"], ["portfolio", "포트폴리오만"], ["wizard", "내 최근 프로젝트의 월간 점검"], ["field", "내 최근 프로젝트의 현장 모드"], ["reports", "보고서 센터"]]
      .map(([k, l]) => `<option value="${k}" ${p.start_page === k ? "selected" : ""}>${l}</option>`).join("")}</select>
    <h4>용어 표기</h4>
    <label class="chk"><input type="radio" name="term_mode" value="mixed" ${p.term_mode !== "ko" ? "checked" : ""}> 실무 영문 (TF, SPI, Data Date …)</label>
    <label class="chk"><input type="radio" name="term_mode" value="ko" ${p.term_mode === "ko" ? "checked" : ""}> 한글 우선 (총여유(TF), 일정지수(SPI), 기준일 …)</label>
    <h4>받을 알림</h4>${Object.entries(types).map(([k, l]) => `<label class="chk"><input type="checkbox" name="notify" value="${k}" ${p.notify.includes(k) ? "checked" : ""}> ${esc(l)}</label>`).join("")}
    <div class="row end"><button class="btn" value="cancel" formnovalidate>닫기</button><button class="btn primary" value="ok">저장</button></div></form>`);
  $("#fPrefs").onsubmit = async (e) => {
    if (e.submitter?.value !== "ok") return; e.preventDefault();
    const fd = new FormData(e.target);
    prefs = await api("/api/me/prefs", { method: "PUT", json: { start_page: fd.get("start_page"), term_mode: fd.get("term_mode"), notify: fd.getAll("notify") } });
    store.set("termMode", prefs.term_mode); d.close(); toast("설정을 저장했습니다"); route();
  };
}
// ⑬ 한글 우선 표기
const TERM_KO = [["Data Date", "기준일"], ["Total Float", "총여유"], ["Free Float", "자유여유"], ["TF", "총여유"], ["FF", "자유여유"], ["SPI", "일정지수"], ["CPI", "원가지수"],
  ["PPC", "주간 완료율"], ["What-if", "가정 분석"], ["S-Curve", "누적 공정곡선"], ["Lag", "간격"], ["Early", "빠른 일정"], ["Late", "늦은 일정"], ["DCMA", "DCMA 품질"]];
function applyTermMode(root) {
  if (store.get("termMode", "mixed") !== "ko" || !root?.querySelectorAll) return;
  root.querySelectorAll("th, .kpi .l, .tabs a, .legend span, dt, label, .chip, h3").forEach((n) => {
    if (n.dataset.ko) return; n.dataset.ko = "1";
    n.childNodes.forEach((t) => {
      if (t.nodeType !== 3 || !t.textContent.trim()) return;
      let s = t.textContent;
      for (const [en, ko] of TERM_KO) s = s.replace(new RegExp(`(^|[^A-Za-z(])${en.replace(/[-]/g, "\\-")}(?![A-Za-z)])`, "g"), `$1${ko}(${en})`);
      t.textContent = s;
    });
  });
}
const _enhance0 = enhance;
enhance = function (root) { _enhance0(root); applyTermMode(root); };
// ⑫ 시작 화면
async function applyStartPage() {
  if (sessionStorage.getItem("startApplied") || (location.hash && location.hash !== "#/")) return;
  sessionStorage.setItem("startApplied", "1");
  const p = await loadPrefs();
  if (p.start_page === "home") return;
  if (p.start_page === "portfolio") { store.set("inboxCollapsed", "1"); return; }
  if (p.start_page === "reports") { location.hash = "#/reports"; return; }
  const ups = await api("/api/uploads").catch(() => []);
  const mine = new Set(Object.keys(me?.projects || {}));
  const pick = ups.filter((u) => mine.has(u.name)).sort((a, b) => b.data_date.localeCompare(a.data_date))[0] || ups[0];
  if (pick) location.hash = p.start_page === "wizard" ? `#/wizard/${pick.id}` : `#/field/${pick.id}`;
}
const _renderTopbar0 = renderTopbar;
renderTopbar = function () {
  _renderTopbar0();
  const m = $("#userMenu");
  if (m && me?.username && !m.querySelector('[data-act-menu="prefs"]')) {
    const b = Object.assign(document.createElement("button"), { role: "menuitem", innerHTML: `${icon("key")}환경 설정 (알림·시작 화면·용어)` });
    b.setAttribute("role", "menuitem"); b.dataset.actMenu = "prefs";
    b.onclick = () => { m.hidden = true; showPrefs(); };
    m.querySelector('[data-act-menu="me"]')?.after(b);
  }
  m?.querySelectorAll('a[href="#/reports"]').forEach((a) => (a.innerHTML = `${icon("sheet")}보고서 센터`));
  if (me?.username && !renderTopbar._started) { renderTopbar._started = true; loadPrefs().then(applyStartPage); }
};
// '포트폴리오만' 시작: 홈의 알림함 접기
const _renderInbox1 = renderInbox;
renderInbox = async function (container) {
  await _renderInbox1(container);
  if (store.get("inboxCollapsed") === "1" && prefs.start_page === "portfolio") {
    const p = container.querySelector(".panel"); if (!p) return;
    const det = document.createElement("details"); det.className = "panel"; det.innerHTML = `<summary><b>오늘 확인할 것</b> <span class="muted">(펼치기)</span></summary>`;
    det.append(...p.childNodes); p.replaceWith(det);
  }
};

// ---------------------------------------------------------------- 6차 ⑥ 프로젝트별 상태(정상·주의·위험) 기준
async function settingsStatus(el, r, uid) {
  const t = await api(`/api/uploads/${uid}/thresholds`);
  const v = t.values;
  const F = [["margin_bad", "목표 대비 여유가 이 값(일) 미만이면 위험"], ["margin_warn", "목표 대비 여유가 이 값(일) 미만이면 주의"],
    ["slip_warn", "직전 대비 준공 지연이 이 값(일) 이상이면 주의"], ["health_bad", "건전성 점수가 이 값 미만이면 위험"],
    ["health_warn", "건전성 점수가 이 값 미만이면 주의"], ["spi_warn", "SPI가 이 값 미만이면 주의"]];
  const eff = t.effective || {};
  const effTxt = (k) => eff[k] === null || eff[k] === undefined ? "지금: 쓰지 않음" : `지금 적용: ${eff[k]}${v[k] === undefined || v[k] === "" ? " (전사 기본값)" : ""}`;
  el.innerHTML = `<div class="panel"><h3 class="mt0">상태 판정 기준 <span class="muted fs13">${esc(r.name)}</span></h3>
    <p class="muted">상황판 머리 문장과 홈 포트폴리오 카드의 정상·주의·위험 색을 정하는 기준입니다. 비워 두면 그 기준은 쓰지 않습니다. 음수 여유 작업이 있으면 항상 위험입니다.</p>
    <p class="muted fs13">이 기준과 함께 <b>이슈 규칙</b>(마일스톤 계획 대비 +14일, SPI 0.8 미만, 직전 대비 7일 이상 악화, 기한 지난 제약 등)도 상태에 반영되어, 상황판·홈·이슈 보드가 같은 상태를 보여 줍니다.</p>
    <div class="th-grid">${F.map(([k, l]) => `<label>${l}<input class="s" type="number" step="${k === "spi_warn" ? "0.01" : "1"}" data-th="${k}" value="${v[k] ?? ""}" placeholder="비워 두면 전사 기본값" aria-describedby="th-${k}"><span class="muted fs12" id="th-${k}">${effTxt(k)}</span></label>`).join("")}</div>
    <div class="row end"><button class="btn primary" id="thSave" data-need="editor">저장</button></div></div>`;
  applyRole(el);
  $("#thSave").onclick = () => withBusy($("#thSave"), async () => {
    const body = Object.fromEntries([...el.querySelectorAll("[data-th]")].map((x) => [x.dataset.th, x.value]));
    await api(`/api/uploads/${uid}/thresholds`, { method: "PUT", json: body }); toast("기준을 저장했습니다. 상황판과 포트폴리오에 바로 적용됩니다.");
  });
}
