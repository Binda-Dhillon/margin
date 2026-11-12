import puppeteer from "puppeteer-core";

export const BASE = process.env.MARGIN_URL ?? "http://localhost:8787";
export const SHOTS = process.env.SHOTS ?? "/tmp/shots";

export async function launch() {
  return puppeteer.launch({
    executablePath: process.env.CHROME ?? "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1600,900", "--force-device-scale-factor=1"],
  });
}

/** A fresh, isolated browser profile: one per simulated person/device. */
export async function person(browser, name) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[${name}] console: ${m.text()}`);
  });
  page.errors = errors;
  page.who = name;
  return page;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function signUp(page, name, email, password = "correct-horse-7!") {
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await page.waitForSelector("#auth-email");
  if (!(await page.$("#auth-name"))) await clickText(page, "button[role=tab]", "Sign up");
  await page.type("#auth-name", name);
  await page.type("#auth-email", email);
  await page.type("#auth-password", password);
  await page.click("button[type=submit]");
  await page.waitForSelector("[data-testid=canvas]", { timeout: 30000 });
}

export async function logIn(page, email, password = "correct-horse-7!") {
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await page.waitForSelector("#auth-email");
  await clickText(page, "button[role=tab]", "Log in");
  await page.type("#auth-email", email);
  await page.type("#auth-password", password);
  await page.click("button[type=submit]");
  await page.waitForSelector("[data-testid=canvas]", { timeout: 30000 });
}

export async function clickText(page, selector, text, opts = {}) {
  const handle = await page.waitForFunction(
    (sel, t) => [...document.querySelectorAll(sel)].find((el) => el.textContent.trim().includes(t) && el.offsetParent !== null),
    { timeout: opts.timeout ?? 8000 },
    selector,
    text,
  );
  await handle.asElement().click();
}

export async function hasText(page, text) {
  return page.evaluate((t) => document.body.innerText.includes(t), text);
}

export async function waitText(page, text, timeout = 10000) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
}

export async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Waits until every space has been pushed to the server. */
export async function synced(page) {
  await page.evaluate(async () => {
    const m = window.__margin;
    await m.flush();
    await m.syncAll();
  });
  await page.waitForFunction(
    () => {
      const s = window.__margin.useApp.getState();
      return Object.values(s.spaces).every((sp) => sp.loaded && !sp.syncing && !sp.pending);
    },
    { timeout: 20000 },
  );
}

export const state = (page, fn) => page.evaluate(`(${fn})(window.__margin.useApp.getState())`);

let failures = 0;
export function check(label, ok, detail = "") {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label} ${detail}`);
  }
}
export const failed = () => failures;
