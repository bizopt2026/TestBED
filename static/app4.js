"use strict";
// ================================================================ 6차 화면: 할 일 함, 타임라인, 보고 패키지·확정본, 충돌 처리, 입력 도우미,
// 오류 화면, 오프라인 안내, 휴대폰 현장 모드 제안, 화면 이동 단축키, 관리자 사용 현황

// ---------------------------------------------------------------- ⑰ 오류·빈 화면 통일
function emptyState(title, desc = "", action = "") {
  return `<div class="panel empty-state"><div class="es-ico" aria-hidden="true">○</div><h3>${esc(title)}</h3>${desc ? `<p class="muted">${desc}</p>` : ""}${action}</div>`;
}
function errorPanel(err, inTab = false) {
  const st = err?.status;
  const kind = st === 0 ? ["서버에 연결할 수 없습니다", "인터넷(사내망) 연결이나 서버 상태를 확인한 뒤 다시 시도하세요."]
    : st === 404 ? ["찾을 수 없습니다", "삭제되었거나 주소가 바뀐 데이터입니다. 홈에서 다시 찾아 보세요."]
    : st === 403 ? ["권한이 없습니다", `${esc(err.message)}<br>읽기는 모든 프로젝트에서 할 수 있고, 편집은 프로젝트 멤버만 할 수 있습니다.`]
    : st === 400 ? ["요청을 처리할 수 없습니다", esc(err.message)]
    : ["문제가 생겼습니다", `잠시 후 다시 시도하세요. 계속되면 아래 내용을 관리자에게 알려 주세요.`];
  const detail = `${new Date().toISOString().slice(0, 19)} ${location.hash} ${st ?? ""} ${err?.path || ""} ${err?.message || err}`;
  return `<div class="panel err-state" role="alert"><h3>⚠ ${kind[0]}</h3><p>${kind[1]}</p>
    <div class="row"><button class="btn primary" onclick="${inTab ? "showProject(ctx.uid, ctx.tab, true)" : "route()"}">다시 시도</button><a class="btn" href="#/">홈으로</a>
      ${st && st >= 500 || st === undefined ? `<button class="btn ghost" onclick="copyText(this.dataset.d)" data-d="${esc(detail)}">오류 내용 복사</button>` : ""}</div>
    ${st && st >= 500 || st === undefined ? `<details><summary class="muted">자세히</summary><code style="font-size:12px">${esc(detail)}</code></details>` : ""}</div>`;
}
// 오프라인 안내
function offlineBanner() {
  let b = $("#offline");
  if (navigator.onLine) { b?.remove(); return; }
  if (!b) { b = document.createElement("div"); b.id = "offline"; b.setAttribute("role", "status"); document.body.appendChild(b); }
  b.textContent = "⚠ 네트워크 연결이 끊겼습니다. 다시 연결되면 자동으로 사라집니다.";
}
window.addEventListener("offline", offlineBanner);
window.addEventListener("online", () => { offlineBanner(); toast("다시 연결되었습니다"); });

// ---------------------------------------------------------------- ⑩ 동시 편집 충돌 처리 저장
async function saveRec(path, body, reload) {
  try { await api(path, { method: "POST", json: body }); return true; }
  catch (e) {
    if (e.status !== 409 || !e.detail?.conflict) { toast(e.message); return false; }
    const over = await ui.confirm(`${e.detail.message}.\n내 변경으로 덮어쓸까요? '취소'를 누르면 최신 내용을 다시 불러옵니다.`, { ok: "덮어쓰기", danger: true });
    if (over) { const { base_updated_at, ...rest } = body; await api(path, { method: "POST", json: rest }); toast("덮어썼습니다"); return true; }
    reload?.(); toast("최신 내용을 불러왔습니다"); return false;
  }
}

