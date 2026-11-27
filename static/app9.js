"use strict";
// ================================================================ PMS P1: .pms 패키지 공유(파일·붙여넣기), 참조 프로젝트, 복제

async function importPms(file) {
  const fd = new FormData(); fd.append("file", file);
  try {
    const r = await api("/api/import/pms", { method: "POST", body: fd });
    afterImport(r);
  } catch (e) { toast(e.message); }
}
function afterImport(r) {
  uploadsCache = null;
  toast(r.duplicate ? `이미 가져온 판입니다 (${r.name} v${r.version})` : `참조 프로젝트로 가져왔습니다: ${r.name} v${r.version}`);
  location.hash = `#/p/${r.uid}/overview`;
}
function importDialog() {
  const d = _modal(`<form method="dialog" id="fImp" style="min-width:min(560px,92vw)"><h3>프로젝트 가져오기</h3>
    <p class="muted fs13">다른 사람이 보낸 <b>.pms 파일</b>이나 <b>붙여넣기 텍스트(PMS1:…)</b>를 넣으면 <b>참조 프로젝트</b>(읽기 전용)로 들어옵니다. 같은 프로젝트의 새 판을 다시 가져오면 이력으로 쌓입니다.</p>
    <label class="drop" id="impDrop">${icon("upload", 22)}<span>.pms 파일을 여기에 끌어다 놓거나 눌러서 고르기</span><input type="file" accept=".pms" id="impFile" hidden></label>
    <label class="db mt12">또는 붙여넣기 텍스트<textarea class="s w100" id="impText" rows="4" placeholder="PMS1:UEsDBBQAAAAIA…"></textarea></label>
    <p class="err" id="impErr" role="alert"></p>
    <div class="row end"><button class="btn" value="cancel" formnovalidate>닫기</button><button class="btn primary" value="ok">가져오기</button></div></form>`);
  const drop = $("#impDrop");
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("on"); };
  drop.ondragleave = () => drop.classList.remove("on");
  drop.ondrop = (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { d.close(); importPms(f); } };
  $("#impFile").onchange = (e) => { const f = e.target.files[0]; if (f) { d.close(); importPms(f); } };
  $("#fImp").onsubmit = async (e) => {
    if (e.submitter?.value !== "ok") return; e.preventDefault();
    const t = $("#impText").value.trim();
    if (!t) { $("#impErr").textContent = "파일을 고르거나 텍스트를 붙여넣으세요"; return; }
    try { const r = await api("/api/import/text", { method: "POST", json: { text: t } }); d.close(); afterImport(r); }
    catch (err) { $("#impErr").textContent = err.message; }
  };
}
async function exportText(uid) {
  try {
    const r = await api(`/api/uploads/${uid}/export.txt`);
    await navigator.clipboard?.writeText(r.text).catch(() => {});
    const d = _modal(`<form method="dialog" style="min-width:min(560px,92vw)"><h3>붙여넣기 텍스트</h3>
      <p class="muted fs13">${esc(r.project)} v${r.version} (${Math.round(r.size / 1024)}KB). 클립보드에 복사했습니다. 메신저 등에 붙여넣어 보내면, 받는 사람은 '가져오기'에 붙여넣습니다.</p>
      <textarea class="s w100" rows="6" readonly aria-label="붙여넣기 텍스트">${esc(r.text)}</textarea>
      <div class="row end"><button class="btn primary" value="ok">닫기</button></div></form>`);
    d.querySelector("textarea").select();
  } catch (e) { toast(e.message); }
}

