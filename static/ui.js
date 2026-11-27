"use strict";
// ================================================================ 공통 UI 기반 (대화상자, 서랍, 용어, 링크, 내보내기, 진행 표시, AI 패널)

// ---------------------------------------------------------------- 대화상자 (alert/confirm/prompt 대체)
function _modal(html, { wide = false } = {}) {
  const d = document.createElement("dialog");
  d.className = "modal" + (wide ? " wide" : "");
  d.innerHTML = html;
  document.body.appendChild(d);
  d.addEventListener("close", () => setTimeout(() => d.remove(), 0));
  d.showModal();
  return d;
}

const ui = {
  confirm(message, { ok = "확인", danger = false } = {}) {
    return new Promise((resolve) => {
      const d = _modal(`<form method="dialog"><p style="margin-top:0;white-space:pre-wrap">${esc(message)}</p>
        <div class="row end"><button class="btn" value="no">취소</button><button class="btn ${danger ? "danger-fill" : "primary"}" value="yes" autofocus>${esc(ok)}</button></div></form>`);
      d.addEventListener("close", () => resolve(d.returnValue === "yes"));
    });
  },
  notice(title, html) {
    _modal(`<form method="dialog"><h3>${esc(title)}</h3><div>${html}</div><div class="row end"><button class="btn primary" value="ok">확인</button></div></form>`);
  },
  // fields: [{name,label,type:'text'|'number'|'date'|'select'|'textarea'|'checkbox',value,options,required,placeholder,help}]
  form(title, fields, { submit = "저장", intro = "" } = {}) {
    return new Promise((resolve) => {
      const f = (x) => {
        const common = `name="${x.name}" ${x.required ? "required" : ""} placeholder="${esc(x.placeholder || "")}"`;
        let input;
        if (x.type === "select") input = `<select ${common}>${(x.options || []).map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(x.value ?? "") === String(v) ? "selected" : ""}>${esc(l)}</option>`; }).join("")}</select>`;
        else if (x.type === "textarea") input = `<textarea ${common} rows="${x.rows || 4}">${esc(x.value ?? "")}</textarea>`;
        else if (x.type === "checkbox") return `<label class="chk"><input type="checkbox" name="${x.name}" ${x.value ? "checked" : ""}> ${esc(x.label)}</label>`;
        else input = `<input type="${x.type || "text"}" ${common} value="${esc(x.value ?? "")}" ${x.step ? `step="${x.step}"` : ""}>`;
        return `<label>${esc(x.label)}${x.required ? ' <span class="req" aria-hidden="true">*</span>' : ""}${input}${x.help ? `<small class="muted">${esc(x.help)}</small>` : ""}</label>`;
      };
      const d = _modal(`<form method="dialog"><h3>${esc(title)}</h3>${intro ? `<p class="muted">${intro}</p>` : ""}${fields.map(f).join("")}
        <div class="row end"><button class="btn" value="cancel" formnovalidate>취소</button><button class="btn primary" value="ok">${esc(submit)}</button></div></form>`);
      d.querySelector("form").addEventListener("submit", (e) => {
        if (e.submitter?.value !== "ok") return;
        const out = {};
        for (const x of fields) {
          const el = e.target.elements[x.name];
          out[x.name] = x.type === "checkbox" ? el.checked : x.type === "number" ? (el.value === "" ? null : +el.value) : el.value;
        }
        d._out = out;
      });
      d.addEventListener("close", () => resolve(d.returnValue === "ok" ? d._out : null));
    });
  },
};

// ---------------------------------------------------------------- 오른쪽 서랍 (상세 패널)
function openDrawer(title, html, { id = "drawer", width } = {}) {
  let d = $("#" + id);
  if (!d) {
    d = document.createElement("div");
    d.id = id; d.className = "drawer"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "false");
    document.body.appendChild(d);
  }
  if (width) d.style.width = width;
  d.setAttribute("aria-labelledby", id + "-t");
  d.innerHTML = `<div class="drawer-head"><h2 class="dh" id="${id}-t">${title}</h2><button class="btn icon" aria-label="닫기" data-close>✕</button></div><div class="drawer-body">${html}</div>`;
  d.classList.add("open");
  d.querySelector("[data-close]").onclick = () => closeDrawer(id);
  d.querySelector("[data-close]").focus();
  return d;
}
function closeDrawer(id = "drawer") { $("#" + id)?.classList.remove("open"); }

// ---------------------------------------------------------------- 현재 프로젝트 맥락
const ctx = { uid: null, tab: null, result: null };
function currentCodes() { return new Set((ctx.result?.activities || []).map((a) => a.code)); }

// ---------------------------------------------------------------- ② 액티비티 상세 서랍 (모든 화면 공통)
async function openActivity(code) {
  const r = ctx.result; if (!r) return;
  const a = r.activities.find((x) => x.code === code); if (!a) return;
  const byId = Object.fromEntries(r.activities.map((x) => [x.id, x]));
  const rel = (xs, dir) => xs.map((x) => { const o = byId[x.id]; return `<tr><td>${dir}</td><td><button class="act-link" data-act="${esc(o.code)}">${esc(o.code)}</button></td><td class="wrap">${esc(o.name)}</td><td>${x.type}${x.lag ? (x.lag > 0 ? "+" : "") + x.lag : ""}</td><td class="num">${fmtDays(o.tf)}</td></tr>`; }).join("");
  const d = openDrawer(`${esc(a.code)} · ${esc(a.name)}`, `
    <div class="chips">${statusTag(a)}${a.longest ? '<span class="chip bad">▲ 최장경로</span>' : ""}${a.tf !== null && a.tf < 0 ? '<span class="chip bad">✕ 음수 여유</span>' : ""}</div>
    <dl class="kv">
      <dt>WBS</dt><dd>${esc(a.wbs) || "-"}</dd><dt>캘린더</dt><dd>${esc(a.calendar)}</dd>
      <dt>원공기 / 잔여</dt><dd>${a.orig_dur}일 / ${a.rem_dur}일 · 공정률 ${a.pct}%</dd>
      <dt>${term("시작")} ~ ${term("종료")}</dt><dd>${a.start} ~ ${a.finish}</dd>
      <dt>Late</dt><dd>${a.late_start} ~ ${a.late_finish}</dd>
      <dt>${term("TF")} / ${term("FF")}</dt><dd>${fmtDays(a.tf)} / ${fmtDays(a.ff)}</dd>
      <dt>계획(Target)</dt><dd>${a.bl_start || "-"} ~ ${a.bl_finish || "-"}</dd>
      ${a.act_start ? `<dt>실적</dt><dd>${a.act_start} ~ ${a.act_end || "진행중"}</dd>` : ""}
      ${a.constraint ? `<dt>제약조건</dt><dd>${esc(a.constraint)} ${a.constraint_date || ""}</dd>` : ""}
    </dl>
    <h4>선·후행 관계</h4><table class="t" data-noexport><tbody>${rel(a.preds, "선행")}${rel(a.succs, "후행")}</tbody></table>
    <div id="actExtra" class="muted">관련 리스크·제약·변경 이력을 불러오는 중...</div>
    <div class="row mt12">
      <a class="btn sm" href="#/p/${ctx.uid}/gantt" data-goto-gantt="${esc(a.code)}">공정표에서 보기</a>
      <button class="btn sm" data-whatif="${esc(a.code)}">이 작업으로 What-if</button>
      <button class="btn sm" data-ask="${esc(a.code)}">✦ AI에게 묻기</button></div>`);
  d.querySelector("[data-goto-gantt]").onclick = () => { highlight.clear(); highlight.add(a.code); };
  d.querySelector("[data-whatif]").onclick = () => { sessionStorage.setItem("whatif:" + ctx.uid, JSON.stringify([{ op: "set_duration", code: a.code, days: a.rem_dur }])); location.hash = `#/p/${ctx.uid}/whatif`; };
  d.querySelector("[data-ask]").onclick = () => openAiPanel(`${a.code} ${a.name} 작업의 현황, 일정 위험, 선후행 영향을 설명해줘.`);
  const [risks, la, fr] = await Promise.all([
    api(`/api/uploads/${ctx.uid}/risks`).catch(() => []), api(`/api/uploads/${ctx.uid}/lookahead`).catch(() => ({ constraints: [] })),
    api(`/api/uploads/${ctx.uid}/forensic`).catch(() => ({}))]);
  const rk = risks.filter((x) => x.codes.includes(code));
  const cs = (la.constraints || []).filter((x) => x.code === code);
  const ch = (fr.changes?.items || []).filter((x) => x.code === code);
  const box = d.querySelector("#actExtra"); if (!box) return;
  box.classList.remove("muted");
  box.innerHTML = `<h4>연결된 리스크 (${rk.length})</h4>${rk.map((x) => `<div class="mini">${esc(x.title)} · ${x.prob}% · ${x.impact_ml}일</div>`).join("") || '<div class="muted">없음</div>'}
    <h4>제약 (${cs.length})</h4>${cs.map((x) => `<div class="mini">${esc(x.type)} · ${esc(x.desc)} · ${esc(x.status)} ${x.due || ""}</div>`).join("") || '<div class="muted">없음</div>'}
    <h4>직전 업데이트 대비 변경 (${ch.length})</h4>${ch.map((x) => `<div class="mini">${esc(x.category)}: ${esc(x.before)} → ${esc(x.after)}</div>`).join("") || '<div class="muted">없음</div>'}`;
  box.insertAdjacentHTML("beforeend", `<h4>코멘트</h4><div id="actComments"></div>`);
  if (typeof commentThread === "function") commentThread(box.querySelector("#actComments"), ctx.uid, "activity:" + code, { compact: true });
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (b) { e.preventDefault(); openActivity(b.dataset.act); }
});

