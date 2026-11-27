"use strict";
// ================================================================ PMS P0: 판 구분(PMS 현장 · PMS 대시보드), 관리자 이슈 기준·AI 정책

window.PMS = { edition: "client", edition_name: "PMS 현장" };
const pmsReady = fetch("/api/config").then((r) => r.json()).then((c) => { Object.assign(window.PMS, c); applyEdition(); return window.PMS; }).catch(() => window.PMS);
const isDashboard = () => window.PMS.edition === "server";

function applyEdition() {
  const n = window.PMS.edition_name;
  document.title = n;
  document.body.dataset.edition = window.PMS.edition;
  document.querySelectorAll(".pms-name").forEach((e) => (e.textContent = n));
  if (isDashboard()) {   // PMS 대시보드: 공정표 편집·현장 입력은 PMS 현장에서. 가져오기는 관리자만(게시 기능 P2 전 임시)
    const up = $("#btnUpload");
    if (up) { up.dataset.need = "admin"; up.title = "공정표 가져오기 (P2 게시 기능 전까지 관리자 임시 기능)"; }
    applyRole?.();
  }
}
document.addEventListener("DOMContentLoaded", applyEdition);

// 로그인 화면·사이드바에도 판 이름
const _showLogin10 = showLogin;
showLogin = function () { const p = _showLogin10(); pmsReady.then(applyEdition); return p; };
const _renderSide10 = renderSide;
renderSide = function () {
  _renderSide10();
  if (!isDashboard()) return;
  const home = $("#side a[href='#/']");
  if (home) home.querySelector(".s-label").textContent = "대시보드";
  $("#side a[href^='#/field/']")?.remove();
};
const _showList10 = showList;
showList = async function () {
  await _showList10();
  if (!isDashboard()) return;
  const h = view.querySelector(".page-head h2"); if (h) h.textContent = "대시보드";
  view.querySelector('.page-head button[onclick*="showGenerate"]')?.remove();   // 공정표 만들기·편집은 PMS 현장에서
  view.querySelectorAll('.page-head button[onclick*="btnUpload"]').forEach((b) => { b.dataset.need = "admin"; b.lastChild.textContent = " 가져오기(관리자)"; });
  applyRole?.(view);
  const p = view.querySelector(".page-head p"); if (p) p.textContent = `전사 프로젝트 ${p.textContent.match(/\d+/)?.[0] || ""}개의 공정 현황과 이슈입니다.`;
};
const _showProject10 = showProject;
showProject = async function (...a) {
  const r = await _showProject10(...a);
  if (isDashboard()) { $("#workMenu a[href^='#/field/']")?.remove(); $("#mobileHint")?.replaceChildren(); }
  return r;
};

// ---------------------------------------------------------------- 상태 기준: 관리자만 변경 (프로젝트 설정 화면은 조회 전용)
const _settingsStatus10 = settingsStatus;
settingsStatus = async function (el, r, uid) {
  await _settingsStatus10(el, r, uid);
  if ((me?.role || "admin") === "admin") return;
  el.querySelectorAll("[data-th]").forEach((x) => (x.disabled = true));
  $("#thSave")?.remove();
  el.querySelector(".panel p")?.insertAdjacentHTML("afterend", '<p class="chip warn">이슈 판정 기준은 관리자만 바꿀 수 있습니다 (조회 전용)</p>');
};

