"use strict";
// ================================================================ 4차 UI: 아이콘, 상단 메뉴·알림, 명령 팔레트, 표 도구, SVG 차트, 되돌리기, 포커스 관리

// ---------------------------------------------------------------- ① SVG 아이콘 (글꼴에 따라 깨지는 이모지·특수문자 대체)
const ICONS = {
  eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0",
  bell: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2-4.3-4.3",
  upload: "M12 16V4m0 0-4 4m4-4 4 4M4 20h16",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  key: "M7 15a4 4 0 1 1 3.9-5H22v4h-3v3h-3v-3h-5.1A4 4 0 0 1 7 15z",
  book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm14 10v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  sheet: "M4 3h16v18H4zM4 9h16M4 15h16M10 3v18",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  check: "M20 6 9 17l-5-5",
  wand: "M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M15 9h.01M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5",
  close: "M18 6 6 18M6 6l12 12",
};
function icon(name, size = 16) {
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] || ""}"/></svg>`;
}

// ---------------------------------------------------------------- ① 상단 바: 검색 · 알림 · 업로드 · 사용자 메뉴
function renderTopbar() {
  const box = $("#userBox"); if (!box) return;
  const role = me?.role || "admin";
  const roleKo = { viewer: "조회", editor: "편집", admin: "관리자" }[role];
  const initials = (me?.username || "공").slice(0, 1).toUpperCase();
  box.innerHTML = `
    <button class="tb-btn" id="tbSearch" aria-label="검색 (Ctrl+K)" title="검색 (Ctrl+K)">${icon("search")}<span class="hide-sm">검색</span><kbd class="hide-sm">Ctrl K</kbd></button>
    ${me?.username ? `<button class="tb-btn" id="tbBell" aria-label="알림" title="알림">${icon("bell")}<span class="badge" id="bellCount" hidden></span></button>` : ""}
    <div class="menu-wrap"><button class="tb-btn avatar" id="tbUser" aria-haspopup="menu" aria-expanded="false" title="${esc(me?.username || "사용자 메뉴")}"><span class="av">${esc(initials)}</span><span class="hide-sm">${esc(me?.username || "메뉴")}</span></button>
      <div class="menu" id="userMenu" role="menu" hidden>
        ${me?.username ? `<div class="menu-head"><b>${esc(me.username)}</b><span class="tag">${roleKo}</span></div>
          <button role="menuitem" data-act-menu="me">${icon("user")}내 정보·비밀번호</button>` : `<div class="menu-head muted">공개 모드</div>`}
        <a role="menuitem" href="#/projects">${icon("users")}프로젝트 권한</a>
        <a role="menuitem" href="#/reports">${icon("sheet")}엑셀 리포트</a>
        <a role="menuitem" href="#/learn">${icon("book")}학습 센터</a>
        <hr><button role="menuitem" data-act-menu="theme">${icon("sun")}화면 테마 바꾸기</button>
        <button role="menuitem" data-act-menu="keys">${icon("key")}단축키</button>
        ${role === "admin" ? `<a role="menuitem" href="#/admin">${icon("shield")}관리</a>` : ""}
        ${me?.username ? `<hr><button role="menuitem" data-act-menu="logout">${icon("logout")}로그아웃</button>` : ""}
      </div></div>`;
  const btnUp = $("#btnUpload");
  if (btnUp && !btnUp.dataset.iconized) { btnUp.innerHTML = `${icon("upload")}<span class="hide-sm">업로드</span>`; btnUp.dataset.iconized = "1"; btnUp.title = "공정표 파일 업로드"; }
  const menu = $("#userMenu"), tb = $("#tbUser");
  const close = () => { menu.hidden = true; tb.setAttribute("aria-expanded", "false"); };
  tb.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; tb.setAttribute("aria-expanded", String(!menu.hidden)); if (!menu.hidden) menu.querySelector("[role=menuitem]")?.focus(); };
  document.addEventListener("click", (e) => { if (!e.target.closest(".menu-wrap")) close(); });
  menu.addEventListener("keydown", (e) => {
    const items = [...menu.querySelectorAll("[role=menuitem]")]; const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    if (e.key === "Escape") { close(); tb.focus(); }
  });
  menu.querySelectorAll("a").forEach((a) => a.addEventListener("click", close));
  menu.querySelectorAll("[data-act-menu]").forEach((b) => (b.onclick = async () => {
    close();
    const a = b.dataset.actMenu;
    if (a === "me") showMyInfo();
    if (a === "theme") toggleTheme();
    if (a === "keys") showShortcuts();
    if (a === "logout") { await fetch("/api/logout", { method: "POST", headers: { "X-Requested-With": "fetch" } }); location.reload(); }
  }));
  $("#tbSearch").onclick = openPalette;
  $("#tbBell")?.addEventListener("click", openNotifications);
  pollNotifications();
}

