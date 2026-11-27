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
    if (e instanceof TypeError) {  // 네트워크 오류 → 임시 저장
      const q = fqLoad(); q.push({ path, json, at: Date.now() }); fqSave(q);
      toast("오프라인: 휴대폰에 임시 저장했습니다. 연결되면 자동으로 보냅니다.");
      return { queued: true };
    }
    throw e;
  }
}
async function fieldFlush() {
  const q = fqLoad(); if (!q.length || !navigator.onLine) return;
  const left = [];
  for (const it of q) {
    try { await api(it.path, { method: "POST", json: it.json }); } catch (e) { if (e instanceof TypeError) left.push(it); }
  }
  fqSave(left);
  if (q.length !== left.length) toast(`임시 저장한 ${q.length - left.length}건을 보냈습니다`);
  if (location.hash.startsWith("#/field/")) route();
}
window.addEventListener("online", fieldFlush);

async function showField(uid) {
  const u = await load(uid); const r = u.result;
  Object.assign(u, await api(`/api/uploads/${uid}/perm`).catch(() => ({})));
  ctx.uid = uid; ctx.result = r; ctx.tab = "lookahead"; ctx.canWrite = u.can_write !== false;
  if (!ctx.canWrite) { view.innerHTML = `<div class="fm"><div class="fcard"><h3 style="margin-top:0">${esc(r.name)}</h3><p>이 프로젝트는 <b>읽기 전용</b>입니다. 현장 입력(약속·제약·사진)은 프로젝트 멤버만 할 수 있습니다.</p>
    <p class="muted">소유자: ${esc((await api(`/api/projects/${encodeURIComponent(r.name)}/members`).catch(() => [])).filter((m) => m.role === "owner").map((m) => m.username).join(", ") || "관리자")}</p><a class="btn" href="#/p/${uid}/lookahead">PC 화면에서 보기</a></div></div>`; return; }
  $("#crumb").textContent = "";
  const mode = sessionStorage.getItem("fieldTab") || "week";
  let la = { rows: [], weeks: [], constraints: [] };
  try { la = await api(`/api/uploads/${uid}/lookahead?weeks=2`); } catch (e) { toast(e.message); }
  const thisWeek = la.weeks[0];
  const queued = fqLoad().length;
  view.innerHTML = `<div class="fm">
    <div class="row" style="justify-content:space-between"><div><h2 style="margin:0">${esc(r.name)}</h2>
      <div class="muted">이번 주 ${thisWeek || ""} · Data Date ${r.data_date}</div></div><a class="btn" href="#/p/${uid}/lookahead">PC 화면</a></div>
    ${queued ? `<div class="offline">임시 저장 ${queued}건이 전송 대기 중입니다. <button class="btn sm" id="fqFlush">지금 보내기</button></div>` : ""}
    <div class="fm-tabs" role="tablist">${[["week", "이번 주 약속"], ["cons", "제약"], ["daily", "작업일보"]].map(([k, l]) => `<button role="tab" aria-selected="${k === mode}" class="${k === mode ? "on" : ""}" data-m="${k}">${l}</button>`).join("")}</div>
    <div id="fmBody"></div></div>`;
  view.querySelectorAll(".fm-tabs button").forEach((b) => (b.onclick = () => { sessionStorage.setItem("fieldTab", b.dataset.m); showField(uid); }));
  $("#fqFlush")?.addEventListener("click", fieldFlush);
  const body = $("#fmBody");
  if (mode === "week") fieldWeek(body, uid, la, thisWeek);
  else if (mode === "cons") fieldCons(body, uid, la);
  else fieldDaily(body, uid, r);
}

async function fieldWeek(body, uid, la, thisWeek) {
  const rows = la.rows.filter((a) => a.weeks.includes(thisWeek));
  const photos = await api(`/api/uploads/${uid}/photos`).catch(() => []);
  body.innerHTML = rows.length ? rows.map((a) => {
    const c = a.commitments.find((x) => x.week === thisWeek);
    const ph = photos.filter((p) => p.ref === a.code);
    return `<div class="fcard ${a.longest ? "crit" : ""}">
      <div class="row" style="justify-content:space-between"><b>${esc(a.code)} ${esc(a.name)}</b>${a.longest ? '<span class="chip bad">▲ 주공정</span>' : `<span class="chip">여유 ${fmtDays(a.tf)}일</span>`}</div>
      <div class="muted">${a.start} ~ ${a.finish}${a.constraints.length ? ` · <span style="color:var(--crit-text)">제약 ${a.constraints.length}건</span>` : ""}</div>
      ${c ? `<label class="big-chk"><input type="checkbox" data-done="${c.id}" ${c.done ? "checked" : ""}> ${c.done ? "완료" : "이번 주 완료하면 체크"} <span class="muted" style="font-size:13px">(${esc(c.company || "")})</span></label>
        ${c.done ? "" : `<select class="s" data-reason="${c.id}" style="width:100%;margin-top:6px"><option value="">못 했다면 사유 선택</option>${REASONS.map((x) => `<option ${c.reason === x ? "selected" : ""}>${x}</option>`).join("")}</select>`}`
        : `<div class="row" style="margin-top:8px"><input class="s" placeholder="협력업체" value="${esc(store.get("lastCompany"))}" data-co="${esc(a.code)}" style="flex:1"><button class="btn primary" data-commit="${esc(a.code)}" data-name="${esc(a.name)}">약속 등록</button></div>`}
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
      <div class="row" style="margin-top:8px">${["미해결", "진행", "해결"].map((s) => `<button class="btn ${c.status === s ? "primary" : ""}" data-cid="${c.id}" data-st="${s}">${s}</button>`).join("")}</div></div>`).join("")
    || '<div class="fcard muted">미해결 제약이 없습니다.</div>'}
    <div class="fcard"><h3 style="margin-top:0">제약 등록</h3>
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
    <p class="muted" style="font-size:12px">입력 중인 내용은 휴대폰에 자동 저장됩니다.</p>
    <button class="btn primary" id="fdRun" style="width:100%">진도 추출</button></div><div id="fdOut"></div>`;
  $("#fdText").oninput = (e) => store.set("dailyDraft:" + uid, e.target.value);
  $("#fdRun").onclick = async () => {
    const x = await runLong("작업일보에서 진도를 추출하는 중", "daily", (signal) => api(`/api/uploads/${uid}/daily`, { method: "POST", signal, json: { text: $("#fdText").value, date: $("#fdDate").value } }));
    if (!x) return;
    $("#fdOut").innerHTML = x.items.length ? x.items.map((it, i) => `<div class="fcard"><label class="big-chk"><input type="checkbox" class="fdc" data-i="${i}" ${it.confidence >= 70 ? "checked" : ""}> ${esc(it.code)} ${esc(it.name)}</label>
        <div>${esc(it.event)} · ${esc(it.date || "")}${it.pct !== null && it.pct !== undefined ? ` · ${it.pct}%` : ""}</div><div class="muted" style="font-size:13px">근거: ${esc(it.evidence)}</div></div>`).join("")
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
