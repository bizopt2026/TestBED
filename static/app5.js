"use strict";
// ================================================================ 7차 디자인: 아이콘 세트, 사이드바, 로그인 화면, 차트 팔레트, 표 밀도, 디자인 가이드

// ---------------------------------------------------------------- 아이콘 (한 가지 선 아이콘 세트, 24 그리드)
Object.assign(ICONS, {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  phone: "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 18h.01",
  chart: "M3 3v18h18M8 17v-6M13 17V7M18 17v-4",
  star: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z",
  message: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  pencil: "M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z",
  thumb: "M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88z",
  grad: "M22 10 12 5 2 10l10 5 10-5zM6 12v5c3 3 9 3 12 0v-5",
  camera: "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  sparkles: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z",
  play: "M6 4l13 8-13 8z",
  rocket: "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09zM12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z",
  ruler: "M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4zM7.5 10.5l2 2M10.5 7.5l2 2M13.5 4.5l2 2",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  dice: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 8h.01M16 16h.01M12 12h.01",
  hardhat: "M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1zM10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5M4 15v-3a6 6 0 0 1 6-6M14 6a6 6 0 0 1 6 6v3",
  flask: "M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3",
  arrow: "M5 12h14M13 6l6 6-6 6",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  refresh: "M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5",
  folder: "M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z",
  filetext: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
  printer: "M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z",
  package: "M16.5 9.4 7.5 4.21M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96 12 12.01l8.73-5.05M12 22.08V12",
  arrowup: "M12 19V5M5 12l7-7 7 7",
  alert: "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01",
  menu: "M3 6h18M3 12h18M3 18h18",
  chevrons: "M11 17l-5-5 5-5M18 17l-5-5 5-5",
  chevron: "M6 9l6 6 6-6",
  gauge: "M12 14l4-4M3.34 19a10 10 0 1 1 17.32 0",
  gantt: "M3 5h8M7 11h10M10 17h11M3 3v18",
  zap: "M13 2 3 14h9l-1 8 10-12h-9z",
  trend: "M3 17c4 0 5-10 9-10s5 10 9 10",
  copy: "M8 8h12v12H8zM16 8V4H4v12h4",
  flag: "M4 22V4M4 4h13l-2 4 2 4H4",
  link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  branch: "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9",
  calendar: "M3 5h18v16H3zM16 3v4M8 3v4M3 11h18",
  layers: "M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  palette: "M12 22a10 10 0 1 1 10-10c0 2.2-1.8 3-4 3h-2a2 2 0 0 0-1.5 3.3A2 2 0 0 1 12 22zM7.5 10.5h.01M12 7.5h.01M16.5 10.5h.01",
  hand: "M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8a8 8 0 0 0 16 0v-3a2 2 0 0 0-4 0",
});

// ---------------------------------------------------------------- 이모지 → 같은 선 아이콘 (화면에 그려진 글자를 자동으로 바꿈)
const EMOJI_ICON = { "👁": "eye", "⚙": "gear", "📱": "phone", "📊": "chart", "💬": "message", "✎": "pencil", "👤": "user", "👍": "thumb", "🔒": "lock",
  "🎓": "grad", "📷": "camera", "🎉": "sparkles", "🚀": "rocket", "📐": "ruler", "🩺": "activity", "🔍": "search", "🎲": "dice", "🦺": "hardhat",
  "🤝": "users", "📖": "book", "🧪": "flask", "👉": "arrow", "📘": "book", "👋": "hand", "🕘": "clock", "🗂": "folder", "📝": "filetext", "🖨": "printer",
  "📄": "file", "👥": "users", "📦": "package", "⬆": "arrowup", "▦": "gantt", "⚠": "alert" };