// ---------------------------------------------------------------- ⑫ 용어 도움말
const GLOSSARY = {
  "TF": "Total Float(총 여유). 준공일을 늦추지 않고 이 작업이 늦어져도 되는 작업일 수. 0 이하면 주공정입니다.",
  "FF": "Free Float(자유 여유). 바로 뒤 작업의 시작을 늦추지 않고 늦어져도 되는 작업일 수.",
  "Data Date": "공정 진도를 반영한 기준일. 이 날짜 이전은 실적, 이후는 계획입니다.",
  "최장경로": "Data Date부터 준공까지 끊기지 않고 이어지는 가장 긴 작업 경로(Longest Path). 이 경로의 작업이 늦으면 준공이 늦어집니다.",
  "주공정": "여유가 0 이하인 작업들. 지연되면 곧바로 준공이 지연됩니다.",
  "DCMA": "미 국방부 계약관리청의 공정표 품질 평가 기준 14개 항목.",
  "SPI": "일정 성과 지수 = EV / PV. 1보다 작으면 계획보다 늦습니다.",
  "CPI": "원가 성과 지수 = EV / AC. 1보다 작으면 원가가 초과되고 있습니다.",
  "EV": "획득가치(Earned Value). 실제로 끝낸 작업의 예산 가치.",
  "PV": "계획가치(Planned Value). 지금까지 끝냈어야 할 작업의 예산 가치.",
  "AC": "실투입비(Actual Cost).",
  "EAC": "준공 시 예상 총원가.",
  "BAC": "총예산(Budget at Completion).",
  "PPC": "Percent Plan Complete. 주간 약속한 작업 중 실제 완료한 비율. 80% 이상을 목표로 합니다.",
  "P50": "시뮬레이션 결과의 중앙값. 50% 확률로 이 날짜 안에 준공합니다.",
  "P80": "80% 확률로 이 날짜 안에 준공합니다. 보수적인 목표로 많이 씁니다.",
  "CPLI": "주공정 길이 지수. 1보다 작으면 목표 준공을 맞추기 어렵습니다.",
  "BEI": "기한이 도래한 작업 중 실제 완료한 비율.",
  "Lag": "선행 작업 후 후행 작업까지의 대기 일수. 음수면 Lead(겹침)입니다.",
  "FS": "Finish-to-Start: 선행이 끝나야 후행이 시작.",
  "SS": "Start-to-Start: 선행이 시작해야 후행이 시작.",
  "Open End": "선행 또는 후행 관계가 빠진 작업. 여유가 과대 계산되는 원인입니다.",
  "What-if": "원본을 바꾸지 않고 가정(공기·관계·진도 변경)을 넣어 다시 계산해 보는 기능.",
  "Crashing": "인력·장비를 더 투입해 작업 공기를 줄이는 것(비용 증가).",
  "Fast-tracking": "순차 작업을 겹쳐서 진행하는 것(위험 증가).",
  "건전성": "일정 건전성 점수. 34개 품질 지표의 가중 평균(0~100).",
  "Retained Logic": "착수된 작업도 남은 일은 선행 작업이 끝난 뒤 진행한다고 보는 계산 방식(P6 기본).",
  "Progress Override": "착수된 작업은 선행 논리를 무시하고 Data Date부터 바로 진행한다고 보는 계산 방식.",
  "시작": "조기 시작일(Early Start). 선행 작업이 허락하는 가장 빠른 시작일.",
  "종료": "조기 종료일(Early Finish).",
};
function term(word, label) {
  const k = Object.keys(GLOSSARY).find((x) => x.toLowerCase() === String(word).toLowerCase());
  return k ? `<span class="term" tabindex="0" data-term="${esc(k)}">${esc(label || word)}</span>` : esc(label || word);
}
function applyGlossary(root) {
  root.querySelectorAll("th:not([data-g]), .kpi .l:not([data-g])").forEach((th) => {
    th.dataset.g = "1";
    const txt = th.textContent.trim();
    const k = Object.keys(GLOSSARY).find((x) => txt === x || txt.startsWith(x + " ") || txt.endsWith("(" + x + ")") || txt.split(/[ ·/()]+/).includes(x));
    if (k && !th.querySelector(".term")) th.insertAdjacentHTML("beforeend", ` <span class="term ico" tabindex="0" data-term="${esc(k)}" aria-label="${esc(k)} 설명">?</span>`);
  });
}
let termTip;
function showTerm(el) {
  termTip ||= Object.assign(document.createElement("div"), { className: "tip", role: "tooltip" });
  document.body.appendChild(termTip);
  termTip.innerHTML = `<b>${esc(el.dataset.term)}</b><br>${esc(GLOSSARY[el.dataset.term])}`;
  const r = el.getBoundingClientRect();
  termTip.style.left = Math.min(window.innerWidth - 300, Math.max(8, r.left)) + "px";
  termTip.style.top = r.bottom + 6 + window.scrollY + "px";
  termTip.hidden = false;
}
document.addEventListener("mouseover", (e) => { const t = e.target.closest?.(".term"); if (t) showTerm(t); else if (termTip && !e.target.closest?.(".tip")) termTip.hidden = true; });
document.addEventListener("focusin", (e) => { const t = e.target.closest?.(".term"); if (t) showTerm(t); });