// 프로젝트 화면: 내보내기 메뉴 · 참조 프로젝트 안내 띠
const _showProject11 = showProject;
showProject = async function (uid, tab, ...rest) {
  const r = await _showProject11(uid, tab, ...rest);
  const wm = $("#workMenu");
  if (wm && !wm.querySelector("[data-w='pms']")) {
    wm.querySelector("[data-w='help']")?.insertAdjacentHTML("beforebegin", `<hr><button role="menuitem" data-w="pms">${icon("package")}PMS 파일로 내보내기 (.pms)</button>
      <button role="menuitem" data-w="pmstxt">${icon("copy")}붙여넣기 텍스트로 복사</button><hr>`);
    wm.querySelector("[data-w='pms']").onclick = () => download(`/api/uploads/${ctx.uid}/export.pms`, "project.pms");
    wm.querySelector("[data-w='pmstxt']").onclick = () => exportText(ctx.uid);
  }
  if (!$("#refBar") && $("#phead")) {
    const perm = await api(`/api/uploads/${uid}/perm`).catch(() => ({}));
    if (perm.ref && $("#phead") && !$("#refBar")) {
      const m = perm.ref;
      $("#phead").insertAdjacentHTML("afterend", `<div class="ref-bar" id="refBar" role="note">${icon("eye", 16)}<span><b>참조 프로젝트</b> · 원본 '${esc(m.project)}' v${m.version}
        · ${esc(m.publisher || "알 수 없음")}${m.exported_at ? ` ${esc(m.exported_at.replace("T", " ").slice(0, 16))}` : ""} · ${{ file: "파일", paste: "붙여넣기", code: "공유 코드", hub: "PMS 대시보드" }[m.source] || ""}로 받음 · 읽기 전용</span>
        <span class="spacer"></span><button class="btn sm" id="refClone" data-need="editor">내 프로젝트로 복제</button></div>`);
      $("#refClone").onclick = async () => {
        const v = await ui.form("내 프로젝트로 복제", [{ name: "name", label: "새 프로젝트 이름", required: true, value: m.project }],
          { submit: "복제", intro: "최신 판과 리스크·제약·약속을 복사해 편집할 수 있는 내 프로젝트를 만듭니다. 원본 참조 프로젝트는 그대로 남습니다." });
        if (!v) return;
        try { const c = await api(`/api/projects/${encodeURIComponent($("#phead .pname").textContent)}/clone`, { method: "POST", json: v }); uploadsCache = null; toast("복제했습니다"); location.hash = `#/p/${c.uid}/overview`; }
        catch (e) { toast(e.message); }
      };
      applyRole($("#refBar"));
    }
  }
  return r;
};
// 홈: 가져오기 버튼, 참조 표시
const _showList11 = showList;
showList = async function () {
  await _showList11();
  const row = view.querySelector(".page-head .row");
  if (row && !$("#btnImport")) {
    row.insertAdjacentHTML("afterbegin", `<button class="btn" id="btnImport" data-need="editor">${icon("package", 15)} 가져오기</button>`);
    $("#btnImport").onclick = importDialog; applyRole(row);
  }
  const pf = await api("/api/portfolio").catch(() => []);
  pf.filter((p) => p.ref).forEach((p) => {
    const card = view.querySelector(`.card a[href="#/p/${p.id}/overview"]`)?.closest(".card");
    card?.querySelector(".pc-sub")?.insertAdjacentHTML("afterbegin", `<span class="chip">참조 v${p.ref.version}</span> `);
  });
};
// 창 어디에나 .pms 파일을 끌어다 놓으면 가져오기
window.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === "file")) e.preventDefault(); });
window.addEventListener("drop", (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (f && /\.pms$/i.test(f.name) && !e.target.closest?.("#impDrop")) { e.preventDefault(); importPms(f); }
});

WHATSNEW["2.1"] = [
  { ic: "package", t: "PMS 파일로 프로젝트 주고받기", d: "프로젝트 화면 '작업 ▾ → PMS 파일로 내보내기'로 .pms 파일을 만들어 보내면, 받는 사람은 홈 '가져오기'(또는 창에 끌어다 놓기)로 엽니다." },
  { ic: "copy", t: "붙여넣기 텍스트로 보내기", d: "작은 프로젝트는 '붙여넣기 텍스트로 복사'로 메신저에 바로 붙여넣어 보낼 수 있습니다." },
  { ic: "eye", t: "참조 프로젝트", d: "받은 프로젝트는 읽기 전용 참조 프로젝트로 들어오고 출처(누가·언제·몇 번째 판)가 표시됩니다. 편집하려면 '내 프로젝트로 복제'를 누르세요." },
];
