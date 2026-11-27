"use strict";
// ================================================================ PMS P2: 대시보드 연결·게시·편집 소유권·구독·공유 코드 (PMS 현장), 게시 현황·기기 관리 (PMS 대시보드)

let hubStatus = null;
async function getHubStatus(force = false) {
  if (!hubStatus || force) hubStatus = await api("/api/hub/status").catch(() => ({ connected: false }));
  return hubStatus;
}
const ago = (iso) => { if (!iso) return ""; const d = (Date.now() - new Date(iso).getTime()) / 86400000; return d < 1 ? "오늘" : d < 2 ? "어제" : `${Math.floor(d)}일 전`; };

// ---------------------------------------------------------------- 내 설정: PMS 대시보드 연결 (PMS 현장)
const _showMe12 = showMe;
showMe = async function () {
  await _showMe12();
  await pmsReady;
  if (isDashboard()) return;
  const st = await getHubStatus(true);
  const sec = document.createElement("section"); sec.className = "panel me-sec"; sec.id = "me-hub"; sec.setAttribute("aria-labelledby", "me-hub-h");
  sec.innerHTML = `<h3 id="me-hub-h">${icon("link", 18)} PMS 대시보드 연결</h3>
    ${st.connected ? `<p><span class="chip ok">연결됨</span> ${esc(st.url)} · 대시보드 계정 <b>${esc(st.hub_user || "")}</b>${st.error ? ` <span class="warn-text">(${esc(st.error)})</span>` : ""}</p>
      <p class="muted fs13">게시·구독·공유 코드와 AI(서버 실행)를 쓸 수 있습니다.</p><div class="row"><button class="btn" id="hubSync">지금 동기화</button><button class="btn danger" id="hubOff">연결 끊기</button></div>`
    : `<p class="muted fs13">본사 PMS 대시보드 주소와 <b>대시보드 계정</b>으로 이 PC를 한 번 연결합니다. 비밀번호는 저장하지 않고, 이 PC 전용 연결 토큰만 보관합니다.</p>
      <form id="fHub" class="me-form"><label>대시보드 주소<input class="s" name="url" required placeholder="http://pms-server:8100" value="${esc(st.url || "")}"></label>
        <label>대시보드 아이디<input class="s" name="username" required autocomplete="username"></label>
        <label>비밀번호<input class="s" type="password" name="password" required autocomplete="current-password"></label>
        <button class="btn primary">연결</button></form><p class="err" id="hubErr" role="alert"></p>`}`;
  ($("#me-noti") || $("#me-acc"))?.after(sec);
  view.querySelector(".me-nav")?.insertAdjacentHTML("beforeend", '<a href="#/me" data-jump="me-hub">대시보드 연결</a>');
  view.querySelector('[data-jump="me-hub"]').onclick = (e) => { e.preventDefault(); sec.scrollIntoView({ behavior: "smooth" }); };
  $("#fHub")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try { const r = await api("/api/hub/connect", { method: "POST", json: Object.fromEntries(new FormData(e.target)) }); toast(`${r.hub_name || "PMS 대시보드"}에 연결했습니다`); hubStatus = null; showMe(); }
    catch (err) { $("#hubErr").textContent = err.message; }
  });
  $("#hubOff")?.addEventListener("click", async () => { await api("/api/hub/disconnect", { method: "POST" }); hubStatus = null; toast("연결을 끊었습니다"); showMe(); });
  $("#hubSync")?.addEventListener("click", () => hubSync(true));
};

// ---------------------------------------------------------------- 구독 동기화 (홈을 열 때·10분마다)
async function hubSync(verbose = false) {
  const st = await getHubStatus(); if (!st.connected || isDashboard()) return;
  try {
    const r = await api("/api/hub/sync", { method: "POST" });
    if (r.updated.length) { uploadsCache = null; toast(`구독한 프로젝트 새 판 ${r.updated.length}건을 받았습니다`); if (location.hash === "#/" || !location.hash) showList(); }
    else if (verbose) toast(`구독 ${r.checked}건 모두 최신입니다`);
  } catch (e) { if (verbose) toast(e.message); }
}
setInterval(() => hubSync(false), 10 * 60 * 1000);