// ---------------------------------------------------------------- 표 공통: ID 링크, 내보내기
function linkify(root) {
  const codes = currentCodes(); if (!codes.size) return;
  root.querySelectorAll("table.t td:not([data-l])").forEach((td) => {
    td.dataset.l = "1";
    if (td.children.length || td.closest("[data-nolink]")) return;
    const txt = td.textContent.trim();
    if (!txt || txt.length > 400) return;
    const parts = txt.split(/\s*,\s*/);
    if (parts.every((x) => codes.has(x))) td.innerHTML = parts.map((x) => `<button class="act-link" data-act="${esc(x)}">${esc(x)}</button>`).join(", ");
  });
}
function tableToCsv(table) {
  const rows = [...table.querySelectorAll("tr")].filter((tr) => !tr.hidden).map((tr) => [...tr.children].map((c) => {
    const v = (c.querySelector("select") ? c.querySelector("select").value : c.innerText).replace(/\s*\?\s*$/, "").replace(/\s+/g, " ").trim();
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(","));
  return "﻿" + rows.join("\r\n");
}
function addExportButtons(root) {
  root.querySelectorAll(".panel:not([data-x])").forEach((p) => {
    p.dataset.x = "1";
    const t = p.querySelector("table.t:not([data-noexport])");
    if (!t || t.rows.length < 3) return;
    const b = document.createElement("button");
    b.className = "btn sm export"; b.type = "button"; b.textContent = "⭳ 엑셀로 내보내기"; b.title = "이 표를 CSV(엑셀)로 내보내기";
    b.onclick = () => {
      const h = p.querySelector("h3")?.childNodes[0]?.textContent?.trim() || "표";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([tableToCsv(t)], { type: "text/csv" }));
      a.download = `${ctx.result?.name || "export"}_${h}_${ctx.result?.data_date || ""}.csv`; a.hidden = true; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 1000);
    };
    const bar = document.createElement("div"); bar.className = "export-bar"; bar.appendChild(b);
    const anchor = t.closest(".scroll") || t;
    anchor.parentNode.insertBefore(bar, anchor);
  });
}
function enhance(root) {
  if (!root) return;
  const run = () => { linkify(root); applyGlossary(root); enhanceTables(root); applyRole(root); };
  run();
  if (root._obs) root._obs.disconnect();
  let t; root._obs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(run, 60); });
  root._obs.observe(root, { childList: true, subtree: true });
}

