"use strict";
// ================================================================ ⑪ 현장 모바일 모드: 이번 주 약속·제약·작업일보, 사진 첨부, 오프라인 임시 저장

const FQ_KEY = "fieldQueue";
function fqLoad() { try { return JSON.parse(store.get(FQ_KEY, "[]")); } catch { return []; } }
function fqSave(q) { store.set(FQ_KEY, JSON.stringify(q)); }

async function fieldSave(path, json) {
  try {
    if (!navigator.onLine) throw new TypeError("offline");
    return await api(path, { method: "POST", json });
  } catch (e) {
    if (e instanceof TypeError || e.status === 0) {  // 네트워크 오류 → 임시 저장
      const q = fqLoad(); q.push({ path, json, at: Date.now() }); fqSave(q);
      toast("오프라인: 휴대폰에 임시 저장했습니다. 연결되면 자동으로 보냅니다.");
      return { queued: true };
    }
    throw e;
  }
}
async function fieldFlush() {
  const q = fqLoad();
  if (!navigator.onLine) return;
  if (!q.length) { if (location.hash.startsWith("#/field/")) route(); return; }
  const left = [];
  for (const it of q) {
    try { await api(it.path, { method: "POST", json: it.json }); } catch (e) { if (e instanceof TypeError || e.status === 0) left.push(it); }
  }
  fqSave(left);
  if (q.length !== left.length) toast(`임시 저장한 ${q.length - left.length}건을 보냈습니다`);
  if (location.hash.startsWith("#/field/")) route();
}
window.addEventListener("online", fieldFlush);   // 다시 연결되면 보내고 화면을 새로 그림(fieldFlush → route)
window.addEventListener("offline", () => {   // 끊기면 화면은 그대로 두고 상태 줄만 바꿈 (목록을 지우지 않음)
  const st = document.querySelector(".fm-status"); if (!st) return;
  st.classList.replace("on", "off");
  const n = st.querySelector(".fm-net"); if (n) n.textContent = "오프라인 — 입력은 휴대폰에 임시 저장됩니다";
  st.querySelector("#fqFlush")?.setAttribute("disabled", "");
});