// ---------------------------------------------------------------- ① 할 일 함: 내 일 · 프로젝트 경고 · 알림
renderInbox = async function (container) { container.innerHTML = ""; };
renderMyTasks = async function (box) {
  const [tasks, items, notes] = await Promise.all([me?.username ? api("/api/my/tasks").catch(() => []) : [], api("/api/inbox").catch(() => []),
    me?.username ? api("/api/notifications").catch(() => ({ items: [] })) : { items: [] }]);
  const mine = new Set(Object.keys(me?.projects || {})), favs = new Set(JSON.parse(store.get("favs", "[]")));
  const key = (x) => x.project + "|" + x.text;
  const dismissed = new Set(JSON.parse(store.get("inboxSeen:" + (me?.username || ""), "[]")));
  const st = JSON.parse(store.get("hubView", '{"tab":"","mine":true}'));
  const today = new Date().toISOString().slice(0, 10);
  const alerts = () => items.filter((x) => !dismissed.has(key(x)) && (!st.mine || !(mine.size || favs.size) || mine.has(x.project) || favs.has(x.project) || me?.role === "admin"));
  const unread = () => notes.items.filter((n) => !n.read);
  if (!st.tab) st.tab = tasks.length ? "mine" : alerts().length ? "alerts" : "notes";
  const draw = () => {
    const tabs = [["mine", "내 일", tasks.length], ["alerts", "프로젝트 경고", alerts().length], ["notes", "알림", unread().length]];
    let body = "";
    if (st.tab === "mine") body = tasks.map((t) => `<div class="inbox-item ${t.due && t.due < today ? "high" : "mid"}"><span class="sev">${t.kind === "멘션" ? "@" : t.kind === "리스크" ? "!" : "▣"}</span>
        <a href="#/p/${t.uid}/${t.tab}${t.kind === "멘션" ? "?c=" + t.id : ""}"><span class="tag">${esc(t.kind)}</span> <b>${esc(t.project)}</b> ${esc(t.text)}
          ${t.due ? `<span class="${t.due < today ? "crit" : "muted"}"> · ${t.due < today ? "기한 지남 " : "기한 "}${t.due}</span>` : ""}</a>
        <button class="btn sm" data-done="${t.id}" title="처리 완료로 표시">${t.kind === "멘션" ? "해결" : t.kind === "리스크" ? "종결" : "해결"}</button></div>`).join("")
        || emptyState("배정된 일이 없습니다", "리스크·제약의 담당자로 지정되거나 코멘트에서 @언급되면 여기에 모입니다.");
    if (st.tab === "alerts") body = `<div class="row" style="justify-content:flex-end;margin-bottom:4px">${mine.size || favs.size ? `<label><input type="checkbox" id="hubMine" ${st.mine ? "checked" : ""}> 내 프로젝트·관심만</label>` : ""}
        ${dismissed.size ? `<button class="btn sm" id="hubReset">숨긴 항목 ${dismissed.size}개 다시 보기</button>` : ""}</div>` +
      (alerts().map((x) => `<div class="inbox-item ${x.level}"><span class="sev">${x.level === "high" ? "✕" : "!"}</span><a href="#/p/${x.uid}/${x.tab}"><b>${esc(x.project)}</b> ${esc(x.text)}</a>
        <button class="btn sm ghost" data-seen="${esc(key(x))}" title="확인함(숨기기)" aria-label="확인함">${icon("check", 14)}</button></div>`).join("") || emptyState("확인할 경고가 없습니다 👍"));
    if (st.tab === "notes") body = (unread().length ? `<div class="row end"><button class="btn sm" id="hubReadAll">모두 읽음</button></div>` : "") +
      (notes.items.slice(0, 20).map((n) => `<div class="inbox-item ${n.read ? "low read" : "mid"}"><span class="sev">${n.read ? "·" : "●"}</span>
        <a href="${esc(n.link || "#/")}" data-nread="${n.id}">${esc(n.text)} <span class="muted">${(n.created_at || "").replace("T", " ").slice(5, 16)}</span></a><span></span></div>`).join("") || emptyState("알림이 없습니다", "받을 알림 종류는 내 메뉴 → 환경 설정에서 고릅니다."));
    const panel = `<div class="hub-head"><h3 style="margin:0">할 일 함</h3><div class="seg-tabs sm" role="tablist" aria-label="할 일 함">${tabs.map(([k, l, n]) => `<button role="tab" aria-selected="${st.tab === k}" class="${st.tab === k ? "on" : ""}" data-ht="${k}">${l}${n ? ` <span class="cnt">${n}</span>` : ""}</button>`).join("")}</div></div>
      <div class="inbox">${body}</div>`;
    if (prefs.start_page === "portfolio") box.innerHTML = `<details class="panel hub"><summary><b>할 일 함</b> <span class="muted">${tabs.map(([, l, n]) => `${l} ${n}`).join(" · ")} (펼치기)</span></summary>${panel}</details>`;
    else box.innerHTML = `<div class="panel hub">${panel}</div>`;
    const save = () => store.set("hubView", JSON.stringify(st));
    box.querySelectorAll("[data-ht]").forEach((b) => (b.onclick = () => { st.tab = b.dataset.ht; save(); draw(); box.querySelector(`[data-ht="${st.tab}"]`)?.focus(); }));
    $("#hubMine")?.addEventListener("change", (e) => { st.mine = e.target.checked; save(); draw(); });
    $("#hubReset")?.addEventListener("click", () => { dismissed.clear(); store.set("inboxSeen:" + (me?.username || ""), "[]"); draw(); });
    box.querySelectorAll("[data-seen]").forEach((b) => (b.onclick = () => { dismissed.add(b.dataset.seen); store.set("inboxSeen:" + (me?.username || ""), JSON.stringify([...dismissed])); draw(); }));
    $("#hubReadAll")?.addEventListener("click", async () => { await api("/api/notifications/read", { method: "POST", json: {} }); notes.items.forEach((n) => (n.read = 1)); draw(); pollNotifications?.(); });
    box.querySelectorAll("[data-nread]").forEach((a) => a.addEventListener("click", () => api("/api/notifications/read", { method: "POST", json: { ids: [a.dataset.nread] } }).catch(() => {})));
    box.querySelectorAll("[data-done]").forEach((b) => (b.onclick = async () => {
      const t = tasks.find((x) => x.id === b.dataset.done);
      try {
        if (t.kind === "멘션") await api(`/api/uploads/${t.uid}/comments/${t.id}/resolve`, { method: "POST", json: { resolved: true } });
        else if (t.kind === "리스크") await api(`/api/uploads/${t.uid}/risks`, { method: "POST", json: { ...t.record, status: "closed" } });
        else await api(`/api/uploads/${t.uid}/records/constraint`, { method: "POST", json: { ...t.record, status: "해결" } });
        tasks.splice(tasks.indexOf(t), 1); toast("처리했습니다"); draw();
      } catch (e) { toast(e.message); }
    }));
  };
  draw();
};