// ---------------------------------------------------------------- ⑤ 권한별 UI
const WRITE_BTNS = "#tab [data-edit], #tab [data-rm], #tab [data-del], #tab [data-commit], #tab [data-con], #tab [data-cdel], #tab #repSave, #tab [data-sv], #tab [data-fix]";
const WRITE_INPUTS = "#tab [data-done], #tab [data-reason], #tab [data-cst], #tab textarea[data-k]";
function applyRole(root = document) {
  const role = document.body.dataset.role || "admin";
  const lv = { viewer: 1, editor: 2, admin: 3 }[role] || 3;
  root.querySelectorAll("[data-need]").forEach((el) => {
    let hide = ({ editor: 2, admin: 3 }[el.dataset.need] || 1) > lv;
    // 프로젝트 화면 안의 편집 버튼: 그 프로젝트에 쓰기 권한이 없으면 숨김 (읽기는 모두, 쓰기는 자기 프로젝트만)
    if (!hide && el.dataset.need === "editor" && el.dataset.scope !== "global" && ctx.uid && ctx.canWrite === false && el.closest("#view")) hide = true;
    el.hidden = hide;
  });
  // 읽기 전용 프로젝트: 행 단위 편집 버튼은 숨기고, 상태 입력칸은 비활성화
  if (ctx.uid && ctx.canWrite === false) {
    root.querySelectorAll(WRITE_BTNS).forEach((el) => { if (el.closest("#view")) el.hidden = true; });
    root.querySelectorAll(WRITE_INPUTS).forEach((el) => { if (el.closest("#view")) { el.disabled = true; el.title = "읽기 전용 프로젝트"; } });
  }
}

