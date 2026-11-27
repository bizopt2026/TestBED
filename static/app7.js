"use strict";
// ================================================================ 9차: 색 테마(메인·포인트 색) 고르기
const PALETTES = {
  graphite: { name: "그래파이트 + 틸", desc: "차분한 먹색 메인, 청록 포인트 (추천)", sw: ["#23262b", "#0f8a7e", "#f7f7f5", "#d4a442"] },
  navy: { name: "네이비 + 앰버", desc: "신뢰감 있는 남색 메인, 호박색 포인트", sw: ["#1d3557", "#d9902a", "#f6f7f9", "#4e8f7c"] },
  indigo: { name: "인디고", desc: "이전 색을 채도를 낮춰 정리", sw: ["#3d3fb8", "#4f52d6", "#f6f7f9", "#d4a442"] },
};
function setPalette(k) {
  store.set("palette", k); applyTheme();
  document.querySelectorAll("[data-pal]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.pal === k)));
  if (ctx.tab === "gantt" || location.hash.includes("/gantt")) window.dispatchEvent(new Event("resize"));   // 공정표 다시 그리기
}
function palettePicker() {
  const cur = store.get("palette", "graphite");
  return `<div class="pal-pick" role="group" aria-label="색 테마">${Object.entries(PALETTES).map(([k, p]) => `<button type="button" class="pal-card" data-pal="${k}" aria-pressed="${k === cur}">
    <b>${p.name}</b><div class="sw">${p.sw.map((c) => `<i style="background:${c}"></i>`).join("")}</div><span class="muted fs12">${p.desc}</span></button>`).join("")}</div>`;
}
function bindPalettePicker(root) { root.querySelectorAll("[data-pal]").forEach((b) => (b.onclick = () => { setPalette(b.dataset.pal); toast(`색 테마: ${PALETTES[b.dataset.pal].name}`); })); }
// 범례의 예전 색 → 현재 팔레트 색
function chartColor(c) { const k = CHART_REMAP[String(c).toLowerCase()]; return k ? `var(${k})` : c; }

const _showMe9 = showMe;
showMe = async function () {
  await _showMe9();
  const sec = $("#me-view");
  sec?.querySelector("h3")?.insertAdjacentHTML("afterend", `<h4 class="mt0">색 테마</h4>${palettePicker()}<h4>그 밖의 화면 설정</h4>`);
  if (sec) bindPalettePicker(sec);
};
const _showDesign9 = showDesign;
showDesign = async function () {
  await _showDesign9();
  const p = document.createElement("div"); p.className = "panel";
  p.innerHTML = `<h3 class="mt0">색 테마</h3><p class="muted fs13">메인 색은 주요 버튼·로고, 포인트 색은 선택 표시·진행률·탭 밑줄·링크에 씁니다. 내 설정에서도 바꿀 수 있습니다.</p>${palettePicker()}`;
  view.querySelector(".page-head")?.after(p); bindPalettePicker(p);
};