// ---------------------------------------------------------------- ④ 프로젝트 타임라인 (+⑫ 확정본)
async function tabTimeline(el, r, uid) {
  el.innerHTML = skeleton("tab");
  const tl = await api(`/api/projects/${encodeURIComponent(r.name)}/timeline`);
  if (!tl.length) { el.innerHTML = emptyState("이력이 없습니다"); return; }
  const card = (t) => `<li class="tl-item ${t.id === uid ? "cur" : ""}"><div class="tl-dot ${t.slip > 0 ? "bad" : t.slip < 0 ? "ok" : ""}" aria-hidden="true"></div>
    <div class="panel tl-card"><div class="row" style="justify-content:space-between"><h3 style="margin:0"><a href="#/p/${t.id}/overview">DD ${t.data_date}</a> ${t.id === uid ? '<span class="chip">보는 중</span>' : ""}</h3>
      <span class="muted" style="font-size:12px">${esc(t.uploader || "")} · ${(t.created_at || "").replace("T", " ").slice(0, 16)} · ${esc(t.note || "")}</span></div>
      <div class="chips"><span class="chip">예상 준공 ${t.finish}</span>${t.slip === null ? "" : `<span class="chip ${t.slip > 0 ? "bad" : "ok"}">${t.slip > 0 ? "▼ +" + t.slip + "일 지연" : t.slip < 0 ? "▲ " + -t.slip + "일 단축" : "= 변화 없음"}</span>`}
        <span class="chip">공정률 ${t.progress}%</span><span class="chip ${t.health >= 75 ? "ok" : t.health >= 60 ? "warn" : "bad"}">건전성 ${t.health}</span>${t.neg ? `<span class="chip bad">음수 여유 ${t.neg}</span>` : ""}</div>
      <div class="tl-grid">
        <div><b>월간 점검</b> ${t.review.completed_by ? `<span class="chip ok">✓ ${esc(t.review.completed_by)} ${(t.review.completed_at || "").slice(5, 16).replace("T", " ")}</span>` : `<span class="muted">${t.review.steps}/6 단계</span> <a href="#/wizard/${t.id}">점검하기</a>`}
          ${t.review.notes.map((n) => `<div class="mini">“${esc(n.note)}” <span class="muted">— ${esc(n.by)}</span></div>`).join("")}</div>
        <div><b>코멘트</b> ${t.comments.map((c) => `<div class="mini ${c.resolved ? "muted" : ""}">${esc(c.author)}: ${esc(c.text)}</div>`).join("") || '<span class="muted">없음</span>'}</div>
        <div><b>출력물</b> ${t.outputs.map((o) => `<span class="tag" title="${esc(o.author)} ${o.created_at.replace("T", " ").slice(5, 16)}">${esc(o.type)}</span>`).join(" ") || '<span class="muted">없음</span>'}</div>
        <div><b>확정본</b> ${t.final ? `<span class="chip ok">🔒 ${esc(t.final.by)} 확정</span> <button class="btn sm" data-fdl="${t.id}">내려받기</button>`
          : t.review.completed_by && ctx.canWrite ? `<button class="btn sm primary" data-fin="${t.id}">보고서 확정하기</button>` : `<span class="muted">${t.review.completed_by ? "없음" : "점검 완료 후 확정 가능"}</span>`}</div>
      </div></div></li>`;
  el.innerHTML = `<div class="panel" style="padding:12px 16px"><b>${esc(r.name)}</b> <span class="muted">업데이트 ${tl.length}회의 준공 변화·점검·코멘트·출력물을 한눈에 봅니다. 최신이 위입니다.</span></div><ol class="timeline">${tl.map(card).join("")}</ol>`;
  el.querySelectorAll("[data-fdl]").forEach((b) => (b.onclick = () => download(`/api/uploads/${b.dataset.fdl}/final/download`, "final.zip")));
  el.querySelectorAll("[data-fin]").forEach((b) => (b.onclick = () => finalize(b.dataset.fin, () => tabTimeline(el, r, uid))));
}
async function finalize(uid, after) {
  if (!(await ui.confirm("이 업데이트의 보고 패키지(Word·엑셀·A3·CSV)를 확정본으로 고정할까요? 확정 후에는 바꿀 수 없고, 같은 파일을 언제든 다시 받을 수 있습니다.", { ok: "확정" }))) return;
  try { await api(`/api/uploads/${uid}/final`, { method: "POST", json: { tpl: store.get("rptTpl") || "builtin:monthly" } }); toast("확정했습니다 🔒 멤버에게 알렸습니다"); after?.(); }
  catch (e) { toast(e.message); }
}