// ---------------------------------------------------------------- ⑩ 알림 센터
let notifTimer = null;
async function pollNotifications() {
  if (!me?.username) return;
  try {
    const n = await api("/api/notifications");
    const b = $("#bellCount"); if (b) { b.hidden = !n.unread; b.textContent = n.unread > 9 ? "9+" : n.unread; }
    $("#tbBell")?.setAttribute("aria-label", `알림 ${n.unread}건`);
  } catch {}
  clearTimeout(notifTimer); notifTimer = setTimeout(pollNotifications, 60000);
}
async function openNotifications() {
  const n = await api("/api/notifications");
  const kindIcon = { access_request: "users", access_approved: "check", access_rejected: "close", member: "users", new_update: "upload" };
  const d = openDrawer("알림", `<div class="row" style="justify-content:flex-end"><button class="btn sm" id="nAll">모두 읽음</button></div>
    ${n.items.map((x) => `<a class="notif ${x.read ? "" : "unread"}" href="${esc(x.link || "#/")}" data-nid="${x.id}">${icon(kindIcon[x.kind] || "bell")}<span>${esc(x.text)}<small class="muted">${x.created_at.replace("T", " ").slice(5, 16)}</small></span></a>`).join("")
      || '<p class="muted">알림이 없습니다.</p>'}`, { id: "notifDrawer" });
  d.querySelectorAll("[data-nid]").forEach((a) => a.addEventListener("click", () => { api("/api/notifications/read", { method: "POST", json: { ids: [a.dataset.nid] } }).then(pollNotifications); closeDrawer("notifDrawer"); }));
  d.querySelector("#nAll").onclick = async () => { await api("/api/notifications/read", { method: "POST", json: {} }); pollNotifications(); openNotifications(); };
}

// ---------------------------------------------------------------- ② 명령 팔레트 (Ctrl+K)
async function openPalette() {
  if ($("#palette")) return;
  const d = document.createElement("dialog"); d.id = "palette"; d.className = "palette";
  d.innerHTML = `<input type="search" id="palQ" placeholder="프로젝트, Activity ID, 화면, 리스크 검색…" aria-label="검색" autocomplete="off"><ul id="palList" role="listbox"></ul>
    <div class="muted pal-foot">↑↓ 이동 · Enter 열기 · Esc 닫기</div>`;
  document.body.appendChild(d); d.showModal();
  d.addEventListener("close", () => d.remove());
  d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
  const items = [];
  const projects = await api("/api/projects").catch(() => []);
  projects.forEach((p) => items.push({ kind: "프로젝트", label: p.name, sub: `DD ${p.data_date}${p.can_write ? " · 편집 가능" : ""}`, go: `#/p/${p.latest_id}/overview` }));
  [["#/", "홈"], ["#/reports", "보고서 센터"], ["#/projects", "프로젝트 권한"], ["#/learn", "학습 센터"]].forEach(([h, l]) => items.push({ kind: "페이지", label: l, go: h }));
  if (ctx.uid && ctx.result) {
    items.push({ kind: "화면", label: "월간 업데이트 점검", sub: ctx.result.name, go: `#/wizard/${ctx.uid}` });
    Object.entries(TAB_LABEL).forEach(([k, l]) => items.push({ kind: "화면", label: l, sub: ctx.result.name, go: `#/p/${ctx.uid}/${k}` }));
    ctx.result.activities.forEach((a) => items.push({ kind: "작업", label: `${a.code} ${a.name}`, sub: `${a.status} · ${a.start}~${a.finish}${a.longest ? " · 최장경로" : ""}`, act: a.code }));
    (await api(`/api/uploads/${ctx.uid}/risks`).catch(() => [])).forEach((x) => items.push({ kind: "리스크", label: x.title, sub: `${x.prob}% · ${x.impact_ml}일`, go: `#/p/${ctx.uid}/risk` }));
  }
  let sel = 0, shown = [];
  const draw = () => {
    const q = $("#palQ").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    shown = items.filter((x) => q.every((w) => (x.label + " " + (x.sub || "") + " " + x.kind).toLowerCase().includes(w))).slice(0, 40);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    $("#palList").innerHTML = shown.map((x, i) => `<li role="option" aria-selected="${i === sel}" class="${i === sel ? "on" : ""}" data-i="${i}"><span class="k">${x.kind}</span><b>${esc(x.label)}</b><span class="muted">${esc(x.sub || "")}</span></li>`).join("")
      || '<li class="muted">결과가 없습니다</li>';
    $("#palList").querySelector(".on")?.scrollIntoView({ block: "nearest" });
  };
  const open = (x) => { d.close(); if (!x) return; if (x.act) openActivity(x.act); else location.hash = x.go; };
  $("#palQ").oninput = () => { sel = 0; draw(); };
  $("#palQ").onkeydown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); draw(); }
    if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); draw(); }
    if (e.key === "Enter") { e.preventDefault(); open(shown[sel]); }
    if (e.key === "Escape") { e.preventDefault(); d.close(); }   // 검색칸의 Esc 는 글자만 지우므로 직접 닫음
  };
  $("#palList").onclick = (e) => { const li = e.target.closest("[data-i]"); if (li) open(shown[+li.dataset.i]); };
  draw(); $("#palQ").focus();
}
document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); } });