async function showField(uid) {
  const u = await load(uid); const r = u.result;
  Object.assign(u, await api(`/api/uploads/${uid}/perm`).catch(() => ({})));
  ctx.uid = uid; ctx.result = r; ctx.tab = "lookahead"; ctx.canWrite = u.can_write !== false;
  if (!ctx.canWrite) { view.innerHTML = `<div class="fm"><div class="fcard"><h3 class="mt0">${esc(r.name)}</h3><p>이 프로젝트는 <b>읽기 전용</b>입니다. 현장 입력(약속·제약·사진)은 프로젝트 멤버만 할 수 있습니다.</p>
    <p class="muted">소유자: ${esc((await api(`/api/projects/${encodeURIComponent(r.name)}/members`).catch(() => [])).filter((m) => m.role === "owner").map((m) => m.username).join(", ") || "관리자")}</p><a class="btn" href="#/p/${uid}/lookahead">PC 화면에서 보기</a></div></div>`; return; }
  $("#crumb").textContent = "";
  const mode = sessionStorage.getItem("fieldTab") || "week";
  let la = { rows: [], weeks: [], constraints: [] }, stale = null;
  const LK = `fieldLa:${uid}`;
  try { la = await api(`/api/uploads/${uid}/lookahead?weeks=2`); store.set(LK, JSON.stringify({ at: Date.now(), la })); }
  catch (e) {   // 연결이 끊겨도 마지막으로 받은 작업 목록으로 계속 입력 (입력은 휴대폰에 임시 저장)
    try { const c = JSON.parse(store.get(LK, "null")); if (c?.la) { la = c.la; stale = c.at; } } catch { /* 사본 없음 */ }
    if (!stale && e.status !== 0 && !(e instanceof TypeError)) toast(e.message);
  }
  const thisWeek = la.weeks[0];
  const queued = fqLoad().length;
  const online = navigator.onLine && !stale;
  view.innerHTML = `<div class="fm">
    <div class="fm-status ${online ? "on" : "off"}" role="status"><span class="dot" aria-hidden="true"></span><span class="fm-net">${online ? "온라인" : `오프라인 — 입력은 휴대폰에 임시 저장됩니다${stale ? ` (작업 목록: ${new Date(stale).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 사본)` : ""}`}</span>
      ${queued ? `<span class="fm-q">보내지 않은 기록 <b>${queued}</b>건</span><button class="btn sm" id="fqFlush" ${online ? "" : "disabled"}>지금 보내기</button>` : '<span class="fm-q muted">보낼 기록 없음</span>'}</div>
    <div class="fm-head"><div><h2>${esc(r.name)}</h2>
      <div class="muted">이번 주 ${thisWeek || ""} · Data Date ${r.data_date}</div></div><a class="btn" href="#/p/${uid}/lookahead">PC 화면</a></div>
    <div class="fm-tabs" role="tablist">${[["week", "이번 주 약속"], ["cons", "제약"], ["daily", "작업일보"]].map(([k, l]) => `<button role="tab" aria-selected="${k === mode}" class="${k === mode ? "on" : ""}" data-m="${k}">${l}</button>`).join("")}</div>
    <div id="fmBody"></div>
    <label class="fab-cam" title="사진 찍고 작업 고르기"><span aria-hidden="true">📷</span><span class="sr-only">사진 찍고 작업에 연결</span><input type="file" accept="image/*" capture="environment" id="fabCam" hidden></label></div>`;
  $("#fabCam").onchange = async (e) => {   // 사진 촬영 → 작업 고르기 → 올리기
    const f = e.target.files[0]; if (!f) return;
    const todayIso = new Date().toISOString().slice(0, 10);
    const acts = la.rows.filter((a) => a.weeks.includes(thisWeek)).sort((x, y) => (y.start <= todayIso && y.finish >= todayIso) - (x.start <= todayIso && x.finish >= todayIso) || (x.start < y.start ? -1 : 1));
    const d = _modal(`<form method="dialog"><h3>이 사진을 어느 작업에 붙일까요?</h3><div class="fm-pick">${acts.map((a) => `<button class="fm-pick-b" value="${esc(a.code)}"><b>${esc(a.code)}</b> ${esc(a.name)}</button>`).join("") || '<p class="muted">이번 주 작업이 없습니다</p>'}</div>
      <div class="row end"><button class="btn" value="cancel">취소</button></div></form>`);
    d.addEventListener("close", async () => {
      const code = d.returnValue; if (!code || code === "cancel") return;
      const fd = new FormData(); fd.append("ref", code); fd.append("file", await shrinkImage(f), "photo.jpg");
      try { await api(`/api/uploads/${uid}/photos`, { method: "POST", body: fd }); toast(`${code}에 사진을 올렸습니다`); showField(uid); } catch (err) { toast(err.message); }
    });
  };
  view.querySelectorAll(".fm-tabs button").forEach((b) => (b.onclick = () => { sessionStorage.setItem("fieldTab", b.dataset.m); showField(uid); }));
  $("#fqFlush")?.addEventListener("click", fieldFlush);
  const body = $("#fmBody");
  if (mode === "week") fieldWeek(body, uid, la, thisWeek);
  else if (mode === "cons") fieldCons(body, uid, la);
  else fieldDaily(body, uid, r);
}