// ---------------------------------------------------------------- ⑥ 오래 걸리는 작업: 진행 표시 + 취소
async function runLong(label, key, fn) {
  const est = +store.get("est:" + key, "0") || 0;
  const ac = new AbortController();
  const d = _modal(`<div class="prog"><h3>${esc(label)}</h3><div class="pbar"><i></i></div>
    <p class="muted" id="pTxt">시작하는 중...</p><div class="row end"><button class="btn" id="pCancel">취소</button></div></div>`);
  d.addEventListener("cancel", (e) => e.preventDefault());
  const t0 = Date.now();
  const timer = setInterval(() => {
    const s = (Date.now() - t0) / 1000;
    const pct = est ? Math.min(95, (100 * s) / est) : Math.min(90, 100 * (1 - Math.exp(-s / 20)));
    d.querySelector(".pbar i").style.width = pct + "%";
    d.querySelector("#pTxt").textContent = `${Math.round(s)}초 경과` + (est ? ` · 예상 약 ${Math.round(est)}초` : "");
  }, 300);
  d.querySelector("#pCancel").onclick = () => ac.abort();
  try {
    const out = await fn(ac.signal);
    store.set("est:" + key, String(est ? (est + (Date.now() - t0) / 1000) / 2 : (Date.now() - t0) / 1000));
    return out;
  } catch (e) {
    if (e.name === "AbortError") { toast("취소했습니다. 서버에서 진행 중이던 계산 결과는 버립니다."); return null; }
    toast(e.message); throw e;
  } finally { clearInterval(timer); d.close(); }
}