// ---------------------------------------------------------------- ⑪⑫ 보고서 센터: 월간 패키지 · 확정본
const _showReports1 = showReports;
showReports = async function (preUid) {
  await _showReports1(preUid);
  hit("reports");
  const cards = $(".out-cards"); if (!cards) return;
  cards.insertAdjacentHTML("afterbegin", `<div class="out-card pkg" role="listitem"><b>📦 월간 보고 패키지</b><span class="muted">Word + 엑셀 양식 + A3 공정표 + CSV를 zip 하나로</span>
    <div class="row"><button class="btn sm primary" id="ocPkg">패키지 내려받기</button></div><div id="ocFinal" class="muted" style="font-size:12px"></div></div>`);
  const cur = () => $("#rpUp")?.value;
  const tpl = () => document.querySelector("input[name=tpl]:checked")?.value || "builtin:monthly";
  $("#ocPkg").onclick = () => withBusy($("#ocPkg"), () => download(`/api/uploads/${cur()}/package?tpl=${encodeURIComponent(tpl())}${$("#rpBase")?.value ? "&base=" + $("#rpBase").value : ""}`, "package.zip"));
  const showFinal = async () => {
    const id = cur(); if (!id) return;
    const [f, so] = await Promise.all([api(`/api/uploads/${id}/final`).catch(() => null), api(`/api/uploads/${id}/situation`).then((s) => s.review).catch(() => ({}))]);
    const box = $("#ocFinal"); if (!box) return;
    box.innerHTML = f ? `🔒 확정본: ${esc(f.by)} · ${(f.updated_at || "").replace("T", " ").slice(5, 16)} <button class="btn sm" id="ocFinalDl">확정본 받기</button>`
      : so?.completed_by ? `월간 점검 완료(${esc(so.completed_by)}) · <button class="btn sm" id="ocFinalGo" data-need="editor">이 내용으로 확정하기</button>` : "확정본: 월간 점검을 마치면 확정할 수 있습니다";
    $("#ocFinalDl")?.addEventListener("click", () => download(`/api/uploads/${id}/final/download`, "final.zip"));
    $("#ocFinalGo")?.addEventListener("click", () => finalize(id, showFinal));
    applyRole(box);
  };
  $("#rpUp")?.addEventListener("change", showFinal);
  showFinal();
};