// ---------------------------------------------------------------- 프로젝트: 게시 · 공유 코드 · 상태 표시
async function publishDialog(uid, take = false) {
  const st = await getHubStatus();
  if (!st.connected) { toast("먼저 내 설정에서 PMS 대시보드에 연결하세요"); location.hash = "#/me"; return; }
  const v = take ? { note: publishDialog._note || "" } : await ui.form("PMS 대시보드에 게시", [{ name: "note", label: "게시 메모 (선택)", type: "textarea", rows: 3, placeholder: "예: 4월 월간 업데이트, 철골 공기 재검토 반영" }],
    { submit: "게시", intro: "지금 보고 있는 업데이트를 새 판으로 올립니다. 게시된 판은 바뀌지 않고, 구독한 사람에게 자동으로 전달됩니다. 현장 사진도 함께 올라갑니다." });
  if (!v) return;
  publishDialog._note = v.note;
  try {
    const r = await api(`/api/uploads/${uid}/publish`, { method: "POST", json: { note: v.note, take } });
    toast(`게시했습니다: v${r.version}`); showProject(uid, ctx.tab, true);
  } catch (e) {
    if (e.status === 409 && e.detail?.lock) {
      if (await ui.confirm(`${e.message}.\n이 PC로 편집 소유권을 가져와 게시할까요? (다른 PC는 그 뒤로 게시할 수 없습니다)`, { ok: "가져와서 게시" })) publishDialog(uid, true);
    } else toast(e.message);
  }
}
async function shareCodeDialog(uid) {
  const v = await ui.form("공유 코드 만들기", [
    { name: "days", label: "유효 기간(일, 1~30)", type: "number", value: 7, required: true },
    { name: "max_uses", label: "사용 횟수 제한 (비우면 제한 없음)", type: "number" },
    { name: "target", label: "받는 사람 대시보드 아이디 (비우면 누구나)", placeholder: "예: kim" }], { submit: "만들기", intro: "최신 게시판을 가리키는 짧은 코드를 만듭니다. 받는 사람은 홈 '가져오기 → 공유 코드'에 입력합니다." });
  if (!v) return;
  try {
    const r = await api(`/api/uploads/${uid}/share-code`, { method: "POST", json: { days: +v.days, max_uses: v.max_uses ? +v.max_uses : null, target: v.target || null } });
    await navigator.clipboard?.writeText(r.code).catch(() => {});
    ui.notice("공유 코드", `<p class="code-big">${esc(r.code)}</p><p class="muted">클립보드에 복사했습니다. ${esc(r.expires_at.replace("T", " ").slice(0, 16))}까지${r.max_uses ? ` · ${r.max_uses}회` : ""}${r.target ? ` · ${esc(r.target)} 전용` : ""} 사용할 수 있습니다.</p>`);
  } catch (e) { toast(e.message); }
}
const _showProject12 = showProject;
showProject = async function (uid, tab, ...rest) {
  const r = await _showProject12(uid, tab, ...rest);
  await pmsReady;
  if (isDashboard()) return r;
  const wm = $("#workMenu");
  if (wm && !wm.querySelector("[data-w='pub']")) {
    wm.querySelector("[data-w='pms']")?.insertAdjacentHTML("beforebegin", `<button role="menuitem" data-w="pub" data-need="editor">${icon("arrowup")}PMS 대시보드에 게시</button>
      <button role="menuitem" data-w="code" data-need="editor">${icon("key")}공유 코드 만들기</button>`);
    wm.querySelector("[data-w='pub']").onclick = () => publishDialog(ctx.uid);
    wm.querySelector("[data-w='code']").onclick = () => shareCodeDialog(ctx.uid);
    applyRole(wm);
  }
  const st = await getHubStatus();
  if (st.connected && $("#phead") && !$("#hubChip")) {
    const h = await api(`/api/uploads/${uid}/hub`).catch(() => null);
    if (h && !h.is_ref && $("#phead") && !$("#hubChip")) {
      const p = h.published, lock = h.lock;
      $("#upSel")?.insertAdjacentHTML("afterend", p ? `<span class="chip" id="hubChip" title="PMS 대시보드 게시 v${p.version} · ${esc(p.at || "")}${lock ? ` · 편집 소유권: ${esc(lock.user)}` : ""}">${icon("arrowup", 12)} 게시 v${p.version} · ${ago(p.at)}</span>`
        : `<button class="chip warn as-btn" id="hubChip" title="아직 PMS 대시보드에 게시하지 않았습니다">${icon("arrowup", 12)} 미게시</button>`);
      if (!p) $("#hubChip").onclick = () => publishDialog(uid);
    }
  }
  return r;
};