// ---------------------------------------------------------------- ③ AI 측면 패널
let aiHist = [];
function aiKey() { return "chat:" + ctx.uid; }
async function openAiPanel(prefill) {
  if (!ctx.uid) { toast("프로젝트를 먼저 여세요"); return; }
  const st = await getAiStatus();
  try { aiHist = JSON.parse(sessionStorage.getItem(aiKey()) || "[]"); } catch { aiHist = []; }
  const d = openDrawer("✦ AI 어시스턴트", `
    ${st.enabled ? "" : `<div class="panel warn">서버에 Claude CLI가 설치·로그인되어 있지 않아 AI를 쓸 수 없습니다.</div>`}
    <div class="msgs" id="aiMsgs" aria-live="polite"></div>
    <div class="examples" id="aiEx"></div>
    <form id="aiForm" class="chatbox"><textarea id="aiIn" rows="2" placeholder="공정에 대해 물어보세요 (Enter 전송)"></textarea>
      <div class="row"><button class="btn primary" id="aiSend">질문</button><button class="btn" type="button" id="aiClear">새 대화</button></div></form>
    <p class="muted fs12">지금 보고 있는 화면(${esc(TAB_LABEL[ctx.tab] || "-")})을 함께 전달합니다. 숫자는 CPM 엔진 계산값이며 What-if는 원본을 바꾸지 않습니다.</p>`,
    { id: "aiDrawer", width: "min(520px, 100vw)" });
  const ex = { risk: ["준공을 지킬 확률과 가장 큰 리스크는?", "대응 방안이 없는 리스크에 대응책을 제안해줘"],
    health: ["건전성 점수를 올리려면 무엇부터 고쳐야 해?"], lookahead: ["이번 주 제약 때문에 막힌 작업은?"],
    analysis: ["지난 업데이트 대비 준공이 왜 늦어졌어?"], recovery: ["준공을 10일 당기는 가장 싼 방법은?"] }[ctx.tab] || [];
  const common = ["다음 달에 착수해야 하는 주공정 작업은?", "계획보다 늦어지는 작업을 공종별로 정리해줘"];
  $("#aiEx").innerHTML = [...ex, ...common].slice(0, 4).map((q) => `<button class="btn sm ex" type="button">${esc(q)}</button>`).join("");
  const box = $("#aiMsgs");
  const render = () => {
    box.innerHTML = aiHist.map((m, i) => m.role === "user" ? `<div class="msg user">${esc(m.content)}</div>`
      : `<div class="msg bot">${md(m.content)}${m.codes?.length ? `<button class="btn sm" data-hl="${i}">공정표에서 보기 (${m.codes.length})</button>` : ""}</div>`).join("")
      || `<div class="muted">예시 질문을 누르거나 직접 질문해 보세요.</div>`;
    box.scrollTop = box.scrollHeight;
    box.querySelectorAll("[data-hl]").forEach((b) => (b.onclick = () => { highlight.clear(); aiHist[b.dataset.hl].codes.forEach((c) => highlight.add(c)); location.hash = `#/p/${ctx.uid}/gantt`; }));
    linkify(box);
  };
  const send = async (q) => {
    if (!q.trim()) return;
    aiHist.push({ role: "user", content: q }); render();
    box.insertAdjacentHTML("beforeend", `<div class="msg bot muted"><span class="spinner"></span> 데이터를 조회하며 답변을 작성 중입니다 (보통 10~40초)</div>`);
    box.scrollTop = box.scrollHeight;
    try {
      const res = await api(`/api/uploads/${ctx.uid}/chat`, { method: "POST", json: { context: ctx.tab, messages: aiHist.map(({ role, content }) => ({ role, content })) } });
      aiHist.push({ role: "assistant", content: res.answer, codes: res.codes });
    } catch (e) { aiHist.push({ role: "assistant", content: "⚠ " + e.message }); }
    try { sessionStorage.setItem(aiKey(), JSON.stringify(aiHist.slice(-30))); } catch {}
    render();
  };
  $("#aiForm").onsubmit = (e) => { e.preventDefault(); const v = $("#aiIn").value; $("#aiIn").value = ""; send(v); };
  $("#aiIn").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#aiForm").requestSubmit(); } };
  $("#aiClear").onclick = () => { aiHist = []; sessionStorage.removeItem(aiKey()); render(); };
  d.querySelectorAll(".ex").forEach((b) => (b.onclick = () => send(b.textContent)));
  render();
  if (prefill) send(prefill); else $("#aiIn").focus();
}

