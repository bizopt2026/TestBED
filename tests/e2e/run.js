// 화면 회귀 자동 테스트: 업로드 → 상황판 → 월간 점검 → 보고서 센터, 편집 권한 요청·승인, 코멘트 @멘션, 공정표 조작 + axe 접근성 점검
// 실행: cd tests/e2e && npm install && node run.js   (저장소 루트의 Python 환경에서 서버를 임시 DB로 띄웁니다)
"use strict";
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..", "..");
const PORT = +(process.env.E2E_PORT || 8765);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.E2E_OUT || path.join(__dirname, "out");
const PY = process.env.PYTHON || "python3";
const PW = "e2e-password-123";
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
fs.mkdirSync(OUT, { recursive: true });

const results = [];
let failed = 0;
async function step(name, fn) {
  const t = Date.now();
  try { await fn(); results.push(`✓ ${name} (${Date.now() - t}ms)`); }
  catch (e) { failed++; results.push(`✕ ${name}: ${e.message.split("\n")[0]}`); }
}
function assert(c, msg) { if (!c) throw new Error(msg); }

async function startServer() {
  const db = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "e2e-")), "e2e.db");
  const env = { ...process.env, DB_PATH: db, AI_PROVIDER: "off", PYTHONPATH: ROOT };
  execFileSync(PY, ["-c", `from app import auth, storage, access
storage.init(); access.init()
for u, r in (("admin", "admin"), ("alice", "editor"), ("bob", "editor"), ("vic", "viewer")): auth.create_user(u, "${PW}", r)`], { cwd: ROOT, env });
  const srv = spawn(PY, ["-m", "uvicorn", "app.main:app", "--port", String(PORT), "--log-level", "warning"], { cwd: ROOT, env, stdio: ["ignore", "inherit", "inherit"] });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + "/api/config"); if (r.ok) return srv; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  srv.kill(); throw new Error("서버가 시작되지 않았습니다");
}

async function login(browser, user, viewport = { width: 1400, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: "ko-KR", acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failed++; results.push(`✕ [${user}] 화면 스크립트 오류: ${e.message}`); });
  await page.goto(BASE + "/");
  await page.fill("#fLogin [name=username]", user);
  await page.fill("#fLogin [name=password]", PW);
  await page.click("#fLogin button[value=ok]");
  await page.waitForSelector("#tbUser");
  return page;
}
const closeDialogs = (page) => page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));

const axeFindings = [];
async function a11y(page, label) {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => {
    const res = await window.axe.run(document, { resultTypes: ["violations"], rules: { "color-contrast": { enabled: false } } });
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, target: v.nodes[0]?.target?.join(" ") }));
  });
  const serious = r.filter((v) => v.impact === "critical" || v.impact === "serious");
  axeFindings.push(...r.map((v) => `${label}: [${v.impact}] ${v.id} ×${v.n} - ${v.help} (${v.target})`));
  assert(!serious.length, `${label} 접근성 심각 위반 ${serious.length}건: ${serious.map((v) => `${v.id}(${v.target})`).join(", ")}`);
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: false });

