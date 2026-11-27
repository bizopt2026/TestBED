"use strict";
// ================================================================ 📊 엑셀 양식 리포트: 양식 업로드 → 프로젝트 선택 → 양식대로 채운 엑셀 내려받기

async function showReports(preUid) {
  $("#crumb").textContent = "/ 엑셀 리포트";
  ctx.uid = preUid || null;
  const [tpls, ups, fields, hist] = await Promise.all([api("/api/reports/templates"), api("/api/uploads"), api("/api/reports/fields"), api("/api/reports/history").catch(() => [])]);
  const projects = {};
  ups.forEach((u) => (projects[u.name] ||= []).push(u));
  Object.values(projects).forEach((xs) => xs.sort((a, b) => (a.data_date < b.data_date ? 1 : -1)));
  const pre = ups.find((u) => u.id === preUid);
  const selTpl = store.get("rptTpl", tpls[0]?.id);
  view.innerHTML = `<h2 style="margin-top:0">📊 엑셀 리포트</h2>
    <p class="muted">회사 보고 양식(엑셀)에 <code>{{project.finish}}</code> 같은 자리표시자를 넣어 올리면, 선택한 프로젝트의 공정 현황을 양식 그대로 채워 엑셀로 내려받습니다. 서식·차트·수식은 유지됩니다.</p>
    <div class="steps3">
      <div class="panel"><h3 style="margin-top:0">① 양식 선택</h3>
        <div id="tplList" role="radiogroup" aria-label="양식">${tpls.map((t) => `<label class="tpl ${t.id === selTpl ? "on" : ""}"><input type="radio" name="tpl" value="${esc(t.id)}" ${t.id === selTpl ? "checked" : ""}>
          <div><b>${esc(t.name)}</b> ${t.builtin ? '<span class="tag">기본 제공</span>' : ""}<div class="muted" style="font-size:12px">${esc(t.desc || "")}
          ${t.scan ? ` · 필드 ${t.scan.fields}개 · 표 ${t.scan.lists.length}개${t.scan.unknown?.length ? ` · <span style="color:var(--crit)">알 수 없는 필드 ${t.scan.unknown.length}</span>` : ""}` : ""}
          ${t.author ? ` · ${esc(t.author)}` : ""}</div></div>
          <span class="row" style="gap:4px"><button class="btn sm" data-dl="${esc(t.id)}" title="양식 내려받기">⭳</button>${t.builtin ? "" : `<button class="btn sm danger" data-rm="${esc(t.id)}" data-need="editor" data-scope="global" title="삭제">✕</button>`}</span></label>`).join("")}</div>
        <div class="row" style="margin-top:10px"><button class="btn primary" id="tplUp" data-need="editor" data-scope="global">+ 내 양식 올리기 (.xlsx)</button>
          <button class="btn" id="tplGuide">작성 방법</button></div></div>
      <div class="panel"><h3 style="margin-top:0">② 프로젝트 선택</h3>
        <label>프로젝트<select class="s" id="rpProj" style="width:100%">${Object.keys(projects).map((n) => `<option ${pre?.name === n ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
        <label style="display:block;margin-top:8px">업데이트(Data Date)<select class="s" id="rpUp" style="width:100%"></select></label>
        <label class="chk" style="display:block;margin-top:10px"><input type="checkbox" id="rpAi" data-need="editor"> ✦ 요약 문장을 AI로 작성 <span class="muted" style="font-size:12px">(summary.* 필드, 서버 Claude CLI)</span></label>
        <p class="muted" style="font-size:12px">직전 업데이트 비교 값(prev.*, 지연 원인, 변경 로그)은 같은 프로젝트의 바로 이전 업데이트와 자동 비교합니다.</p></div>
      <div class="panel"><h3 style="margin-top:0">③ 생성</h3>
        <button class="btn primary big" id="rpGo">엑셀 리포트 만들기</button>
        <div id="rpOut" aria-live="polite" style="margin-top:10px"></div></div>
    </div>
    <div class="grid2">
      <div class="panel"><h3 style="margin-top:0">필드 목록 <span class="muted" style="font-size:13px">누르면 복사</span></h3>
        <input class="s" type="search" id="fq" placeholder="필드 검색 (예: 준공, spi, 리스크)" style="width:100%">
        <div id="fList" class="fields"></div></div>
      <div class="panel"><h3 style="margin-top:0">최근 생성 이력</h3>
        <table class="t" data-noexport><thead><tr><th>시각</th><th>프로젝트</th><th>양식</th><th>작성자</th><th>경고</th></tr></thead><tbody>
        ${hist.slice(0, 15).map((h) => `<tr><td>${h.created_at.replace("T", " ").slice(5, 16)}</td><td>${esc(h.project)} <span class="muted">${h.data_date}</span></td><td>${esc(h.template)}</td><td>${esc(h.author)}</td><td class="num">${h.warnings?.length || ""}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">아직 없습니다.</td></tr>'}</tbody></table></div>
    </div>`;
  applyRole(view);
  const fillUps = () => { const xs = projects[$("#rpProj").value] || []; $("#rpUp").innerHTML = xs.map((u, i) => `<option value="${u.id}" ${u.id === preUid ? "selected" : ""}>${u.data_date} · ${esc(u.note || u.filename)}${i === 0 ? " (최신)" : ""}</option>`).join(""); };
  fillUps(); $("#rpProj").onchange = fillUps;
  view.querySelectorAll("input[name=tpl]").forEach((r) => (r.onchange = () => { store.set("rptTpl", r.value); view.querySelectorAll(".tpl").forEach((l) => l.classList.toggle("on", l.contains(r) && r.checked)); }));
  view.querySelectorAll("[data-dl]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); download(`/api/reports/templates/${encodeURIComponent(b.dataset.dl)}/file`, "template.xlsx"); }));
  view.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async (e) => {
    e.preventDefault(); if (!(await ui.confirm("이 양식을 삭제할까요? 팀 전체에서 사라집니다.", { ok: "삭제", danger: true }))) return;
    await api(`/api/reports/templates/${encodeURIComponent(b.dataset.rm)}`, { method: "DELETE" }); showReports(preUid);
  }));
  $("#tplUp").onclick = () => uploadTemplate(preUid);
  $("#tplGuide").onclick = () => templateGuide();
  $("#rpGo").onclick = async () => {
    const tid = view.querySelector("input[name=tpl]:checked")?.value, uid = $("#rpUp").value;
    if (!tid || !uid) return toast("양식과 프로젝트를 선택하세요");
    const useAi = $("#rpAi").checked;
    const res = await runLong(useAi ? "AI 문장 작성 후 양식을 채우는 중" : "양식을 채우는 중", "xlsx" + useAi, (signal) =>
      api("/api/reports/render", { method: "POST", signal, json: { template_id: tid, upload_id: uid, ai: useAi } }));
    if (!res) return;
    const blob = await res.blob();
    const m = (res.headers.get("content-disposition") || "").match(/filename\*=UTF-8''([^;]+)/);
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = m ? decodeURIComponent(m[1]) : "report.xlsx"; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 1000);
    let warns = [], stats = {};
    try { warns = JSON.parse(decodeURIComponent(res.headers.get("x-report-warnings") || "%5B%5D")); stats = JSON.parse(decodeURIComponent(res.headers.get("x-report-stats") || "%7B%7D")); } catch {}
    $("#rpOut").innerHTML = `<div class="chip ok">✓ 내려받았습니다</div><p class="muted">값 ${stats.values ?? "-"}개, 표 행 ${stats.rows ?? "-"}개를 채웠습니다.</p>
      ${warns.length ? `<div class="panel warn"><b>확인할 점 ${warns.length}건</b><ul>${warns.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}`;
  };
  const drawFields = (q) => {
    q = (q || "").toLowerCase();
    const m = (s) => !q || s.toLowerCase().includes(q);
    const sc = fields.scalars.filter((f) => m(f.key + f.desc));
    const ls = fields.lists.map((l) => ({ ...l, fields: l.fields.filter((f) => m(l.name + "." + f.key + l.desc + f.desc)) })).filter((l) => l.fields.length || m(l.name + l.desc));
    $("#fList").innerHTML = `<h4>값 (한 셀)</h4>${sc.map((f) => `<button class="fld" data-copy="{{${f.key}}}" title="예: ${esc(String(f.example))}"><code>{{${esc(f.key)}}}</code><span>${esc(f.desc)}</span></button>`).join("") || '<p class="muted">없음</p>'}
      <h4>표 (행 반복)</h4>${ls.map((l) => `<details ${q ? "open" : ""}><summary><code>${esc(l.name)}</code> ${esc(l.desc)}</summary>
        <button class="btn sm" data-copyrow="${esc(l.name)}">이 표의 한 행 전체 복사 (탭 구분, 엑셀에 붙여넣기)</button>
        ${l.fields.map((f) => `<button class="fld" data-copy="{{${l.name}.${f.key}}}"><code>{{${esc(l.name)}.${esc(f.key)}}}</code><span>${esc(f.desc)}</span></button>`).join("")}</details>`).join("")}`;
    $("#fList").querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => copyText(b.dataset.copy)));
    $("#fList").querySelectorAll("[data-copyrow]").forEach((b) => (b.onclick = () => {
      const l = fields.lists.find((x) => x.name === b.dataset.copyrow);
      copyText(l.fields.map((f) => f.desc).join("\t") + "\n" + l.fields.map((f) => `{{${l.name}.${f.key}}}`).join("\t"));
    }));
  };
  drawFields(""); $("#fq").oninput = (e) => drawFields(e.target.value);
}

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast(`복사했습니다: ${t.length > 40 ? t.slice(0, 40) + "…" : t}`); }
  catch { ui.notice("복사", `<textarea style="width:100%" rows="4">${esc(t)}</textarea>`); }
}

async function uploadTemplate(preUid) {
  const d = _modal(`<form method="dialog" id="fTpl"><h3>내 양식 올리기</h3>
    <p class="muted">회사 보고 양식(.xlsx)에 자리표시자를 넣어 올리세요. 매크로 파일(.xlsm)은 받지 않습니다.</p>
    <label>양식 파일<input type="file" name="file" accept=".xlsx" required></label>
    <label>이름<input name="name" placeholder="예: 본사 월간 공정보고"></label><label>설명<input name="desc" placeholder="예: 발주처 제출용, 4개 시트"></label>
    <div class="row end"><button class="btn" value="cancel" formnovalidate>취소</button><button class="btn primary" value="ok">올리기</button></div><p class="err" id="tplErr"></p></form>`);
  $("#fTpl").onsubmit = async (e) => {
    if (e.submitter?.value !== "ok") return; e.preventDefault();
    try {
      const r = await api("/api/reports/templates", { method: "POST", body: new FormData(e.target) });
      d.close(); store.set("rptTpl", r.id);
      const s = r.scan;
      ui.notice("양식 점검 결과", `<p>시트 ${s.sheets.length}개 · 인식한 필드 <b>${s.fields}</b>개 · 반복 표 <b>${s.lists.length}</b>개 (${s.lists.map(esc).join(", ") || "없음"})</p>
        ${s.unknown.length ? `<h4 style="color:var(--crit)">알 수 없는 필드 ${s.unknown.length}개</h4><table class="t" data-noexport><tbody>${s.unknown.map((u) => `<tr><td>${esc(u.sheet)}!${u.cell}</td><td><code>{{${esc(u.expr)}}}</code></td></tr>`).join("")}</tbody></table><p class="muted">철자를 '필드 목록'과 비교해 고친 뒤 다시 올리세요. 그대로 두면 빈칸으로 출력됩니다.</p>` : "<p>✓ 모든 필드를 인식했습니다.</p>"}
        ${s.fields === 0 ? `<p class="warn-text">자리표시자가 하나도 없습니다. '작성 방법'을 참고하세요.</p>` : ""}`);
      showReports(preUid);
    } catch (err) { $("#tplErr").textContent = err.message; }
  };
}

function templateGuide() {
  ui.notice("엑셀 양식 작성 방법", `<ol>
    <li><b>값 넣기</b>: 셀에 <code>{{project.finish}}</code>처럼 입력합니다. 셀 서식을 '날짜'로 두면 날짜 값, '숫자'면 숫자 값으로 들어갑니다. 문장 안에도 쓸 수 있습니다: <code>{{project.name}} ({{report.month}})</code></li>
    <li><b>표 채우기</b>: 머리글 바로 아래 한 행에 <code>{{critical.code}}</code> <code>{{critical.name}}</code> …을 넣으면 작업 수만큼 아래로 채웁니다. <b>아래 행은 비워 두세요</b>(다른 내용을 만나면 멈추고 경고). 엑셀 '표'로 만들어 두면 범위도 자동으로 늘어납니다.</li>
    <li><b>개수 제한·순번</b>: <code>{{late[20].code}}</code>는 20건까지, <code>{{critical.#}}</code>은 1, 2, 3…</li>
    <li><b>서식</b>: <code>|date:%Y.%m.%d</code> 날짜 모양, <code>|num:1</code> 소수 자리, <code>|pct</code> 백분율 셀용(÷100), <code>|default:-</code> 값이 없을 때</li>
    <li><b>차트</b>: 표가 채워질 범위(예: A5:D200)를 차트 데이터로 지정해 두면 열 때 자동으로 그려집니다.</li>
    <li><b>글자 그대로</b>: <code>\\{{</code>로 쓰면 자리표시자로 처리하지 않습니다.</li>
  </ol><p>가장 쉬운 방법은 <b>기본 제공 양식을 내려받아</b> 회사 서식으로 고치는 것입니다.</p>`);
}
