"use strict";
// ================================================================ 2.7 UI 정리
// 머리글 가져오기 하나로 · 첫 안내 겹침 없애기 · 오래된 DD 경고 · 대시보드 표 보기 · 빈 화면 안내 · 관리 화면 정리

// ---------------------------------------------------------------- 머리글: '공정표 올리기' + ▾ (다른 방법)
function headerAddMenu() {
  const up = $("#btnUpload"); if (!up || $("#btnAddMore")) return;
  up.innerHTML = `${icon("upload")}<span class="hide-sm">${isDashboard() ? "공정표 가져오기" : "공정표 올리기"}</span>`;
  up.dataset.iconized = "1"; up.title = isDashboard() ? "공정표 파일 가져오기 (관리자)" : "공정표 파일 올리기 (XER · MS Project)";
  if (isDashboard()) return;   // 대시보드는 게시로 받음 — 관리자 임시 가져오기만
  const wrap = document.createElement("span"); wrap.className = "split-btn menu-wrap";
  up.replaceWith(wrap); wrap.append(up);
  wrap.insertAdjacentHTML("beforeend", `<button class="btn primary split-more" id="btnAddMore" data-need="editor" aria-haspopup="menu" aria-expanded="false" aria-label="다른 방법으로 프로젝트 추가">▾</button>
    <div class="menu" id="addMenu" role="menu" hidden>
      <button role="menuitem" data-a="up">${icon("upload")}<span>공정표 올리기<small>XER · MS Project · P6 XML</small></span></button>
      <button role="menuitem" data-a="pms">${icon("package")}<span>PMS 파일·텍스트 가져오기<small>다른 현장에서 받은 .pms</small></span></button>
      <button role="menuitem" data-a="cat">${icon("search")}<span>대시보드에서 찾기<small>구독하면 새 판을 자동으로 받음</small></span></button>
      <button role="menuitem" data-a="gen">${icon("sparkles")}<span>새 공정표 만들기<small>공종·기간으로 초안 생성</small></span></button>
    </div>`);
  const menu = $("#addMenu");
  popMenu($("#btnAddMore"), menu);
  menu.onclick = async (e) => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    menu.hidden = true;
    if (b.dataset.a === "up") up.click();
    if (b.dataset.a === "pms") importDialog();
    if (b.dataset.a === "gen") showGenerate();
    if (b.dataset.a === "cat") {
      const st = await getHubStatus().catch(() => ({}));
      if (st.connected) catalogDialog(); else { toast("먼저 PMS 대시보드에 연결하세요 (내 설정)"); location.hash = "#/me"; }
    }
  };
  applyRole?.(wrap);
}
document.addEventListener("DOMContentLoaded", () => pmsReady.then(headerAddMenu));

// 홈 머리의 같은 버튼(업데이트 올리기·가져오기·새 공정표)은 머리글 하나로 모음
const _showList27 = showList;
showList = async function () {
  await _showList27();
  const head = view.querySelector(".page-head .row");
  if (head && view.querySelector("#pfCards")) {
    head.querySelectorAll('button[onclick*="btnUpload"], button[onclick*="showGenerate"], #btnImport').forEach((b) => b.remove());
  }
  if (view.querySelector("#pfCards")) await portfolioTable();
};