(async () => {
  const srv = await startServer();
  const browser = await chromium.launch();
  let uid;
  try {
    const alice = await login(browser, "alice");
    await step("빈 홈 화면", async () => { await alice.waitForSelector(".panel.empty"); await a11y(alice, "빈 홈"); });
    await step("업로드 → 상황판", async () => {
      await alice.click("#btnUpload");
      await alice.setInputFiles("#formUpload [name=file]", path.join(ROOT, "samples", "sample_project.xer"));
      await alice.fill("#formUpload [name=note]", "E2E 1차");
      await alice.click("#btnDoUpload");
      await alice.waitForURL(/#\/p\/[^/]+\/overview/);
      uid = alice.url().split("#/p/")[1].split("/")[0];
      await alice.waitForSelector(".sit");
      await closeDialogs(alice);
      assert(await alice.locator(".kpis .kpi").count() >= 5, "KPI 카드가 없습니다");
      const h = await alice.locator("#phead").boundingBox();
      assert(h.height <= 110, `프로젝트 헤더 높이 ${h.height}px > 110px`);
      await shot(alice, "01_overview");
      await a11y(alice, "상황판");
    });
    await step("보기 설정 팝오버·작업 메뉴", async () => {
      await alice.click("#btnView"); await alice.waitForSelector("#viewPop:not([hidden])");
      await alice.keyboard.press("Escape"); assert(await alice.locator("#viewPop").isHidden(), "Esc로 닫히지 않음");
      await alice.click("#btnWork"); await alice.waitForSelector("#workMenu:not([hidden])");
      await alice.click('#workMenu a[href^="#/wizard/"]');
      await alice.waitForSelector(".stepper");
    });
    await step("월간 점검 팀 기록", async () => {
      await alice.fill("#wzNote", "E2E 확인");
      for (let i = 0; i < 8 && !alice.url().endsWith("/overview"); i++) {
        await alice.click("#wzNext");
        await alice.waitForTimeout(400);
      }
      await alice.waitForSelector(".sit");
      assert(await alice.locator(".sit .chip.ok", { hasText: "월간 점검 완료" }).count() === 1, "점검 완료 배지 없음");
    });
    await step("월간 점검 화면 접근성", async () => { await alice.goto(`${BASE}/#/wizard/${uid}`); await alice.waitForSelector(".stepper"); await a11y(alice, "월간 점검"); });
    await step("보고서 센터 → 엑셀 생성", async () => {
      await alice.goto(`${BASE}/#/reports/${uid}`);
      await alice.waitForSelector(".out-cards");
      const [dl] = await Promise.all([alice.waitForEvent("download", { timeout: 30000 }), alice.click("#rpGo")]);
      assert((await dl.suggestedFilename()).length > 0, "다운로드 없음");
      await alice.waitForTimeout(500);
      await shot(alice, "02_reports");
      await a11y(alice, "보고서 센터");
    });
    await step("공정표: 전체 맞춤·오늘·경로 추적", async () => {
      await alice.goto(`${BASE}/#/p/${uid}/gantt`);
      await alice.waitForSelector("#gc");
      await alice.click("#gFit"); await alice.click("#gToday"); await alice.selectOption("#fTrace", "drive");
      await alice.locator("#glr [data-id]").nth(3).click();
      await alice.waitForTimeout(200);
      await shot(alice, "03_gantt_trace");
      await a11y(alice, "공정표");
    });
    await step("설정 하위 탭", async () => {
      await alice.goto(`${BASE}/#/p/${uid}/settings`);
      await alice.waitForSelector(".seg-tabs");
      assert(await alice.locator(".seg-tabs button").count() === 3, "하위 탭 3개가 아님");
      await a11y(alice, "설정");
    });
    await step("엑셀 붙여넣기 일괄 입력(제약)", async () => {
      await alice.goto(`${BASE}/#/p/${uid}/lookahead`);
      await alice.waitForSelector("#laBulkC");
      await alice.click("#laBulkC");
      const code = await alice.evaluate(() => ctx.result.activities.find((a) => a.status_code !== "TK_Complete").code);
      await alice.fill("#bkText", `작업 ID\t유형\t내용\t담당자 아이디\t해소 기한\n${code}\t자재\tE2E 철근 반입\tbob\t2026-12-01\nNOPE\t인력\t없는 작업\t\t`);
      await alice.click("#bkCheck"); await alice.waitForSelector("#bkOut table");
      assert((await alice.textContent("#bkOut")).includes("1행 저장 가능"), "미리보기 검사 결과가 다름");
      await alice.click("#bkSave");
      await alice.waitForSelector("text=E2E 철근 반입");
    });
    const bob = await login(browser, "bob");
    await step("편집 권한 요청 → 승인", async () => {
      await bob.goto(`${BASE}/#/p/${uid}/overview`);
      await bob.waitForSelector("#btnReqAccess", { timeout: 8000 }).catch(async (e) => { await shot(bob, "dbg_bob0"); console.log(await bob.evaluate(() => [location.hash, document.querySelector("#phead")?.outerHTML.slice(0, 900)])); throw e; });
      await bob.click("#btnReqAccess");
      await bob.fill("dialog[open] [name=message]", "E2E 요청");
      await bob.click("dialog[open] button.primary");
      await bob.waitForSelector("#toast:has-text('요청을 보냈습니다')", { timeout: 5000 }).catch(async (e) => { await shot(bob, "dbg_bob"); throw e; });
      await alice.goto(`${BASE}/#/p/${uid}/settings`);
      await alice.waitForSelector(".sub .panel", { timeout: 8000 }).catch(async (e) => { await shot(alice, "dbg_alice"); console.log(await alice.evaluate(() => [location.hash, document.querySelector("#tab")?.innerHTML.slice(0, 600)])); throw e; });
      await alice.waitForSelector("[data-ok]", { timeout: 5000 }).catch(async (e) => { await shot(alice, "dbg_settings"); throw e; });
      await alice.click("[data-ok]");
      await alice.waitForTimeout(400);
      await bob.goto(`${BASE}/#/`); await bob.goto(`${BASE}/#/p/${uid}/overview`);
      await bob.waitForSelector(".sit");
      assert(await bob.locator("#btnReqAccess").count() === 0, "승인 후에도 읽기 전용");
    });
    await step("내게 배정된 일(담당자)", async () => {
      await bob.goto(`${BASE}/#/`);
      await bob.waitForSelector("#myTasks .inbox-item");
      assert((await bob.textContent("#myTasks")).includes("E2E 철근 반입"), "배정된 제약이 없음");
      await shot(bob, "04_home");
      await a11y(bob, "홈");
    });
    const vic = await login(browser, "vic");
    await step("읽기 사용자 코멘트 @멘션 → 알림", async () => {
      await vic.goto(`${BASE}/#/p/${uid}/overview`);
      await vic.waitForSelector("#projComments textarea");
      await vic.fill("#projComments textarea", "@alice 마일스톤 확인 부탁드립니다");
      await vic.click("#projComments .cmt-form > button");
      await vic.waitForSelector("#projComments .cmt");
      await alice.goto(`${BASE}/#/`);
      await alice.waitForSelector("#myTasks .inbox-item");
      assert((await alice.textContent("#myTasks")).includes("마일스톤 확인"), "멘션이 내 할 일에 없음");
    });
    await step("학습 센터: 모든 따라하기 대상 요소가 화면에 있음", async () => {
      const tours = await alice.evaluate(() => ALL_LESSONS.flatMap((l) => l.steps.filter((x) => x.type === "tour").map((t) => ({ id: l.id, tab: t.tab, sels: t.steps.map((x) => x.sel) }))));
      assert(tours.length >= 10, "따라하기가 너무 적음");
      const missing = [];
      for (const t of tours) {
        await alice.evaluate((id) => { const L = ALL_LESSONS.find((l) => l.id === id); startTour(L.steps.find((x) => x.type === "tour"), null); }, t.id);
        await alice.waitForSelector(".tour-pop", { timeout: 15000 });
        await alice.waitForTimeout(600);
        for (const sel of t.sels) {
          const ok = await alice.evaluate((sel) => sel.split(",").some((x) => document.querySelector(x.trim())), sel);
          if (!ok) missing.push(`${t.id}(${t.tab}): ${sel}`);
        }
        await alice.evaluate(() => endTour(false));
      }
      assert(!missing.length, "찾지 못한 요소: " + missing.join(" | "));
    });
    await step("휴대폰 화면", async () => {
      const m = await login(browser, "vic", { width: 390, height: 844 });
      await m.goto(`${BASE}/#/p/${uid}/overview`); await m.waitForSelector(".sit");
      const w = await m.evaluate(() => document.documentElement.scrollWidth);
      const wide = await m.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > 392 && getComputedStyle(e).position !== "fixed").slice(0, 5).map((e) => e.tagName + "." + e.className + "#" + e.id + ":" + Math.round(e.getBoundingClientRect().right)));
      assert(w <= 400, `가로 스크롤 발생 (${w}px): ${wide.join(", ")}`);
      await shot(m, "05_mobile");
    });
  } finally {
    await browser.close();
    srv.kill();
  }
  fs.writeFileSync(path.join(OUT, "axe.txt"), axeFindings.join("\n") + "\n");
  console.log(results.join("\n"));
  console.log(`\n접근성 참고 항목 ${axeFindings.length}건 → ${path.join(OUT, "axe.txt")}`);
  console.log(failed ? `\n실패 ${failed}건` : "\n모두 통과");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