// ---------------------------------------------------------------- ⑨ 입력 도우미: 작업 ID 자동완성 · 알 수 없는 ID 즉시 표시
function codeSuggest(input) {
  if (input.dataset.sug) return; input.dataset.sug = "1";
  input.setAttribute("autocomplete", "off");
  const multi = input.name === "codes";
  const box = document.createElement("div"); box.className = "code-sug"; box.setAttribute("role", "listbox"); box.setAttribute("aria-label", "작업 ID 추천"); box.hidden = true;
  const msg = document.createElement("div"); msg.className = "field-msg"; msg.setAttribute("aria-live", "polite");
  input.after(box, msg);
  const acts = () => ctx.result?.activities || [];
  const token = () => multi ? input.value.split(/[,\s]+/).pop() : input.value;
  input.addEventListener("input", () => {
    const q = token().trim().toLowerCase();
    if (!q) { box.hidden = true; return; }
    const xs = acts().filter((a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)).slice(0, 8);
    box.innerHTML = xs.map((a) => `<button type="button" role="option" data-c="${esc(a.code)}"><b>${esc(a.code)}</b> ${esc(a.name)}</button>`).join("");
    box.hidden = !xs.length;
    box.querySelectorAll("[data-c]").forEach((b) => (b.onmousedown = (e) => {
      e.preventDefault();
      input.value = multi ? input.value.replace(/[^,\s]*$/, "") + b.dataset.c + ", " : b.dataset.c;
      box.hidden = true; input.focus(); input.dispatchEvent(new Event("change"));
    }));
  });
  input.addEventListener("keydown", (e) => { if (e.key === "ArrowDown" && !box.hidden) { e.preventDefault(); box.querySelector("button")?.focus(); } if (e.key === "Escape") box.hidden = true; });
  box.addEventListener("keydown", (e) => {
    const bs = [...box.querySelectorAll("button")], i = bs.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); bs[Math.min(bs.length - 1, i + 1)]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); i <= 0 ? input.focus() : bs[i - 1].focus(); }
    if (e.key === "Enter") { e.preventDefault(); document.activeElement.onmousedown?.(e); }
  });
  input.addEventListener("blur", () => setTimeout(() => {
    box.hidden = true;
    if (!acts().length) return;
    const valid = new Set(acts().map((a) => a.code));
    const bad = (multi ? input.value.split(/[,\s]+/) : [input.value]).map((x) => x.trim()).filter((x) => x && !valid.has(x));
    msg.textContent = bad.length ? `없는 작업 ID: ${bad.join(", ")}` : "";
    input.setAttribute("aria-invalid", String(!!bad.length));
  }, 150));
}
document.addEventListener("focusin", (e) => {
  const t = e.target;
  if (t.matches?.('input[name="code"], input[name="codes"]') && !t.readOnly) codeSuggest(t);
});

// ---------------------------------------------------------------- ⑮ 휴대폰: 현장 모드 제안
function mobileFieldHint(uid) {
  const box = $("#mobileHint"); if (!box || !matchMedia("(max-width: 760px)").matches || sessionStorage.getItem("fieldHint")) return;
  box.innerHTML = `<div class="panel hint-bar"><span>📱 휴대폰에서는 <b>현장 모드</b>가 더 편합니다 (사진·진도·제약 입력).</span><span class="row"><a class="btn sm primary" href="#/field/${uid}">현장 모드</a><button class="btn sm ghost" id="fhNo" aria-label="닫기">✕</button></span></div>`;
  $("#fhNo").onclick = () => { sessionStorage.setItem("fieldHint", "1"); box.innerHTML = ""; };
}