// ---------------------------------------------------------------- 홈 포트폴리오: 카드 / 표 (대시보드는 표가 기본)
async function portfolioTable() {
  const cards = $("#pfCards"); if (!cards || $("#pfMode")) return;
  const pf = await api("/api/portfolio").catch(() => []);
  if (!cards.isConnected || $("#pfMode")) return;   // 불러오는 사이 다른 화면으로 옮겼으면 그만
  const by = Object.fromEntries(pf.map((p) => [p.id, p]));
  const key = "pfMode", def = isDashboard() ? "table" : "cards";
  let mode = store.get(key, def);
  cards.insertAdjacentHTML("beforebegin", `<div class="row end pf-mode-row"><div class="seg-tabs sm" role="group" aria-label="보기 방식" id="pfMode">
      <button data-m="cards">카드</button><button data-m="table">표</button></div></div>`);
  cards.insertAdjacentHTML("afterend", `<div class="scroll" id="pfTable" hidden></div>`);
  const LV = { ok: "정상", warn: "주의", bad: "위험" };
  const draw = () => {
    const ids = [...cards.querySelectorAll(".card-main")].map((a) => a.getAttribute("href").split("/")[2]);
    // 카드마다 이슈 수를 같은 상태 옆에 표시 (상황판·이슈 보드와 같은 숫자)
    cards.querySelectorAll(".card").forEach((c) => {
      const p = by[c.querySelector(".card-main")?.getAttribute("href").split("/")[2]];
      const n = p ? (p.level_detail?.issues?.bad || 0) + (p.level_detail?.issues?.warn || 0) : 0;
      if (n && !c.querySelector(".pc-iss")) c.querySelector(".status-badge")?.insertAdjacentHTML("afterend", `<span class="pc-iss" title="${esc((p.level_detail.reasons || []).join(" · "))}">이슈 ${n}</span>`);
    });
    $("#pfTable").innerHTML = `<table class="t pf-t"><thead><tr><th>상태</th><th>프로젝트</th><th>예상 준공</th><th class="num">목표 대비</th><th class="num">직전 대비</th><th class="num">SPI</th><th class="num">건전성</th><th class="num">이슈</th><th>Data Date</th></tr></thead><tbody>
      ${ids.map((id) => by[id]).filter(Boolean).map((p) => {
        const lv = p.level || "ok", iss = p.level_detail?.issues || {}, age = daysSince(p.data_date);
        return `<tr><td><span class="status-badge ${lv}">${LV[lv]}</span></td><td><a href="#/p/${p.id}/overview">${esc(p.name)}</a>${p.ref ? ' <span class="chip">참조</span>' : ""}</td>
          <td class="nowrap">${p.finish}</td><td class="num ${p.margin < 0 ? "bad" : ""}">${p.margin === null ? "-" : (p.margin >= 0 ? "+" : "") + p.margin}</td>
          <td class="num ${p.slip > 0 ? "bad" : ""}">${p.slip ? (p.slip > 0 ? "+" : "") + p.slip : "-"}</td><td class="num">${p.spi ?? "-"}</td><td class="num">${p.health ?? "-"}</td>
          <td class="num">${iss.bad ? `<b class="bad">${iss.bad}</b>` : ""}${iss.bad && iss.warn ? " · " : ""}${iss.warn ? `<span class="warn-text">${iss.warn}</span>` : ""}${iss.bad || iss.warn ? "" : "-"}</td>
          <td class="nowrap ${age > 45 ? "warn-text" : ""}" title="${age}일 전">${p.data_date}</td></tr>`;
      }).join("") || '<tr><td colspan="9" class="muted">조건에 맞는 프로젝트가 없습니다.</td></tr>'}</tbody></table>`;
  };
  const apply = () => {
    $("#pfMode").querySelectorAll("button").forEach((b) => { b.classList.toggle("on", b.dataset.m === mode); b.setAttribute("aria-pressed", String(b.dataset.m === mode)); });
    cards.hidden = mode === "table"; $("#pfTable").hidden = mode !== "table";
  };
  $("#pfMode").onclick = (e) => { const b = e.target.closest("[data-m]"); if (!b) return; mode = b.dataset.m; store.set(key, mode); apply(); };
  new MutationObserver(draw).observe(cards, { childList: true });
  draw(); apply();
}
function daysSince(iso) { return iso ? Math.round((Date.parse(today0()) - Date.parse(iso)) / 86400000) : 0; }
function today0() { return (window.PMS?.today || new Date().toISOString()).slice(0, 10); }

// ---------------------------------------------------------------- 첫 안내: 새로 바뀐 점과 '처음이신가요?'가 겹치지 않게
const _maybeWhatsNew27 = maybeWhatsNew;
maybeWhatsNew = async function (force = false) {
  if (!force && document.querySelector(".tour-pop")) return;   // '처음이신가요?' 안내 중이면 다음에
  await _maybeWhatsNew27(force);
  const ok = document.querySelector("dialog[open] .wn button[value=ok]");
  if (ok) ok.focus();   // 기본 동작은 '확인'
};
const _maybeOnboard27 = maybeOnboard;
maybeOnboard = function () {
  if (!store.get("onboarded") && (document.querySelector("dialog[open]") || (ctx.tab && ctx.tab !== "overview"))) return;   // 대화상자 위·깊은 화면에는 띄우지 않음
  if (!store.get("onboarded")) store.set("seenVersion", verKey(window.PMS?.version || ""));   // 처음 쓰는 사람에게는 '새로 바뀐 점'을 따로 띄우지 않음
  _maybeOnboard27();
};

