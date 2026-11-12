// Checks Excalidraw's "Mermaid to Excalidraw" import, which uses the pinned
// nanoid and lodash-es versions from the root package.json overrides.
import { launch, person, signUp, sleep, clickText, check, failed, state, shot } from "./lib.mjs";
const browser = await launch();
const a = await person(browser, "amara");
try {
  await signUp(a, "Amara Okafor", `mm${Date.now()}@x.ac.uk`);
  await a.evaluate(() => document.querySelector("[data-testid=coachmark] button")?.click());
  await a.keyboard.press("d");
  await a.waitForSelector(".excalidraw canvas.interactive", { timeout: 30000 });
  await sleep(600);
  await a.keyboard.press("Escape");
  await a.click('.excalidraw [data-testid="toolbar-extra-tools-trigger"], .excalidraw .App-toolbar__extra-tools-trigger').catch(() => {});
  await sleep(300);
  await clickText(a, ".excalidraw [role=menuitem], .excalidraw .dropdown-menu-item", "Mermaid");
  await a.waitForSelector(".excalidraw .ttd-dialog textarea, .excalidraw textarea", { timeout: 10000 });
  await a.evaluate(() => {
    const ta = document.querySelector(".excalidraw .ttd-dialog textarea") ?? document.querySelector(".excalidraw textarea");
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    set.call(ta, "flowchart TD\n  A[Students] --> B{Random allocation}\n  B --> C[Handwritten]\n  B --> D[Typed]");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await a.waitForFunction(() => document.querySelector(".excalidraw .ttd-dialog-output-canvas-container canvas, .excalidraw .ttd-dialog svg"), { timeout: 20000 }).catch(() => {});
  await sleep(1500);
  await shot(a, "mermaid-dialog");
  await clickText(a, ".excalidraw .ttd-dialog button", "Insert");
  await sleep(1500);
  const els = await state(a, (s) => JSON.parse(Object.values(s.notes).find((n) => n.meta.type === "drawing").body).elements.filter((e) => !e.isDeleted));
  const texts = els.filter((e) => e.type === "text").map((e) => e.text);
  check("Mermaid flowchart imports into the drawing", els.length >= 8 && texts.some((t) => t.replace(/\s+/g, "").includes("Randomallocation")), `${els.length} elements: ${texts.join(", ")}`);
  check("imported shapes have unique ids", new Set(els.map((e) => e.id)).size === els.length);
  await shot(a, "mermaid-inserted");
} catch (e) {
  console.log("ERROR", e.message);
  await shot(a, "mermaid-error");
}
console.log(a.errors.filter((e) => !e.includes("401") && !e.includes("subsetting")).join("\n") || "no console errors");
await browser.close();
process.exit(failed() ? 1 : 0);