// ---------------------------------------------------------------- ⑫ 되돌리기 토스트
function undoToast(message, trashId, after) {
  let t = $("#undoToast");
  if (!t) { t = document.createElement("div"); t.id = "undoToast"; t.className = "undo"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.innerHTML = `<span>${esc(message)}</span><button class="btn sm" id="undoBtn">되돌리기</button><span class="muted" id="undoSec">10</span>`;
  t.hidden = false;
  let s = 10; clearInterval(t._iv);
  t._iv = setInterval(() => { s--; const el = $("#undoSec"); if (el) el.textContent = s; if (s <= 0) { clearInterval(t._iv); t.hidden = true; } }, 1000);
  $("#undoBtn").onclick = async () => {
    clearInterval(t._iv); t.hidden = true;
    try { await api(`/api/trash/${trashId}/restore`, { method: "POST" }); toast("되돌렸습니다"); uploadsCache = null; after?.(); } catch (e) { toast(e.message); }
  };
}
async function deleteWithUndo(path, label, after) {
  const r = await api(path, { method: "DELETE" });
  after?.();
  if (r?.trash_id) undoToast(`${label}을(를) 삭제했습니다`, r.trash_id, after);
}

// ---------------------------------------------------------------- ④ 표 도구: 정렬 · 빠른 필터 · 첫 열 고정 · ⋯ 메뉴 · 단계 렌더링 · 모바일 카드
const CELL_NUM = /^[+-]?\d[\d,]*(\.\d+)?%?$/;
function cellKey(td) {
  const t = (td?.innerText || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t;
  if (CELL_NUM.test(t)) return parseFloat(t.replace(/[,%+]/g, ""));
  return t.toLowerCase();
}
function enhanceTables(root) {
  root.querySelectorAll("table.t:not([data-tt])").forEach((t) => {
    t.dataset.tt = "1";
    const head = t.tHead?.rows[0]; const body = t.tBodies[0];
    if (!head || !body) return;
    const labels = [...head.cells].map((c) => c.innerText.replace(/\s*\?\s*$/, "").trim());
    [...body.rows].forEach((r) => [...r.cells].forEach((c, i) => { if (labels[i]) c.dataset.label = labels[i]; }));
    t.classList.add("cardable");
    if (t.dataset.noexport !== undefined && body.rows.length < 8) return;
    // 정렬
    [...head.cells].forEach((th, i) => {
      if (!th.innerText.trim()) return;
      th.classList.add("sortable"); th.tabIndex = 0; th.setAttribute("aria-sort", "none");
      const sort = () => {
        const dir = th.getAttribute("aria-sort") === "ascending" ? -1 : 1;
        [...head.cells].forEach((x) => x.setAttribute("aria-sort", "none"));
        th.setAttribute("aria-sort", dir === 1 ? "ascending" : "descending");
        const rows = [...body.rows].filter((r) => !r.classList.contains("dx") && !r.id?.startsWith("mi-"));
        rows.sort((a, b) => { const x = cellKey(a.cells[i]), y = cellKey(b.cells[i]); return (x > y ? 1 : x < y ? -1 : 0) * dir; });
        rows.forEach((r) => body.appendChild(r));
      };
      th.addEventListener("click", (e) => { if (!e.target.closest(".term")) sort(); });
      th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sort(); } });
    });
    if (body.rows.length < 3) return;
    const big = body.rows.length >= 8;
    // 첫 열 고정 + 도구 막대(빠른 필터, ⋯ 메뉴)
    if (big) t.classList.add("sticky-first");
    const bar = document.createElement("div"); bar.className = "tbl-tools";
    bar.innerHTML = `${big ? `<input type="search" class="s sm" placeholder="표에서 찾기" aria-label="표에서 찾기">` : ""}<span class="muted cnt">${body.rows.length}행</span>
      <div class="menu-wrap"><button class="btn sm icon-btn" aria-haspopup="menu" aria-label="표 메뉴">${icon("more")}</button>
        <div class="menu" role="menu" hidden><button role="menuitem" data-x="csv">엑셀(CSV)로 내보내기</button><button role="menuitem" data-x="copy">표 복사(붙여넣기용)</button></div></div>`;
    const anchor = t.closest(".scroll") || t;
    anchor.parentNode.insertBefore(bar, anchor);
    anchor.parentNode.querySelectorAll(":scope > .export-bar").forEach((x) => x.remove());
    const q = bar.querySelector("input"), cnt = bar.querySelector(".cnt");
    if (q) q.oninput = () => {
      const w = q.value.trim().toLowerCase(); let n = 0;
      [...body.rows].forEach((r) => { const ok = !w || r.innerText.toLowerCase().includes(w); r.hidden = !ok; n += ok; });
      cnt.textContent = w ? `${n}/${body.rows.length}행` : `${body.rows.length}행`;
    };
    const mb = bar.querySelector(".icon-btn"), menu = bar.querySelector(".menu");
    mb.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
    document.addEventListener("click", () => (menu.hidden = true));
    menu.querySelector("[data-x=csv]").onclick = () => {
      const h = t.closest(".panel")?.querySelector("h3")?.childNodes[0]?.textContent?.trim() || "표";
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([tableToCsv(t)], { type: "text/csv" }));
      a.download = `${ctx.result?.name || "export"}_${h}_${ctx.result?.data_date || ""}.csv`; document.body.appendChild(a); a.click(); a.remove();
    };
    menu.querySelector("[data-x=copy]").onclick = () => copyText(tableToCsv(t).replace(/^﻿/, "").replace(/,/g, "\t"));
    // ⑰ 단계 렌더링: 행이 많으면 처음 200행만 보이고 '더 보기'
    const rows = [...body.rows];
    if (rows.length > 400) {
      rows.slice(200).forEach((r) => (r.dataset.later = "1", r.hidden = true));
      const more = document.createElement("button"); more.className = "btn sm more"; more.textContent = `나머지 ${rows.length - 200}행 더 보기`;
      more.onclick = () => { rows.forEach((r) => { if (r.dataset.later) { r.hidden = false; delete r.dataset.later; } }); more.remove(); };
      anchor.after(more);
    }
  });
}