// ---------------------------------------------------------------- 프로젝트 머리: 오래된 Data Date 경고 · 작업 메뉴 정리 · 휴대폰 현장 모드
const _showProject27 = showProject;
showProject = async function (uid, tab, ...rest) {
  const r = await _showProject27(uid, tab, ...rest);
  const ph = $("#phead");
  if (r && ph && !$("#ddAge")) {
    const age = daysSince(r.data_date);
    if (age > 35) $("#upSel")?.insertAdjacentHTML("afterend", `<span class="chip warn" id="ddAge" title="Data Date ${r.data_date}">${icon("alert", 12)} DD ${age}일 전 · 업데이트 필요</span>`);
  }
  const wm = $("#workMenu");
  if (wm && !wm.dataset.tidy) {
    wm.dataset.tidy = "1";
    wm.querySelectorAll('a[href^="#/wizard/"], a[href^="#/reports/"]').forEach((a) => a.remove());   // 왼쪽 메뉴에 이미 있음
    const share = wm.querySelector('[data-w="pub"], [data-w="pms"]');
    share?.insertAdjacentHTML("beforebegin", '<div class="menu-h" role="presentation">공유</div>');
    const tool = wm.querySelector('a[href^="#/p/"][href$="/timeline"], a[href^="#/field/"]');
    if (tool) { wm.append(Object.assign(document.createElement("div"), { className: "menu-h", role: "presentation", textContent: "도구" })); }
    wm.querySelectorAll('a[href$="/timeline"], a[href^="#/field/"], [data-w="req"], [data-w="help"], [data-w="recalc"]').forEach((x) => wm.append(x));
  }
  if ($("#crumb") && ph) $("#crumb").classList.add("crumb-dup");   // 바로 아래 큰 제목과 같아 좁은 화면에서는 숨김
  return r;
};

// ---------------------------------------------------------------- 업로드 대화상자: 끌어다 놓기 영역 · 로그인하면 업로더 이름 자동
(function uploadDialog() {
  const f = $("#formUpload"); if (!f) return;
  const inp = f.file, lab = inp.closest("label");
  const drop = document.createElement("label"); drop.className = "drop up-drop";
  drop.innerHTML = `${icon("upload", 22)}<b>공정표 파일을 끌어다 놓거나 눌러서 고르기</b><span class="muted fs12">.xer · .mpp · .xml · .mpx (.pms는 참조 프로젝트로 가져옵니다)</span><span class="up-name" aria-live="polite"></span>`;
  lab.replaceWith(drop); drop.prepend(inp); inp.classList.add("sr-file");
  const name = () => { drop.querySelector(".up-name").textContent = inp.files[0] ? `선택: ${inp.files[0].name}` : ""; drop.classList.toggle("has", !!inp.files[0]); };
  inp.addEventListener("change", name);
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.add("on"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove("on"); }));
  drop.addEventListener("drop", (e) => { if (e.dataTransfer.files.length) { inp.files = e.dataTransfer.files; name(); } });
  $("#dlgUpload").addEventListener("close", () => setTimeout(name, 0));
  const upl = f.uploader.closest("label");
  $("#btnUpload").addEventListener("click", () => {
    name();
    if (me?.username) { f.uploader.value = me.username; upl.hidden = true; } else upl.hidden = false;
  });
})();

// ---------------------------------------------------------------- 관리 화면: 내부 브랜치 이름 숨김
const _showAdmin27 = showAdmin;
showAdmin = async function (...a) {
  const r = await _showAdmin27(...a);
  view.querySelectorAll(".ver-line .muted").forEach((m) => { m.textContent = m.textContent.split(" · ").filter((x) => !/^(claude\/|feature\/|fix\/)/.test(x.trim())).join(" · "); });
  return r;
};

WHATSNEW["2.7"] = [
  { ic: "alert", t: "상태는 하나로", d: "상황판·홈·이슈 보드가 같은 상태를 보여 줍니다. 여유 기준과 이슈 규칙 중 더 나쁜 쪽이 상태가 되고, 상황판에 그 이유가 함께 나옵니다." },
  { ic: "gantt", t: "공정표 도구 모음 정리", d: "자주 쓰는 검색·주공정만·완료 제외·배율·오늘만 한 줄에 두고, 나머지는 '보기 옵션'에 묶었습니다. 작업 이름을 누르면 바로 상세가 열립니다." },
  { ic: "upload", t: "올리기는 머리글 하나로", d: "공정표 올리기 옆 ▾에서 PMS 파일 가져오기·대시보드에서 찾기·새 공정표 만들기를 고릅니다." },
  { ic: "sheet", t: "포트폴리오 표 보기", d: "홈에서 카드/표를 바꿀 수 있습니다. PMS 대시보드는 표가 기본이라 여러 프로젝트를 한눈에 비교합니다." },
];