async function fieldWeek(body, uid, la, thisWeek) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const isToday = (a) => a.start <= todayIso && a.finish >= todayIso;
  // 오늘 진행 → 주공정 → 시작일 순
  const rows = la.rows.filter((a) => a.weeks.includes(thisWeek)).sort((x, y) => isToday(y) - isToday(x) || (y.longest ? 1 : 0) - (x.longest ? 1 : 0) || (x.start < y.start ? -1 : 1));
  const photos = await api(`/api/uploads/${uid}/photos`).catch(() => []);
  body.innerHTML = rows.length ? rows.map((a) => {
    const c = a.commitments.find((x) => x.week === thisWeek);
    const ph = photos.filter((p) => p.ref === a.code);
    return `<div class="fcard ${a.longest ? "crit" : ""}">
      <div class="row between"><b>${esc(a.code)} ${esc(a.name)}</b><span class="row" style="gap:4px">${isToday(a) ? '<span class="chip ok">오늘 진행</span>' : ""}${a.longest ? '<span class="chip bad">▲ 주공정</span>' : `<span class="chip">여유 ${fmtDays(a.tf)}일</span>`}</span></div>
      <div class="muted">${a.start} ~ ${a.finish}${a.constraints.length ? ` · <span style="color:var(--crit-text)">제약 ${a.constraints.length}건</span>` : ""}</div>
      ${c ? `<label class="big-chk"><input type="checkbox" data-done="${c.id}" ${c.done ? "checked" : ""}> ${c.done ? "완료" : "이번 주 완료하면 체크"} <span class="muted fs13">(${esc(c.company || "")})</span></label>
        ${c.done ? "" : `<select class="s" data-reason="${c.id}" style="width:100%;margin-top:6px"><option value="">못 했다면 사유 선택</option>${REASONS.map((x) => `<option ${c.reason === x ? "selected" : ""}>${x}</option>`).join("")}</select>`}`
        : `<div class="row mt8"><input class="s" placeholder="협력업체" value="${esc(store.get("lastCompany"))}" data-co="${esc(a.code)}" style="flex:1"><button class="btn primary" data-commit="${esc(a.code)}" data-name="${esc(a.name)}">약속 등록</button></div>`}
      <div class="thumbs">${ph.map((p) => `<a href="/api/photos/${p.id}" target="_blank" rel="noopener"><img src="/api/photos/${p.id}" alt="${esc(a.code)} 현장 사진" loading="lazy"></a>`).join("")}</div>
      <label class="btn sm" style="margin-top:8px;display:inline-block">📷 사진 첨부<input type="file" accept="image/*" capture="environment" data-photo="${esc(a.code)}" hidden></label>
    </div>`;
  }).join("") : `<div class="fcard muted">이번 주에 진행할 작업이 없습니다.</div>`;
  const commits = la.rows.flatMap((a) => a.commitments);
  body.querySelectorAll("[data-commit]").forEach((b) => (b.onclick = async () => {
    const co = body.querySelector(`[data-co="${CSS.escape(b.dataset.commit)}"]`).value.trim();
    if (!co) return toast("협력업체를 입력하세요");
    store.set("lastCompany", co);
    await fieldSave(`/api/uploads/${uid}/records/commit`, { week: thisWeek, code: b.dataset.commit, name: b.dataset.name, company: co, done: false });
    showField(uid);
  }));
  body.querySelectorAll("[data-done]").forEach((c) => (c.onchange = async () => {
    const x = commits.find((y) => y.id === c.dataset.done);
    await fieldSave(`/api/uploads/${uid}/records/commit`, { ...x, done: c.checked, reason: c.checked ? "" : x.reason });
    showField(uid);
  }));
  body.querySelectorAll("[data-reason]").forEach((s) => (s.onchange = async () => {
    const x = commits.find((y) => y.id === s.dataset.reason);
    await fieldSave(`/api/uploads/${uid}/records/commit`, { ...x, reason: s.value }); toast("사유를 저장했습니다");
  }));
  body.querySelectorAll("[data-photo]").forEach((inp) => (inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    if (!navigator.onLine) return toast("사진은 연결된 상태에서 올릴 수 있습니다");
    const fd = new FormData(); fd.append("ref", inp.dataset.photo); fd.append("file", await shrinkImage(f), "photo.jpg");
    try { await api(`/api/uploads/${uid}/photos`, { method: "POST", body: fd }); toast("사진을 올렸습니다"); showField(uid); } catch (e) { toast(e.message); }
  }));
}

// 휴대폰 사진을 긴 변 1600px JPEG 로 줄여 업로드 (3MB 제한 대응)
function shrinkImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = img.width * k; c.height = img.height * k;
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => resolve(b || file), "image/jpeg", 0.82);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}