const EMOJI_RE = new RegExp(`(${Object.keys(EMOJI_ICON).join("|")})\\uFE0F?`, "g");
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "OPTION", "SELECT", "TITLE", "CODE", "INPUT"]);
function iconizeText(root) {
  if (!root || root.nodeType === 3 && SKIP_TAGS.has(root.parentNode?.nodeName)) return;
  const walker = document.createTreeWalker(root.nodeType === 3 ? root.parentNode : root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (SKIP_TAGS.has(n.parentNode?.nodeName) || n.parentNode?.closest?.("svg,.e-ico") || !EMOJI_RE.test(n.nodeValue) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  const hits = []; let n;
  while ((n = walker.nextNode())) hits.push(n);
  for (const t of hits) {
    EMOJI_RE.lastIndex = 0;
    const frag = document.createElement("span");
    frag.innerHTML = esc(t.nodeValue).replace(EMOJI_RE, (_, e) => `<span class="e-ico" aria-hidden="true">${icon(EMOJI_ICON[e], 16)}</span>`);
    t.replaceWith(...frag.childNodes);
  }
}
let _iconQ = new Set(), _iconRaf = 0;
new MutationObserver((ms) => {
  for (const m of ms) m.addedNodes.forEach((x) => (x.nodeType === 1 || x.nodeType === 3) && _iconQ.add(x));
  if (!_iconRaf) _iconRaf = requestAnimationFrame(() => { _iconRaf = 0; const q = [..._iconQ]; _iconQ.clear(); q.forEach((x) => x.isConnected && iconizeText(x)); });
}).observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener("DOMContentLoaded", () => iconizeText(document.body));

// ---------------------------------------------------------------- 왼쪽 사이드바
const TAB_ICON = { overview: "gauge", timeline: "clock", gantt: "gantt", critical: "zap", scurve: "trend", evm: "chart", resources: "users", health: "activity",
  analysis: "search", p6: "copy", korea: "flag", rels: "link", risk: "alert", recovery: "refresh", whatif: "branch", lookahead: "calendar", daily: "filetext",
  report: "file", xlsx: "sheet", trades: "layers", bench: "chart", settings: "gear" };
function sideItem(href, ic, label, on, kbd = "") {
  return `<a class="s-item ${on ? "on" : ""}" href="${href}" ${on ? 'aria-current="page"' : ""} title="${esc(label)}">${icon(ic, 17)}<span class="s-label">${esc(label)}</span>${kbd ? `<span class="kbd">${kbd}</span>` : ""}</a>`;
}
function renderSide() {
  const el = $("#side"); if (!el) return;
  const h = location.hash || "#/";
  const parts = h.replace(/^#\/?/, "").split("/");
  const uid = ["p", "wizard", "field", "reports"].includes(parts[0]) && parts[1] ? parts[1] : (ctx.uid || null);
  const tab = parts[0] === "p" ? String(parts[2] || "overview").split("?")[0] : null;
  const role = me?.role || "admin";
  const name = $("#phead .pname")?.textContent || ctx.result?.name || "";
  let html = `<div class="s-sec">메뉴</div>
    ${sideItem("#/", "home", "홈", h === "#/" || h === "" || h === "#")}
    ${sideItem(uid ? `#/reports/${uid}` : "#/reports", "folder", "보고서 센터", parts[0] === "reports")}
    ${sideItem("#/projects", "users", "프로젝트 권한", parts[0] === "projects")}
    ${sideItem("#/learn", "grad", "학습 센터", parts[0] === "learn")}
    ${role === "admin" ? sideItem("#/admin", "shield", "관리", parts[0] === "admin") : ""}`;
  if (uid && ["p", "wizard", "reports"].includes(parts[0]) && name) {
    html += `<div class="s-proj"><b title="${esc(name)}">${esc(name)}</b><span>${esc($("#upSel option:checked")?.textContent?.split(" · ")[0] || "")}</span></div>
      ${sideItem(`#/wizard/${uid}`, "wand", "월간 점검", parts[0] === "wizard", "g w")}`;
    for (const [g, ts] of GROUPS) {
      const core = ts.filter(([k]) => coreTab(k, tab)), more = ts.filter(([k]) => !coreTab(k, tab));
      html += `<div class="s-group">${esc(g)}</div>` + core.map(([k, l]) => sideItem(k === "xlsx" ? `#/reports/${uid}` : `#/p/${uid}/${k}`, TAB_ICON[k] || "file", l, tab === k, SHORT[k] || "")).join("");
      if (more.length) html += `<details ${more.some(([k]) => k === tab) ? "open" : ""}><summary class="s-more">더보기 ${more.length} <span class="chev">▾</span></summary><div class="s-sub">${more.map(([k, l]) => sideItem(`#/p/${uid}/${k}`, TAB_ICON[k] || "file", l, tab === k)).join("")}</div></details>`;
    }
    html += sideItem(`#/p/${uid}/settings`, "gear", "설정", tab === "settings", "g s");
  }
  html += `<div class="s-foot"><button class="s-item" id="sideMini" aria-pressed="${document.body.classList.contains("side-mini")}" title="메뉴 접기/펼치기">${icon("chevrons", 17)}<span class="s-label">메뉴 접기</span></button></div>`;
  el.innerHTML = html;
  $("#sideMini").onclick = () => { const on = !document.body.classList.contains("side-mini"); document.body.classList.toggle("side-mini", on); store.set("sideMini", on ? "1" : "0"); renderSide(); };
  el.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setSideOpen(false)));
}
function setSideOpen(on) {
  document.body.classList.toggle("side-open", on); $("#btnSide")?.setAttribute("aria-expanded", String(on));
  sideInert();
  if (on) $("#side")?.querySelector("a, button")?.focus();   // 열면 메뉴 안으로 초점
}
function sideInert() {   // 휴대폰에서 닫힌 메뉴는 Tab 순서에서 빠지게
  const side = $("#side"); if (!side) return;
  side.inert = matchMedia("(max-width: 900px)").matches && !document.body.classList.contains("side-open");
}
matchMedia("(max-width: 900px)").addEventListener?.("change", sideInert);
document.addEventListener("DOMContentLoaded", sideInert);
document.addEventListener("DOMContentLoaded", () => {
  if (store.get("sideMini") === "1") document.body.classList.add("side-mini");
  $("#btnSide")?.addEventListener("click", () => setSideOpen(!document.body.classList.contains("side-open")));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setSideOpen(false); });
  document.addEventListener("click", (e) => { if (document.body.classList.contains("side-open") && !e.target.closest("#side,#btnSide")) setSideOpen(false); });
  applyDensity();
  renderSide();
});
window.addEventListener("hashchange", () => setTimeout(renderSide, 0));
const _showProject7 = showProject;
showProject = async function (...a) { const r = await _showProject7(...a); renderSide(); return r; };
const _showWizard7 = showWizard;
showWizard = async function (...a) { const r = await _showWizard7(...a); renderSide(); return r; };