// ---------------------------------------------------------------- ⑭ SVG 차트 공통 모듈 (툴팁·범례·패턴·표 보기·인쇄 대응)
const DASHES = ["", "6 4", "2 3", "8 3 2 3", "1 4"];
function chartSvg(host, { type = "line", labels = [], series = [], yFmt = (v) => v, height = 260, min, max, title = "", xTitle = "", yTitle = "", stacked = false, refLines = [] }) {
  if (!host) return;
  const id = "c" + Math.random().toString(36).slice(2, 8);
  const W = Math.max(320, host.clientWidth || host.parentElement?.clientWidth || 640), H = height, P = { l: 58, r: 14, t: 14, b: 34 };
  const vals = stacked ? labels.map((_, i) => series.reduce((a, s) => a + (+s.values[i] || 0), 0)) : series.flatMap((s) => s.values).filter((v) => v !== null && v !== undefined && !isNaN(v));
  let lo = min ?? Math.min(0, ...vals), hi = max ?? Math.max(...vals, 1);
  if (hi === lo) hi = lo + 1;
  const n = labels.length || 1;
  const bw = (W - P.l - P.r) / n;
  const X = (i) => type === "line" ? P.l + (n === 1 ? (W - P.l - P.r) / 2 : (i / (n - 1)) * (W - P.l - P.r)) : P.l + i * bw + bw / 2;
  const Y = (v) => H - P.b - ((v - lo) / (hi - lo)) * (H - P.t - P.b);
  const grid = [0, 1, 2, 3, 4].map((k) => lo + (k * (hi - lo)) / 4);
  const step = Math.ceil(n / Math.max(2, Math.floor((W - P.l) / 70)));
  let marks = "";
  if (type === "line") {
    series.forEach((s, si) => {
      let d = "", pen = false;
      s.values.forEach((v, i) => { if (v === null || v === undefined || isNaN(v)) { pen = false; return; } d += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; });
      marks += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-dasharray="${s.dash || DASHES[si % DASHES.length]}"/>`;
      if (s.dots || n <= 24) s.values.forEach((v, i) => { if (v !== null && v !== undefined && !isNaN(v)) marks += `<circle cx="${X(i)}" cy="${Y(v)}" r="3" fill="${s.color}"/>`; });
    });
  } else {
    labels.forEach((_, i) => {
      let base = 0;
      series.forEach((s, si) => {
        const v = +s.values[i] || 0;
        const w = stacked ? bw * 0.7 : (bw * 0.75) / series.length;
        const x = stacked ? X(i) - w / 2 : X(i) - (bw * 0.75) / 2 + si * w;
        const y0 = stacked ? base : 0, y1 = y0 + v;
        marks += `<rect x="${x.toFixed(1)}" y="${Y(y1).toFixed(1)}" width="${Math.max(1, w - 1).toFixed(1)}" height="${Math.max(0, Y(y0) - Y(y1)).toFixed(1)}" fill="${s.color}" ${si % 2 ? `fill-opacity=".85"` : ""}/>`;
        if (stacked) base = y1;
      });
    });
  }
  const refs = refLines.map((r) => r.x !== undefined
    ? `<line x1="${X(r.x)}" x2="${X(r.x)}" y1="${P.t}" y2="${H - P.b}" stroke="${r.color || "#16a34a"}" stroke-dasharray="4 3"/><text x="${X(r.x) + 4}" y="${P.t + 10}" class="ref">${esc(r.label || "")}</text>`
    : `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(r.y)}" y2="${Y(r.y)}" stroke="${r.color || "#9ca3af"}" stroke-dasharray="4 3"/><text x="${W - P.r - 4}" y="${Y(r.y) - 4}" text-anchor="end" class="ref">${esc(r.label || "")}</text>`).join("");
  host.innerHTML = `<figure class="chart" aria-labelledby="${id}t">
    <figcaption id="${id}t" class="${title ? "" : "sr"}">${esc(title || series.map((s) => s.name).join(", "))}</figcaption>
    <div class="legend">${series.map((s, si) => `<span><svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" stroke="${s.color}" stroke-width="${type === "line" ? 2.5 : 8}" stroke-dasharray="${type === "line" ? s.dash || DASHES[si % DASHES.length] : ""}"/></svg>${esc(s.name || "")}</span>`).join("")}
      <button class="btn sm tbl-toggle" type="button" aria-pressed="false">표로 보기</button></div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(title || "차트")}">
      ${grid.map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${P.l - 6}" y="${Y(v) + 4}" text-anchor="end" class="ax">${esc(String(yFmt(Math.round(v * 100) / 100)))}</text>`).join("")}
      ${labels.map((l, i) => (i % step === 0 ? `<text x="${X(i)}" y="${H - 12}" text-anchor="middle" class="ax">${esc(String(l))}</text>` : "")).join("")}
      ${yTitle ? `<text x="12" y="${P.t + 4}" class="ax">${esc(yTitle)}</text>` : ""}${xTitle ? `<text x="${W - P.r}" y="${H - 1}" text-anchor="end" class="ax">${esc(xTitle)}</text>` : ""}
      ${marks}${refs}<line class="hover" x1="0" x2="0" y1="${P.t}" y2="${H - P.b}" visibility="hidden"/><rect class="hit" x="${P.l}" y="${P.t}" width="${W - P.l - P.r}" height="${H - P.t - P.b}" fill="transparent"/></svg>
    <div class="chart-table" hidden><table class="t" data-noexport><thead><tr><th>구분</th>${series.map((s) => `<th>${esc(s.name || "")}</th>`).join("")}</tr></thead>
      <tbody>${labels.map((l, i) => `<tr><td>${esc(String(l))}</td>${series.map((s) => `<td class="num">${s.values[i] ?? ""}</td>`).join("")}</tr>`).join("")}</tbody></table></div></figure>`;
  const svg = host.querySelector("svg[role=img]"), hit = svg.querySelector(".hit"), hl = svg.querySelector(".hover");
  let tip = document.querySelector(".tip.chart"); if (!tip) { tip = document.createElement("div"); tip.className = "tip chart"; tip.hidden = true; document.body.appendChild(tip); }
  hit.addEventListener("mousemove", (e) => {
    const r = svg.getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width) * W;
    let i = type === "line" ? Math.round(((x - P.l) / (W - P.l - P.r)) * (n - 1)) : Math.floor((x - P.l) / bw);
    i = Math.max(0, Math.min(n - 1, i));
    hl.setAttribute("x1", X(i)); hl.setAttribute("x2", X(i)); hl.setAttribute("visibility", "visible");
    tip.innerHTML = `<b>${esc(String(labels[i]))}</b>` + series.map((s) => s.values[i] === null || s.values[i] === undefined ? "" : `<br><i style="background:${s.color}"></i>${esc(s.name || "")} ${esc(String(yFmt(s.values[i])))}`).join("");
    tip.style.left = e.pageX + 12 + "px"; tip.style.top = e.pageY + 12 + "px"; tip.hidden = false;
  });
  hit.addEventListener("mouseleave", () => { tip.hidden = true; hl.setAttribute("visibility", "hidden"); });
  const tg = host.querySelector(".tbl-toggle");
  tg.onclick = () => { const tb = host.querySelector(".chart-table"); tb.hidden = !tb.hidden; tg.setAttribute("aria-pressed", String(!tb.hidden)); tg.textContent = tb.hidden ? "표로 보기" : "차트만 보기"; };
}
// 기존 캔버스 차트 호출을 SVG 모듈로 연결
function _hostFor(cv) {
  if (!cv) return null;
  if (cv.tagName !== "CANVAS") return cv;
  const d = document.createElement("div"); d.id = cv.id; d.className = "chart-host"; cv.replaceWith(d); return d;
}
lineChart = function (cv, labels, series, opts = {}) {
  chartSvg(_hostFor(cv), { type: "line", labels, series: series.map((s) => ({ ...s, dash: s.dash ? s.dash.join(" ") : undefined })), yFmt: opts.fmt || ((v) => v), min: opts.min, max: opts.max, height: parseInt(cv?.style?.height) || 240 });
};
drawHist = function (cv, hist) {
  chartSvg(_hostFor(cv), { type: "bar", labels: hist.map((h) => h[0].slice(5)), series: [{ name: "빈도(회)", color: "#3b82f6", values: hist.map((h) => h[1]) }], height: 200, xTitle: "주(週) 시작일" });
};

// ---------------------------------------------------------------- ⑯ 포커스 관리: 서랍을 닫으면 연 버튼으로 돌아가기, 서랍 안 Tab 순환
let lastFocus = null;
document.addEventListener("focusin", (e) => { if (!e.target.closest(".drawer, dialog")) lastFocus = e.target; });
const _closeDrawer = closeDrawer;
closeDrawer = function (id = "drawer") { const was = $("#" + id)?.classList.contains("open"); _closeDrawer(id); if (was && lastFocus?.isConnected) lastFocus.focus(); };
document.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const d = document.querySelector(".drawer.open"); if (!d || !d.contains(document.activeElement)) return;
  const f = [...d.querySelectorAll("a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex='0']")].filter((x) => x.offsetParent);
  if (!f.length) return;
  if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
  else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
});
// 토스트를 화면 낭독기에 알림
document.addEventListener("DOMContentLoaded", () => { const t = $("#toast"); if (t) { t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite"); } });

window.addEventListener("hashchange", () => {
  $("#palette")?.close();
  document.querySelectorAll(".menu").forEach((m) => (m.hidden = true));
  document.querySelectorAll(".drawer.open:not(#aiDrawer)").forEach((d) => d.classList.remove("open"));  // 화면을 옮기면 알림·상세 서랍 닫기 (AI 패널은 유지)
});
