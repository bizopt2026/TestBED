"use strict";
// ================================================================ PMS P4·P5: 대시보드 코멘트·이슈를 현장 상황판에, 운영(백업·상태)

const HQ_KEY = "hubCommentQueue";
const hq = () => { try { return JSON.parse(store.get(HQ_KEY, "[]")); } catch { return []; } };
async function hubCommentFlush() {
  const q = hq(); if (!q.length || !navigator.onLine) return;
  const left = [];
  for (const it of q) { try { await api(`/api/uploads/${it.uid}/hub-comments`, { method: "POST", json: { text: it.text } }); } catch (e) { if (e.status === 0 || e.status === 502) left.push(it); } }
  store.set(HQ_KEY, JSON.stringify(left));
  if (q.length !== left.length) toast(`보내지 못했던 대시보드 코멘트 ${q.length - left.length}건을 보냈습니다`);
}
window.addEventListener("online", hubCommentFlush);
document.addEventListener("DOMContentLoaded", () => setTimeout(hubCommentFlush, 3000));

async function hubFeedPanel(el, uid) {
  const f = await api(`/api/uploads/${uid}/hub-feed`).catch(() => null);
  if (!f?.available || !el.isConnected) return;
  const pend = hq().filter((x) => x.uid === uid);
  const p = document.createElement("div"); p.className = "panel"; p.id = "hubFeed";
  p.innerHTML = `<div class="row between"><h3 class="m0">${icon("link", 18)} PMS 대시보드 <span class="muted fs13">이슈·코멘트 (대시보드 기준)</span></h3>
      ${pend.length ? `<span class="chip warn">보내지 않은 코멘트 ${pend.length}건</span>` : ""}</div>
    <div class="grid2 mt12"><div><h4 class="mt0">열린 이슈 ${f.issues.length}</h4>${f.issues.map((x) => `<div class="inbox-item ${x.severity === "bad" ? "high" : "mid"}"><span class="sev">${x.severity === "bad" ? "✕" : "!"}</span>
        <span>${esc(x.title)} <span class="muted fs12">· ${({ new: "새로", ack: "확인", doing: "조치 중" })[x.status] || ""}${x.assignee ? ` · ${esc(x.assignee)}` : ""}</span></span><span></span></div>`).join("") || '<p class="muted">대시보드에서 찾은 이슈가 없습니다.</p>'}</div>
      <div><h4 class="mt0">코멘트</h4><div class="hf-list">${f.comments.slice(-8).map((c) => `<div class="cmt"><div class="cmt-h"><b>${esc(c.author)}</b><span class="muted">${(c.created_at || "").replace("T", " ").slice(5, 16)}</span>${c.via ? `<span class="chip">${esc(c.via)}</span>` : ""}</div><div class="cmt-b">${esc(c.text)}</div></div>`).join("") || '<p class="muted">아직 없습니다.</p>'}</div>
        <form class="cmt-form" id="hfForm"><textarea class="s" rows="2" aria-label="대시보드 코멘트" placeholder="대시보드와 구독자에게 남길 코멘트 (@아이디로 알림)"></textarea><button class="btn sm primary">남기기</button></form></div></div>`;
  el.appendChild(p);
  $("#hfForm").onsubmit = async (e) => {
    e.preventDefault(); const t = e.target.querySelector("textarea").value.trim(); if (!t) return;
    try { await api(`/api/uploads/${uid}/hub-comments`, { method: "POST", json: { text: t } }); toast("대시보드에 코멘트를 남겼습니다"); p.remove(); hubFeedPanel(el, uid); }
    catch (err) {
      if (err.status === 0 || err.status === 502) { store.set(HQ_KEY, JSON.stringify([...hq(), { uid, text: t, at: Date.now() }])); toast("대시보드에 연결할 수 없어 임시 저장했습니다. 연결되면 자동으로 보냅니다"); p.remove(); hubFeedPanel(el, uid); }
      else toast(err.message);
    }
  };
}
const _tabOverview14 = tabOverview;
tabOverview = async function (el, r, uid) {
  await _tabOverview14(el, r, uid);
  await pmsReady;
  if (!isDashboard()) hubFeedPanel(el, uid);
};

// ---------------------------------------------------------------- 관리: 백업 · 상태
const _showAdmin14 = showAdmin;
showAdmin = async function () {
  await _showAdmin14();
  const h = await api("/api/health").catch(() => null);
  const p = document.createElement("div"); p.className = "panel"; p.id = "opsPanel";
  p.innerHTML = `<h3 class="mt0">${icon("shield", 18)} 운영</h3>
    ${h ? `<div class="kvline">판 <b>${esc(window.PMS.edition_name)}</b> · 버전 ${esc(h.version)} · 프로젝트 ${h.projects} · DB ${h.db_mb}MB${h.hub_projects !== undefined ? ` · 게시 프로젝트 ${h.hub_projects} · 열린 이슈 ${h.open_issues} · 연결 기기 ${h.devices}` : ""}</div>` : ""}
    <p class="muted fs13">백업은 사용 중에도 안전하게 만들어지며 data/backups 에도 최근 10개가 남습니다. 복구는 프로그램을 멈춘 뒤 data/app.db 를 백업 파일로 바꾸면 됩니다.</p>
    <div class="row"><button class="btn" id="opsBackup">${icon("arrowup", 15)} 지금 백업 내려받기</button></div>`;
  ($("#updPanel") || view.querySelector("h2"))?.after(p);
  $("#opsBackup").onclick = () => withBusy($("#opsBackup"), () => download("/api/admin/backup", "pms-backup.db"));
};

WHATSNEW["2.5"] = [
  { ic: "message", t: "대시보드 코멘트·이슈를 현장에서", d: "게시·구독한 프로젝트의 상황판 아래에 PMS 대시보드의 열린 이슈와 코멘트가 보이고, 바로 답할 수 있습니다. 연결이 끊기면 임시 저장 후 자동 전송합니다." },
  { ic: "shield", t: "운영: 백업·상태", d: "관리 화면에서 지금 백업을 내려받고, 버전·DB 크기·게시·이슈·연결 기기 현황을 봅니다." },
];