// ---------------------------------------------------------------- 가져오기 대화창: 공유 코드 · 대시보드에서 찾기
const _importDialog12 = importDialog;
importDialog = async function () {
  _importDialog12();
  const st = await getHubStatus();
  const f = $("#fImp"); if (!f) return;
  f.querySelector(".err").insertAdjacentHTML("beforebegin", `<div class="imp-hub ${st.connected ? "" : "off"}"><label>공유 코드<input class="s" id="impCode" placeholder="PMS-XXXX-XXXX" ${st.connected ? "" : "disabled"}></label>
    <button type="button" class="btn" id="impCat" ${st.connected ? "" : "disabled"}>${icon("search", 15)} 대시보드에서 찾아 구독</button>
    ${st.connected ? "" : '<span class="muted fs12">공유 코드·구독은 내 설정에서 PMS 대시보드에 연결한 뒤 쓸 수 있습니다</span>'}</div>`);
  const sub = f.onsubmit;
  f.onsubmit = async (e) => {
    const code = $("#impCode")?.value.trim();
    if (e.submitter?.value === "ok" && code) {
      e.preventDefault();
      try { const r = await api("/api/hub/redeem", { method: "POST", json: { code } }); f.closest("dialog").close(); afterImport(r); }
      catch (err) { $("#impErr").textContent = err.message; }
      return;
    }
    return sub(e);
  };
  $("#impCat")?.addEventListener("click", () => { f.closest("dialog").close(); catalogDialog(); });
};
async function catalogDialog() {
  const d = _modal(`<form method="dialog" style="min-width:min(720px,94vw)"><h3>PMS 대시보드 프로젝트</h3>
    <input class="s w100" id="catQ" type="search" placeholder="프로젝트 이름 검색" aria-label="프로젝트 검색"><div id="catList" class="mt12"></div>
    <div class="row end"><button class="btn" value="cancel">닫기</button></div></form>`);
  const draw = async () => {
    try {
      const xs = await api(`/api/hub/catalog?q=${encodeURIComponent($("#catQ").value)}`);
      $("#catList").innerHTML = xs.length ? `<table class="t" data-noexport><thead><tr><th>프로젝트</th><th>판</th><th>Data Date</th><th>예상 준공</th><th>게시</th><th></th></tr></thead><tbody>
        ${xs.map((x) => `<tr><td><b>${esc(x.name)}</b>${x.mine ? ' <span class="chip">내 프로젝트</span>' : ""}<div class="muted fs12">${esc(x.note || "")}</div></td><td>v${x.version}</td><td>${x.data_date}</td><td>${x.finish}</td>
          <td class="fs12">${esc(x.publisher)} · ${ago(x.published_at)}</td><td>${x.mine ? "" : x.subscribed ? '<span class="chip ok">구독 중</span>' : `<button type="button" class="btn sm primary" data-sub="${x.pid}">구독</button>`}</td></tr>`).join("")}</tbody></table>`
        : emptyState("게시된 프로젝트가 없습니다");
      $("#catList").querySelectorAll("[data-sub]").forEach((b) => (b.onclick = () => withBusy(b, async () => {
        try { const r = await api("/api/hub/subscribe", { method: "POST", json: { pid: b.dataset.sub } }); d.close(); afterImport(r); } catch (e) { toast(e.message); }
      })));
    } catch (e) { $("#catList").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
  $("#catQ").oninput = () => { clearTimeout(catalogDialog._t); catalogDialog._t = setTimeout(draw, 250); };
  draw();
}
const _showList12 = showList;
showList = async function () { await _showList12(); hubSync(false); if (isDashboard()) publishStatusPanel(); };

// ---------------------------------------------------------------- PMS 대시보드: 게시 현황 · 기기 관리
async function publishStatusPanel() {
  const xs = await api("/api/dashboard/publish-status").catch(() => []);
  if (!xs.length || $("#pubStatus")) return;
  const miss = xs.filter((x) => !x.this_month).length;
  const p = document.createElement("div"); p.className = "panel"; p.id = "pubStatus";
  p.innerHTML = `<div class="row between"><h3 class="m0">게시 현황 <span class="muted fs13">이번 달 게시 ${xs.length - miss}/${xs.length}</span></h3>${miss ? `<span class="chip warn">이번 달 미게시 ${miss}</span>` : '<span class="chip ok">모두 게시</span>'}</div>
    <table class="t mt12" data-noexport><thead><tr><th>프로젝트</th><th>판</th><th>마지막 게시</th><th>게시자</th><th>편집 소유권</th><th>이번 달</th></tr></thead><tbody>
    ${xs.map((x) => `<tr><td>${x.upload_id ? `<a href="#/p/${x.upload_id}/overview">${esc(x.name)}</a>` : esc(x.name)}</td><td>v${x.version}</td><td>${x.published_at ? `${x.published_at.slice(0, 10)} (${ago(x.published_at)})` : "-"}</td>
      <td>${esc(x.publisher || "")}</td><td>${esc(x.lock_user || "")}</td><td>${x.this_month ? '<span class="chip ok">게시</span>' : '<span class="chip warn">미게시</span>'}</td></tr>`).join("")}</tbody></table>`;
  ($("#homeBlocks") || view).appendChild(p);
}
const _showAdmin12 = showAdmin;
showAdmin = async function () {
  await _showAdmin12();
  await pmsReady;
  if (!isDashboard()) return;
  const xs = await api("/api/admin/hub/devices").catch(() => []);
  const p = document.createElement("div"); p.className = "panel"; p.id = "hubDevices";
  p.innerHTML = `<h3 class="mt0">${icon("phone", 18)} 연결된 PMS 현장 (기기)</h3><p class="muted fs13">PMS 현장 PC가 대시보드 계정으로 연결하면 여기에 나옵니다. 잃어버리거나 퇴사한 PC는 '연결 끊기'로 바로 막습니다.</p>
    ${xs.length ? `<table class="t" data-noexport><thead><tr><th>사용자</th><th>기기</th><th>연결</th><th>마지막 접속</th><th>상태</th></tr></thead><tbody>
    ${xs.map((d) => `<tr><td>${esc(d.username)}</td><td>${esc(d.name)}</td><td>${d.created_at.slice(0, 10)}</td><td>${d.last_seen.replace("T", " ").slice(0, 16)}</td>
      <td>${d.revoked ? '<span class="chip">끊김</span>' : `<button class="btn sm danger" data-rev="${d.id}">연결 끊기</button>`}</td></tr>`).join("")}</tbody></table>` : emptyState("연결된 기기가 없습니다")}`;
  ($("#pmsPolicy") || view.querySelector("h2"))?.after(p);
  p.querySelectorAll("[data-rev]").forEach((b) => (b.onclick = async () => {
    if (!(await ui.confirm("이 기기의 연결을 끊을까요? 그 PC는 다시 연결하기 전까지 게시·구독·AI를 쓸 수 없습니다.", { ok: "연결 끊기", danger: true }))) return;
    await api(`/api/admin/hub/devices/${b.dataset.rev}/revoke`, { method: "POST" }); showAdmin();
  }));
};

WHATSNEW["2.2"] = [
  { ic: "link", t: "PMS 대시보드 연결", d: "내 설정 → PMS 대시보드 연결에서 본사 대시보드 주소와 계정으로 이 PC를 한 번 연결합니다.", go: "#/me" },
  { ic: "arrowup", t: "게시와 편집 소유권", d: "작업 ▾ → PMS 대시보드에 게시. 게시된 판은 바뀌지 않고, 한 프로젝트는 한 PC만 게시할 수 있습니다(필요하면 소유권 가져오기)." },
  { ic: "key", t: "구독과 공유 코드", d: "홈 '가져오기'에서 대시보드 프로젝트를 찾아 구독하거나 공유 코드(PMS-XXXX-XXXX)를 입력합니다. 구독한 프로젝트는 새 판이 자동으로 들어옵니다." },
  { ic: "sparkles", t: "AI는 PMS 대시보드에서", d: "대시보드에 연결된 PMS 현장의 AI 기능은 서버에서 실행됩니다. PC마다 Claude CLI를 설치할 필요가 없습니다." },
];