// ---------------------------------------------------------------- 관리 화면: 전사 이슈 기준 · 프로젝트별 AI 사용
const _showAdmin10 = showAdmin;
showAdmin = async function () {
  await _showAdmin10();
  const [th, pol, cfg] = await Promise.all([api("/api/admin/thresholds").catch(() => null), api("/api/admin/ai-policy").catch(() => []), pmsReady]);
  if (!th) return;
  const F = [["margin_bad", "목표 대비 여유가 이 값(일) 미만이면 위험", "기본 0"], ["margin_warn", "목표 대비 여유가 이 값(일) 미만이면 주의", "예: 10"],
    ["slip_warn", "직전 대비 준공 지연이 이 값(일) 이상이면 주의", "기본 1"], ["health_bad", "건전성 점수가 이 값 미만이면 위험", "예: 60"],
    ["health_warn", "건전성 점수가 이 값 미만이면 주의", "예: 75"], ["spi_warn", "SPI가 이 값 미만이면 주의", "예: 0.9"]];
  const p = document.createElement("div"); p.className = "panel"; p.id = "pmsPolicy";
  p.innerHTML = `<h3 class="mt0">${icon("gauge", 18)} 이슈 판정 기준 (전사 기본값)</h3>
    <p class="muted fs13">모든 프로젝트의 상황판·포트폴리오의 정상·주의·위험 판정에 쓰입니다. 비워 두면 그 기준은 쓰지 않습니다. 프로젝트별 값은 각 프로젝트 설정 → 상태 기준에서 관리자가 덮어쓸 수 있습니다.</p>
    <div class="th-grid">${F.map(([k, l, ph]) => `<label>${l}<input class="s" type="number" step="${k === "spi_warn" ? "0.01" : "1"}" data-tth="${k}" value="${th.values[k] ?? ""}" placeholder="${ph}"></label>`).join("")}</div>
    <div class="row end"><button class="btn primary" id="tthSave">전사 기준 저장</button></div>
    <h3>${icon("sparkles", 18)} 프로젝트별 AI 사용</h3>
    <p class="muted fs13">계약상 데이터 외부 전송이 제한되는 프로젝트는 '금지'로 두면 그 프로젝트의 모든 AI 기능이 규칙 기반으로만 동작합니다. AI 실행 위치: <b>${esc(cfg.ai_route_note || "")}</b></p>
    ${pol.length ? `<table class="t" data-noexport><thead><tr><th>프로젝트</th><th>AI 사용</th></tr></thead><tbody>${pol.map((x) => `<tr><td>${esc(x.project)}</td>
      <td><select class="s sm" data-aip="${esc(x.project)}" aria-label="${esc(x.project)} AI 사용"><option value="allow" ${x.policy === "allow" ? "selected" : ""}>허용</option><option value="forbid" ${x.policy === "forbid" ? "selected" : ""}>금지</option></select></td></tr>`).join("")}</tbody></table>` : emptyState("프로젝트가 없습니다")}`;
  ($("#updPanel") || view.querySelector("h2"))?.after(p);
  $("#tthSave").onclick = () => withBusy($("#tthSave"), async () => {
    const body = Object.fromEntries([...p.querySelectorAll("[data-tth]")].map((x) => [x.dataset.tth, x.value]));
    await api("/api/admin/thresholds", { method: "PUT", json: body }); toast("전사 기준을 저장했습니다");
  });
  p.querySelectorAll("[data-aip]").forEach((s) => (s.onchange = async () => {
    await api("/api/admin/ai-policy", { method: "PUT", json: { project: s.dataset.aip, policy: s.value } });
    Object.keys(aiStatusByUid).forEach((k) => delete aiStatusByUid[k]);
    toast(`${s.dataset.aip}: AI ${s.value === "allow" ? "허용" : "금지"}`);
  }));
};

// 새로 바뀐 점 2.0
WHATSNEW["2.0"] = [
  { ic: "layers", t: "이제 PMS입니다", d: "프로그램 이름을 PMS로 바꾸고, 같은 프로그램을 'PMS 현장'(내 프로젝트 공정관리)과 'PMS 대시보드'(본사 현황·이슈)의 두 판으로 나누기 시작했습니다." },
  { ic: "gauge", t: "이슈 판정 기준은 관리자가", d: "정상·주의·위험 판정 기준은 관리 화면에서 관리자가 전사 기본값으로 정합니다. 프로젝트 화면에서는 조회만 됩니다." },
  { ic: "sparkles", t: "프로젝트별 AI 사용 정책", d: "계약상 외부 전송이 제한된 프로젝트는 관리자가 AI 사용을 금지할 수 있습니다. AI 안내에 이유가 표시됩니다." },
];