function fieldCons(body, uid, la) {
  const open = la.constraints.filter((c) => c.status !== "해결");
  body.innerHTML = `${open.map((c) => `<div class="fcard"><b>${esc(c.code)} · ${esc(c.type)}</b><div>${esc(c.desc)}</div>
      <div class="muted">담당 ${esc(c.owner || "-")} · 기한 <span style="color:${c.due && c.due < la.data_date ? "var(--crit-text)" : ""}">${c.due || "-"}</span></div>
      <div class="row mt8">${["미해결", "진행", "해결"].map((s) => `<button class="btn ${c.status === s ? "primary" : ""}" data-cid="${c.id}" data-st="${s}">${s}</button>`).join("")}</div></div>`).join("")
    || '<div class="fcard muted">미해결 제약이 없습니다.</div>'}
    <div class="fcard"><h3 class="mt0">제약 등록</h3>
      <select class="s" id="fcCode" style="width:100%">${la.rows.map((a) => `<option value="${esc(a.code)}">${esc(a.code)} ${esc(a.name)}</option>`).join("")}</select>
      <select class="s" id="fcType" style="width:100%;margin-top:6px">${["도면", "자재", "인력", "장비", "허가", "선행작업", "기타"].map((x) => `<option>${x}</option>`).join("")}</select>
      <input class="s" id="fcDesc" placeholder="내용" style="width:100%;margin-top:6px"><input class="s" id="fcDue" type="date" style="width:100%;margin-top:6px">
      <button class="btn primary" id="fcAdd" style="width:100%;margin-top:8px">등록</button></div>`;
  body.querySelectorAll("[data-cid]").forEach((b) => (b.onclick = async () => {
    const x = la.constraints.find((c) => c.id === b.dataset.cid);
    await fieldSave(`/api/uploads/${uid}/records/constraint`, { ...x, status: b.dataset.st }); showField(uid);
  }));
  $("#fcAdd").onclick = async () => {
    if (!$("#fcDesc").value.trim()) return toast("내용을 입력하세요");
    await fieldSave(`/api/uploads/${uid}/records/constraint`, { code: $("#fcCode").value, type: $("#fcType").value, desc: $("#fcDesc").value, due: $("#fcDue").value, status: "미해결" });
    showField(uid);
  };
}

function fieldDaily(body, uid, r) {
  const draft = store.get("dailyDraft:" + uid);
  body.innerHTML = `<div class="fcard"><label>일보 날짜 <input class="s" type="date" id="fdDate" value="${new Date().toISOString().slice(0, 10)}"></label>
    <textarea id="fdText" rows="8" style="width:100%;margin-top:8px;font-size:16px" placeholder="오늘 한 일을 적어 주세요. 예) 기초 철근 작업 착수, 30% 진행">${esc(draft)}</textarea>
    <p class="muted fs12">입력 중인 내용은 휴대폰에 자동 저장됩니다.</p>
    <button class="btn primary" id="fdRun" style="width:100%">진도 추출</button></div><div id="fdOut"></div>`;
  $("#fdText").oninput = (e) => store.set("dailyDraft:" + uid, e.target.value);
  $("#fdRun").onclick = async () => {
    const x = await runLong("작업일보에서 진도를 추출하는 중", "daily", (signal) => api(`/api/uploads/${uid}/daily`, { method: "POST", signal, json: { text: $("#fdText").value, date: $("#fdDate").value } }));
    if (!x) return;
    $("#fdOut").innerHTML = x.items.length ? x.items.map((it, i) => `<div class="fcard"><label class="big-chk"><input type="checkbox" class="fdc" data-i="${i}" ${it.confidence >= 70 ? "checked" : ""}> ${esc(it.code)} ${esc(it.name)}</label>
        <div>${esc(it.event)} · ${esc(it.date || "")}${it.pct !== null && it.pct !== undefined ? ` · ${it.pct}%` : ""}</div><div class="muted fs13">근거: ${esc(it.evidence)}</div></div>`).join("")
      + `<button class="btn primary" id="fdSave" style="width:100%" data-need="editor">선택 항목을 진도 입력안으로 저장</button>`
      : `<div class="fcard muted">액티비티와 연결되는 진도를 찾지 못했습니다.</div>`;
    applyRole($("#fdOut"));
    $("#fdSave")?.addEventListener("click", async () => {
      const ch = [...document.querySelectorAll(".fdc:checked")].map((c) => x.changes[+c.dataset.i]);
      await api(`/api/uploads/${uid}/scenarios`, { method: "POST", json: { name: `작업일보 ${$("#fdDate").value}`, kind: "진도 입력", changes: ch } });
      store.set("dailyDraft:" + uid, ""); toast("진도 입력안을 저장했습니다. 공정 담당자가 검토 후 반영합니다.");
    });
  };
}