// ---------------------------------------------------------------- ⑱ 화면 이동 단축키 (g 다음 글자)
const G_KEYS = { o: "overview", t: "timeline", g: "gantt", c: "critical", q: "health", a: "analysis", r: "risk", m: "recovery", l: "lookahead", s: "settings" };
let gPending = 0;
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.("input,textarea,select,[contenteditable]") || document.querySelector("dialog[open]")) return;
  const k = e.key.toLowerCase();
  if (gPending && Date.now() - gPending < 1200) {
    gPending = 0;
    if (k === "h") { location.hash = "#/"; return; }
    if (k === "p") { location.hash = ctx.uid ? `#/reports/${ctx.uid}` : "#/reports"; return; }
    if (k === "w" && ctx.uid) { location.hash = `#/wizard/${ctx.uid}`; return; }
    if (G_KEYS[k] && ctx.uid) { e.preventDefault(); location.hash = `#/p/${ctx.uid}/${G_KEYS[k]}`; }
    return;
  }
  if (k === "g") { gPending = Date.now(); }
});
const _showShortcuts0 = showShortcuts;
showShortcuts = function () {
  _showShortcuts0();
  const t = document.querySelector("dialog[open] table tbody"); if (!t) return;
  t.insertAdjacentHTML("beforeend", `<tr><td><kbd>Ctrl</kbd>+<kbd>K</kbd></td><td>프로젝트·화면·작업 검색</td></tr>
    <tr><td colspan="2"><b>화면 이동</b> — <kbd>g</kbd>를 누른 뒤 글자</td></tr>
    ${[["h", "홈"], ["o", "상황판"], ["t", "타임라인"], ["g", "공정표"], ["c", "주공정"], ["q", "건전성(품질)"], ["a", "업데이트 분석"], ["r", "리스크"], ["m", "만회안"], ["l", "룩어헤드"], ["w", "월간 점검"], ["p", "보고서 센터"], ["s", "설정"]]
      .map(([k, l]) => `<tr><td><kbd>g</kbd> <kbd>${k}</kbd></td><td>${l}</td></tr>`).join("")}`);
};

// ---------------------------------------------------------------- ⑲ 관리자: 사용 현황(집계)
const _showAdmin0 = showAdmin;
showAdmin = async function () {
  await _showAdmin0();
  const u = await api("/api/admin/usage").catch(() => null); if (!u) return;
  const maxV = Math.max(1, ...u.screens.map((x) => x.views));
  const stepNames = { import: "가져오기", changes: "변경·압축", health: "건전성", delay: "지연 원인", baseline: "계획 대비", report: "리포트" };
  const lessonTitle = Object.fromEntries((typeof ALL_LESSONS !== "undefined" ? ALL_LESSONS : []).map((l) => [l.id, l.title]));
  const label = (k) => TAB_LABEL[k] || { home: "홈", reports: "보고서 센터", wizard: "월간 점검", settings: "설정" }[k] || k;
  const p = document.createElement("div"); p.className = "panel"; p.id = "adminUsage";
  p.innerHTML = `<h3 style="margin-top:0">사용 현황 <span class="muted" style="font-size:13px">최근 90일 · 개인별이 아닌 화면별 집계</span></h3>
    <div class="grid2"><div><h4>화면별 사용</h4>${u.screens.map((x) => `<div class="hbar"><span>${esc(label(x.screen))}</span><div><i style="width:${(100 * x.views) / maxV}%"></i></div><b>${x.views}회 · ${x.users}명</b></div>`).join("") || '<p class="muted">아직 기록이 없습니다.</p>'}
      <p class="muted" style="font-size:12px">거의 안 쓰는 화면은 '더보기'로 접혀 있습니다. 많이 쓰는 화면은 사용자별로 자동으로 탭에 나옵니다.</p></div>
    <div><h4>월간 점검 진행 <span class="muted">(시작 ${u.reviews_started} · 완료 ${u.reviews_completed})</span></h4>
      ${Object.entries(stepNames).map(([k, l]) => `<div class="hbar"><span>${l}</span><div><i style="width:${(100 * (u.review_steps[k] || 0)) / Math.max(1, u.reviews_started)}%"></i></div><b>${u.review_steps[k] || 0}</b></div>`).join("")}
      <p class="muted" style="font-size:12px">막대가 갑자기 짧아지는 단계에서 점검을 멈추는 경우가 많다는 뜻입니다.</p>
      <h4>학습 강의 완료 <span class="muted">(학습자 ${u.learners})</span></h4>
      ${Object.entries(u.lessons).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `<div class="hbar"><span>${esc(lessonTitle[k] || k)}</span><div><i style="width:${(100 * n) / Math.max(1, u.learners)}%"></i></div><b>${n}</b></div>`).join("") || '<p class="muted">없음</p>'}</div></div>`;
  view.querySelector("h2")?.after(p);
};

// ---------------------------------------------------------------- 화면 사용 기록 (홈·월간 점검)
const _showList1 = showList;
showList = async function () { await _showList1(); hit("home"); };
const _showWizard1 = showWizard;
showWizard = async function (uid) { await _showWizard1(uid); hit("wizard"); };