// ---------------------------------------------------------------- ⑩ 차트 툴팁
function attachTooltip(cv, labels, series, fmt = (v) => v) {
  const tip = document.createElement("div"); tip.className = "tip chart"; tip.hidden = true; document.body.appendChild(tip);
  cv.onmousemove = (e) => {
    const r = cv.getBoundingClientRect(); const n = labels.length; if (!n) return;
    const i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left - 56) / (r.width - 68)) * (n - 1))));
    tip.innerHTML = `<b>${esc(labels[i])}</b>` + series.map((s) => s.values[i] === null || s.values[i] === undefined ? "" : `<br><i style="background:${s.color}"></i>${esc(s.name || "")} ${esc(fmt(s.values[i]))}`).join("");
    tip.style.left = e.pageX + 12 + "px"; tip.style.top = e.pageY + 12 + "px"; tip.hidden = false;
  };
  cv.onmouseleave = () => (tip.hidden = true);
  cv.setAttribute("role", "img");
  cv.setAttribute("aria-label", series.map((s) => s.name).filter(Boolean).join(", ") + " 차트");
}

// ---------------------------------------------------------------- ⑬ 테마, ⑭ 키보드
function applyTheme() {
  const t = store.get("theme", "auto");
  document.documentElement.dataset.palette = store.get("palette", "graphite");
  document.documentElement.dataset.theme = t === "auto" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : t;
}
applyTheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);
function toggleTheme() {
  const order = ["auto", "light", "dark"]; const cur = store.get("theme", "auto");
  store.set("theme", order[(order.indexOf(cur) + 1) % 3]); applyTheme();
  toast(`화면 테마: ${{ auto: "시스템 설정", light: "밝게", dark: "어둡게" }[store.get("theme", "auto")]}`);
}
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input,textarea,select,[contenteditable]")) { if (e.key === "Escape") e.target.blur(); return; }
  if (e.key === "Escape") { closeDrawer(); closeDrawer("aiDrawer"); }
  if (e.key === "/") { const q = $("#q") || $("#tab input[type=search]"); if (q) { e.preventDefault(); q.focus(); } }
  if (e.key === "?" ) { e.preventDefault(); showShortcuts(); }
  if (e.key.toLowerCase() === "a" && e.altKey) { e.preventDefault(); openAiPanel(); }
});
function showShortcuts() {
  ui.notice("단축키", `<table class="t" data-noexport><tbody>
    <tr><td><kbd>/</kbd></td><td>검색창으로 이동</td></tr><tr><td><kbd>Alt</kbd>+<kbd>A</kbd></td><td>AI 어시스턴트 열기</td></tr>
    <tr><td><kbd>Esc</kbd></td><td>패널 닫기</td></tr><tr><td><kbd>?</kbd></td><td>이 도움말</td></tr>
    <tr><td>공정표에서 <kbd>↑</kbd><kbd>↓</kbd></td><td>작업 선택 이동, <kbd>Enter</kbd> 상세 보기</td></tr>
    <tr><td>공정표에서 <kbd>Ctrl</kbd>+휠</td><td>확대·축소 (드래그로 이동)</td></tr></tbody></table>`);
}