// ---------------------------------------------------------------- 표 밀도 (편안 · 보통 · 촘촘)
function applyDensity() { const d = store.get("density", "normal"); document.body.classList.remove("density-comfy", "density-compact"); if (d !== "normal") document.body.classList.add("density-" + d); }
const _renderTopbar7 = renderTopbar;
renderTopbar = function () {
  _renderTopbar7();
  const m = $("#userMenu");
  if (m && !m.querySelector("[data-density]")) {
    const d = store.get("density", "normal");
    m.querySelector('[data-act-menu="theme"]')?.insertAdjacentHTML("afterend", `<div class="menu-density" role="group" aria-label="표 줄 간격"><span class="muted">표 간격</span>
      <div class="density-seg">${[["comfy", "편안"], ["normal", "보통"], ["compact", "촘촘"]].map(([k, l]) => `<button type="button" data-density="${k}" class="${d === k ? "on" : ""}" aria-pressed="${d === k}">${l}</button>`).join("")}</div></div>
      <a role="menuitem" href="#/design">${icon("palette")}디자인 가이드</a>`);
    m.querySelectorAll("[data-density]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); store.set("density", b.dataset.density); applyDensity();
      m.querySelectorAll("[data-density]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); }); }));
  }
  renderSide();
};

// ---------------------------------------------------------------- 차트 공통 팔레트
const CHART_REMAP = { "#2563eb": "--c1", "#3b82f6": "--c1", "#d97706": "--c2", "#f59e0b": "--c2", "#16a34a": "--c3", "#7c3aed": "--c6", "#dc2626": "--c4", "#0891b2": "--c5", "#db2777": "--c8", "#9ca3af": "--c7" };
const _chartSvg7 = chartSvg;
chartSvg = function (host, opt) {
  const map = (c) => (CHART_REMAP[String(c).toLowerCase()] ? cssv(CHART_REMAP[String(c).toLowerCase()]) : c);
  return _chartSvg7(host, { ...opt, series: (opt.series || []).map((s) => ({ ...s, color: map(s.color) })), refLines: (opt.refLines || []).map((r) => ({ ...r, color: r.color ? map(r.color) : cssv("--c3") })) });
};

// ---------------------------------------------------------------- 로그인 화면 (전체 화면, 브랜드)
showLogin = function () {
  if (loginWait) return loginWait;
  document.body.classList.add("login-screen");
  const w = document.createElement("div"); w.className = "login-wrap"; w.id = "loginWrap"; w.setAttribute("role", "main");
  w.innerHTML = `<div class="login-art"><div><div class="brand" style="display:flex;align-items:center;gap:10px;font-weight:750;font-size:17px">
      <span class="logo" style="width:34px;height:34px;border-radius:10px;background:rgba(255,255,255,.16);display:grid;place-items:center">${icon("gantt", 18)}</span><span class="pms-name">${esc(window.PMS?.edition_name || "PMS")}</span></div></div>
    <div><h1>공정표를 올리면<br>상황이 한눈에 보입니다</h1><p>P6·MS Project 공정표의 CPM 재계산, 품질 점검, 지연 원인, 리스크와 만회안, 월간 보고까지 팀이 함께 씁니다.</p>
      <div class="feat"><div>${icon("gauge")} 상황판과 '왜?' 해석</div><div>${icon("wand")} 월간 점검 팀 기록</div><div>${icon("folder")} 보고서 센터·확정본</div></div></div>
    <div style="font-size:12px;opacity:.7">사내 전용 · 데이터는 이 서버에만 저장됩니다</div>
    <svg class="deco" width="420" height="300" viewBox="0 0 420 300" aria-hidden="true"><g fill="#fff">${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${30 + i * 40}" y="${30 + i * 42}" width="${140 + (i % 3) * 40}" height="18" rx="9"/>`).join("")}</g></svg></div>
    <div class="login-form"><form id="fLogin" autocomplete="on"><h2>로그인</h2><p class="muted">팀 계정으로 로그인하세요.</p>
      <label>아이디<input name="username" autocomplete="username" required></label>
      <label>비밀번호<input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn primary" value="ok">로그인</button><p class="err" id="lgErr" role="alert"></p>
      <p class="muted" style="font-size:12px;margin-top:18px">계정이 없거나 비밀번호를 잊었으면 관리자에게 문의하세요.</p></form></div>`;
  document.body.appendChild(w);
  setTimeout(() => w.querySelector("[name=username]").focus(), 30);
  loginWait = new Promise((resolve) => {
    $("#fLogin").onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" }, body: JSON.stringify(f) });
      if (!r.ok) { $("#lgErr").textContent = (await r.json().catch(() => ({}))).detail || "로그인 실패"; return; }
      w.remove(); document.body.classList.remove("login-screen"); loginWait = null; refreshMe(); resolve();
    };
  });
  return loginWait;
};

// ---------------------------------------------------------------- 디자인 가이드 (#/design) — 부품 견본
async function showDesign() {
  $("#crumb").textContent = "/ 디자인 가이드";
  ctx.uid = null;
  const sw = (v, l) => `<div><i style="background:var(${v})"></i><span>${l}<br><code>${v}</code></span></div>`;
  view.innerHTML = `<div class="page-head"><div><h2>디자인 가이드</h2><p>화면을 만들 때 쓰는 색·글자·부품 견본입니다. 새 화면도 이 모양을 따릅니다.</p></div></div>
    <div class="panel"><h3>색</h3><div class="dg-swatches">${sw("--accent", "대표색")}${sw("--text", "본문")}${sw("--muted", "보조 글자")}${sw("--line", "경계선")}${sw("--bg", "바탕")}
      ${sw("--ok", "정상")}${sw("--warn", "주의")}${sw("--crit", "위험")}</div>
      <h4>차트 8색</h4><div class="dg-swatches">${[1, 2, 3, 4, 5, 6, 7, 8].map((i) => sw("--c" + i, "계열 " + i)).join("")}</div></div>
    <div class="panel"><h3>글자</h3><h2 style="margin:6px 0">제목 24 · 굵게</h2><h3 style="margin:6px 0">소제목 16</h3><p>본문 14 — 공정표의 최장경로와 여유일을 확인합니다.</p><p class="muted">보조 13 — 마지막 업데이트 11-27</p>
      <div class="kpi" style="max-width:220px"><div class="l">숫자는 폭이 같은 숫자</div><div class="v">1,234<small>일</small></div></div></div>
    <div class="panel"><h3>버튼</h3><div class="dg-row"><button class="btn primary">주요 행동</button><button class="btn">보조</button><button class="btn ghost">글자형</button><button class="btn danger">위험</button>
      <button class="btn danger-fill">삭제 확정</button><button class="btn" disabled>사용 불가</button></div>
      <div class="dg-row"><button class="btn primary sm">작게</button><button class="btn sm">${icon("upload", 14)} 아이콘과 함께</button><button class="btn icon" aria-label="설정">${icon("gear")}</button></div></div>
    <div class="panel"><h3>상태 배지</h3><div class="dg-row"><span class="status-badge ok">정상</span><span class="status-badge warn">주의</span><span class="status-badge bad">위험</span>
      <span class="chip ok">✓ 여유 35일</span><span class="chip warn">! 최신 아님</span><span class="chip bad">✕ 지연 12일</span><span class="chip">보통</span><span class="tag">태그</span></div>
      <p class="muted fs13">카드 하나에는 상태 배지를 하나만 쓰고, 나머지는 보조 글자로 적습니다.</p></div>
    <div class="panel"><h3>입력</h3><div class="dg-row"><input class="s" placeholder="검색어" aria-label="검색어 예시"><select class="s" aria-label="선택 예시"><option>선택</option></select><input class="s" type="date" aria-label="날짜 예시"><label><input type="checkbox" checked> 체크</label></div></div>
    <div class="panel"><h3>지표 카드</h3><div class="kpis kpis6"><div class="kpi tone-good"><div class="l">공정률</div><div class="v">42.5<small>%</small></div><span class="delta good">▲ 3.2%</span></div>
      <div class="kpi tone-bad"><div class="l">예상 준공</div><div class="v">2026-09-12</div><span class="delta bad">▼ 12일</span></div><div class="kpi"><div class="l">건전성</div><div class="v">85<small>점</small></div><span class="delta same">변화 없음</span></div></div></div>
    <div class="panel"><h3>표</h3><table class="t"><thead><tr><th>ID</th><th>작업</th><th class="num">TF</th><th>상태</th></tr></thead><tbody>
      <tr><td>A2000</td><td>철골 제작</td><td class="num">0</td><td><span class="chip bad">주공정</span></td></tr><tr><td>A3000</td><td>지붕 패널</td><td class="num">57</td><td><span class="chip">진행</span></td></tr></tbody></table>
      <p class="muted fs13">오른쪽 위 내 메뉴에서 표 간격(편안·보통·촘촘)을 고를 수 있습니다.</p></div>
    <div class="panel"><h3>빈 화면 · 알림</h3>${emptyState("표시할 항목이 없습니다", "조건을 바꾸거나 새로 추가하세요.")}
      <div class="inbox"><div class="inbox-item high"><span class="sev">✕</span><a href="#/design">기한 지난 제약</a><span></span></div><div class="inbox-item mid"><span class="sev">!</span><a href="#/design">대응 방안 없는 리스크</a><span></span></div></div></div>`;
}
