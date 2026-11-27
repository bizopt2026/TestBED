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
  view.innerHTML = `<h2 class="mt0">📊 엑셀 리포트</h2>
    <p class="muted">회사 보고 양식(엑셀)에 <code>{{project.finish}}</code> 같은 자리표시자를 넣어 올리면, 선택한 프로젝트의 공정 현황을 양식 그대로 채워 엑셀로 내려받습니다. 서식·차트·수식은 유지됩니다.</p>
    <div class="steps3">
      <div class="panel"><h3 class="mt0">① 양식 선택</h3>
        <div id="tplList" role="radiogroup" aria-label="양식">${tpls.map((t) => `<label class="tpl ${t.id === selTpl ? "on" : ""}"><input type="radio" name="tpl" value="${esc(t.id)}" ${t.id === selTpl ? "checked" : ""}>
          <div><b>${esc(t.name)}</b> ${t.builtin ? '<span class="tag">기본 제공</span>' : ""}<div class="muted fs12">${esc(t.desc || "")}
          ${t.scan ? ` · 필드 ${t.scan.fields}개 · 표 ${t.scan.lists.length}개${t.scan.unknown?.length ? ` · <span style="color:var(--crit-text)">알 수 없는 필드 ${t.scan.unknown.length}</span>` : ""}` : ""}
          ${t.author ? ` · ${esc(t.author)}` : ""}</div></div>
          <span class="row" style="gap:4px"><button class="btn sm" data-dl="${esc(t.id)}" title="양식 내려받기" aria-label="양식 내려받기">⭳</button>${t.builtin ? "" : `<button class="btn sm" data-ver="${esc(t.id)}" title="버전 기록" aria-label="버전 기록">이력</button>`}${t.builtin ? "" : `<button class="btn sm danger" data-rm="${esc(t.id)}" data-need="editor" data-scope="global" title="삭제">✕</button>`}</span></label>`).join("")}</div>
        <div class="row" style="margin-top:10px"><button class="btn primary" id="tplUp" data-need="editor" data-scope="global">+ 내 양식 올리기 (.xlsx)</button>
          <button class="btn" id="tplGuide">작성 방법</button></div></div>
      <div class="panel"><h3 class="mt0">② 프로젝트 선택</h3>
        <label>프로젝트<select class="s" id="rpProj" style="width:100%">${Object.keys(projects).map((n) => `<option ${pre?.name === n ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
        <label class="db mt8">업데이트(Data Date)<select class="s" id="rpUp" style="width:100%"></select></label>
        <label class="db mt8">비교 기준<select class="s" id="rpBase" style="width:100%"></select></label>
        <label class="chk" style="display:block;margin-top:10px"><input type="checkbox" id="rpAi" data-need="editor"> ✦ 요약 문장을 AI로 작성 <span class="muted fs12">(summary.* 필드, 서버 Claude CLI)</span></label>
        <p class="muted fs12">직전 업데이트 비교 값(prev.*, 지연 원인, 변경 로그)은 같은 프로젝트의 바로 이전 업데이트와 자동 비교합니다.</p></div>
      <div class="panel"><h3 class="mt0">③ 생성</h3>
        <button class="btn big" id="rpPrev">미리보기</button>
        <button class="btn primary big" id="rpGo" style="margin-top:8px">엑셀 리포트 만들기</button>
        <div id="rpOut" aria-live="polite" style="margin-top:10px"></div></div>
    </div>
    <div class="grid2">
      <div class="panel"><h3 class="mt0">필드 목록 <span class="muted fs13">누르면 복사</span></h3>
        <input class="s" type="search" id="fq" placeholder="필드 검색 (예: 준공, spi, 리스크)" style="width:100%">
        <div id="fList" class="fields"></div></div>
      <div class="panel"><h3 class="mt0">최근 생성 이력</h3>
        <table class="t" data-noexport><thead><tr><th>시각</th><th>프로젝트</th><th>양식</th><th>작성자</th><th>경고</th></tr></thead><tbody>
        ${hist.slice(0, 15).map((h) => `<tr><td>${h.created_at.replace("T", " ").slice(5, 16)}</td><td>${esc(h.project)} <span class="muted">${h.data_date}</span></td><td>${esc(h.template)}</td><td>${esc(h.author)}</td><td class="num">${h.warnings?.length || ""}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">아직 없습니다.</td></tr>'}</tbody></table></div>
    </div>`;
  applyRole(view);
  const fillBase = () => {
    const name = $("#rpProj").value, xs = projects[name] || [], cur = xs.find((u) => u.id === $("#rpUp").value);
    $("#rpBase").innerHTML = `<option value="">직전 업데이트(자동)</option>` + xs.filter((u) => cur && u.data_date < cur.data_date).map((u) => `<option value="${u.id}" ${getBase(name) === u.id ? "selected" : ""}>${u.data_date} · ${esc(u.note || u.filename)}</option>`).join("");
  };
  const fillUps = () => { const xs = projects[$("#rpProj").value] || []; $("#rpUp").innerHTML = xs.map((u, i) => `<option value="${u.id}" ${u.id === preUid ? "selected" : ""}>${u.data_date} · ${esc(u.note || u.filename)}${i === 0 ? " (최신)" : ""}</option>`).join(""); fillBase(); };
  fillUps(); $("#rpProj").onchange = fillUps; $("#rpUp").onchange = fillBase;
  $("#rpBase").onchange = () => setBase($("#rpProj").value, $("#rpBase").value);
  view.querySelectorAll("input[name=tpl]").forEach((r) => (r.onchange = () => { store.set("rptTpl", r.value); view.querySelectorAll(".tpl").forEach((l) => l.classList.toggle("on", l.contains(r) && r.checked)); }));
  view.querySelectorAll("[data-dl]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); download(`/api/reports/templates/${encodeURIComponent(b.dataset.dl)}/file`, "template.xlsx"); }));
  view.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async (e) => {
    e.preventDefault(); if (!(await ui.confirm("이 양식을 삭제할까요? 팀 전체에서 사라집니다.", { ok: "삭제", danger: true }))) return;
    await api(`/api/reports/templates/${encodeURIComponent(b.dataset.rm)}`, { method: "DELETE" }); showReports(preUid);
  }));
  $("#tplUp").onclick = () => uploadTemplate(preUid);
  view.querySelectorAll("[data-ver]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); templateVersions(b.dataset.ver, preUid); }));
  $("#rpPrev").onclick = async () => {
    const tid = view.querySelector("input[name=tpl]:checked")?.value, uid = $("#rpUp").value;
    if (!tid || !uid) return toast("양식과 프로젝트를 선택하세요");
    const pv = await runLong("미리보기를 만드는 중", "xlsxprev", (signal) => api("/api/reports/preview", { method: "POST", signal, json: { template_id: tid, upload_id: uid, base: $("#rpBase").value || null } }));
    if (pv) showPreview(pv);
  };
  $("#tplGuide").onclick = () => templateGuide();
  $("#rpGo").onclick = async () => {
    const tid = view.querySelector("input[name=tpl]:checked")?.value, uid = $("#rpUp").value;
    if (!tid || !uid) return toast("양식과 프로젝트를 선택하세요");
    const useAi = $("#rpAi").checked;
    const res = await runLong(useAi ? "AI 문장 작성 후 양식을 채우는 중" : "양식을 채우는 중", "xlsx" + useAi, (signal) =>
      api("/api/reports/render", { method: "POST", signal, json: { template_id: tid, upload_id: uid, ai: useAi, base: $("#rpBase").value || null } }));
    if (!res) return;
    const blob = await res.blob();
    const m = (res.headers.get("content-disposition") || "").match(/filename\*=UTF-8''([^;]+)/);
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = m ? decodeURIComponent(m[1]) : "report.xlsx"; a.hidden = true; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 1000);
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
  catch { ui.notice("복사", `<textarea class="w100" rows="4">${esc(t)}</textarea>`); }
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
        ${s.unknown.length ? `<h4 style="color:var(--crit-text)">알 수 없는 필드 ${s.unknown.length}개</h4><table class="t" data-noexport><tbody>${s.unknown.map((u) => `<tr><td>${esc(u.sheet)}!${u.cell}</td><td><code>{{${esc(u.expr)}}}</code></td></tr>`).join("")}</tbody></table><p class="muted">철자를 '필드 목록'과 비교해 고친 뒤 다시 올리세요. 그대로 두면 빈칸으로 출력됩니다.</p>` : "<p>✓ 모든 필드를 인식했습니다.</p>"}
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


function showPreview(pv) {
  const unk = new Set(pv.unknown.map((u) => u.sheet + "!" + u.cell));
  const colName = (i) => { let s = "", n = i + 1; while (n) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
  const d = _modal(`<div><div class="row between"><h3 class="m0">미리보기 · ${esc(pv.template)}</h3><button class="btn" value="x" onclick="this.closest('dialog').close()">닫기</button></div>
    <p class="muted">값 ${pv.stats.values}개, 표 행 ${pv.stats.rows}개. 시트마다 앞부분(최대 60행 × 14열)만 보여 줍니다. 노란 칸은 알 수 없는 필드입니다.</p>
    ${pv.warnings.length ? `<div class="panel warn"><b>확인할 점 ${pv.warnings.length}건</b><ul>${pv.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
    <div class="seg-tabs" role="tablist">${pv.sheets.map((s, i) => `<button role="tab" class="${i ? "" : "on"}" data-sh="${i}">${esc(s.name)}</button>`).join("")}</div>
    ${pv.sheets.map((s, i) => `<div class="xl-sheet" data-shv="${i}" ${i ? "hidden" : ""}><div class="scroll"><table class="xl" data-noexport><thead><tr><th></th>${(s.rows[0] || []).map((_, c) => `<th>${colName(c)}</th>`).join("")}</tr></thead><tbody>
      ${s.rows.map((row, r) => `<tr><th>${r + 1}</th>${row.map((v, c) => `<td class="${unk.has(s.name + "!" + colName(c) + (r + 1)) ? "unk" : ""}">${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      ${s.more_rows || s.more_cols ? `<p class="muted">… 이후 ${s.more_rows}행 / ${s.more_cols}열 더 있음</p>` : ""}</div>`).join("")}</div>`, { wide: true });
  d.classList.add("xwide");
  d.querySelectorAll("[data-sh]").forEach((b) => (b.onclick = () => {
    d.querySelectorAll("[data-sh]").forEach((x) => x.classList.toggle("on", x === b));
    d.querySelectorAll("[data-shv]").forEach((x) => (x.hidden = x.dataset.shv !== b.dataset.sh));
  }));
}

async function templateVersions(tid, preUid) {
  const vs = await api(`/api/reports/templates/${encodeURIComponent(tid)}/versions`);
  const d = _modal(`<div><h3 class="mt0">양식 버전 기록</h3><p class="muted">같은 이름으로 다시 올리면 새 버전이 되고, 이전 버전은 최대 10개까지 보관됩니다.</p>
    <table class="t" data-noexport><thead><tr><th>버전</th><th>올린 사람</th><th>시각</th><th class="num">필드</th><th></th></tr></thead><tbody>
    ${vs.map((v, i) => `<tr><td>${v.current ? "<b>현재</b>" : `v${vs.length - i}`}</td><td>${esc(v.author || "")}</td><td>${(v.at || "").replace("T", " ").slice(0, 16)}</td><td class="num">${v.fields ?? "-"}</td>
      <td>${v.current ? "" : `<button class="btn sm" data-restore="${esc(v.file_id)}" data-need="editor" data-scope="global">이 버전으로 되돌리기</button>`}</td></tr>`).join("")}</tbody></table>
    <div class="row end"><button class="btn" onclick="this.closest('dialog').close()">닫기</button></div></div>`);
  applyRole(d);
  d.querySelectorAll("[data-restore]").forEach((b) => (b.onclick = async () => {
    await api(`/api/reports/templates/${encodeURIComponent(tid)}/restore`, { method: "POST", json: { file_id: b.dataset.restore } });
    d.close(); toast("이전 버전으로 되돌렸습니다"); showReports(preUid);
  }));
}
