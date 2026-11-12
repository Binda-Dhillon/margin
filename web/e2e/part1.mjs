import { launch, person, signUp, shot, sleep, clickText, check, failed, synced, state, waitText, hasText } from "./lib.mjs";
const browser = await launch();
const stamp = Date.now();
const a = await person(browser, "amara");
try {
  await signUp(a, "Amara Okafor", `ao${stamp}@student.uni.ac.uk`);
  // Skip the tour.
  await clickText(a, "[data-testid=coachmark] button", "Skip tips");
  check("coachmark closes", !(await a.$("[data-testid=coachmark]")));

  // --- folder + text note (Screen 3)
  await a.click("[data-tool=folder]");
  await a.waitForSelector("#prompt-input");
  await a.type("#prompt-input", "Lectures");
  await a.keyboard.press("Enter");
  await waitText(a, "No notes here yet");
  await a.keyboard.press("n");
  await a.waitForSelector("[data-window] .ProseMirror");
  await sleep(200);
  await a.keyboard.type("Lecture 6 · Sampling methods");
  await a.keyboard.press("Enter");
  await a.click("[data-window] .ProseMirror");
  await a.keyboard.type("# Sampling methods\nResearch Methods II · Dr Shaw · Tue 3 Nov\n## Probability sampling\n- Simple random: every member of the population has an equal chance of selection.\nStratified: split the population into groups, then sample randomly from each group.\n\n\n## Non-probability sampling\n- Opportunity: whoever is available. Quick, but likely to be biased.\nSnowball: participants recruit others. Useful for hard-to-reach groups.\n\n\n[ ] Read Coolican ch. 3\nDecide sampling method for the group poster", { delay: 2 });
  await sleep(1200);
  const n1 = await state(a, (s) => Object.values(s.notes).find((n) => n.meta.title.startsWith("Lecture 6")));
  check("text note created with title", !!n1, JSON.stringify(await state(a, (s) => Object.values(s.notes).map((n) => n.meta.title))));
  check("note is filed in the selected folder", !!n1?.meta.folder);
  check("markdown stored", n1?.body.includes("## Probability sampling") && n1?.body.includes("- [ ] Read Coolican"), n1?.body);
  check("edited-by recorded", n1?.meta.updatedByName === "Amara Okafor");
  await synced(a);
  check("last saved shown", await hasText(a, "Last saved"));
  await shot(a, "03-text-note");

  // --- drawing (Screen 4)
  await a.keyboard.press("Escape");
  await a.click("[data-testid=canvas]", { offset: { x: 5, y: 5 } });
  await a.keyboard.press("d");
  await a.waitForSelector("[data-window][data-note-type=drawing]");
  await sleep(200);
  await a.keyboard.type("Study design sketch");
  await a.keyboard.press("Enter");
  await a.waitForSelector(".excalidraw canvas.interactive", { timeout: 30000 });
  await sleep(800);
  const box = await (await a.$("[data-testid=drawing-host]")).boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  // rectangle tool, drag out a box, then type a label inside it
  await a.mouse.click(cx, cy);
  await a.keyboard.press("r");
  await a.mouse.move(cx - 120, cy - 60);
  await a.mouse.down();
  await a.mouse.move(cx + 120, cy + 20, { steps: 8 });
  await a.mouse.up();
  await a.keyboard.press("Enter");
  await a.keyboard.type("Random allocation");
  await a.keyboard.press("Escape");
  await sleep(1500);
  const d1 = await state(a, (s) => Object.values(s.notes).find((n) => n.meta.type === "drawing"));
  const els = JSON.parse(d1.body).elements.filter((e) => !e.isDeleted);
  check("drawing saved as .excalidraw with elements", d1.path.endsWith(".excalidraw") && els.some((e) => e.type === "rectangle") && els.some((e) => e.type === "text"), JSON.stringify(els.map((e) => e.type)));
  check("native Excalidraw toolbar present", !!(await a.$(".excalidraw .App-toolbar")));
  await shot(a, "04-drawing");

  // --- link the note to the sketch (Screen 5), set as preview (Screen 8)
  await a.click(`[data-window="${n1.space}/${n1.meta.id}"] .window-head`, { offset: { x: 300, y: 20 } });
  await sleep(200);
  await a.keyboard.press("Escape");
  await a.click("[data-tool=link]");
  await a.waitForSelector("[data-link-row]");
  await shot(a, "05-link-dialog");
  await clickText(a, "[data-link-row] button", "Link");
  await waitText(a, "Linked");
  await clickText(a, "button", "Done");
  const linked = await state(a, (s) => Object.values(s.notes).find((n) => n.meta.title.startsWith("Lecture 6")).meta.links);
  check("link stored on the note", linked.length === 1);
  await a.waitForSelector("[data-link-chip]");
  await a.click("[data-link-chip]");
  await clickText(a, "[role=menuitem]", "Show as preview");
  await sleep(300);
  await shot(a, "08a-link-menu");
  await a.keyboard.press("Escape");
  const preview = await state(a, (s) => Object.values(s.notes).find((n) => n.meta.title.startsWith("Lecture 6")).meta.preview);
  check("sketch set as hover preview", !!preview);

  // second plain note for the text fallback
  await a.click("[data-testid=canvas]", { offset: { x: 5, y: 5 } });
  await a.keyboard.press("n");
  await sleep(300);
  await a.keyboard.type("Reading list");
  await a.keyboard.press("Enter");
  await a.keyboard.type("Coolican (2019) ch. 3, Sampling\nMueller & Oppenheimer (2014)\nField (2018) ch. 2\n" + "More reading line\n".repeat(14), { delay: 1 });
  await sleep(900);
  // minimise both text notes (dock)
  for (let i = 0; i < 2; i++) {
    await a.evaluate(() => document.querySelector('[data-window][data-note-type=text] button[aria-label="Minimise"]')?.click());
    await sleep(150);
  }
  await sleep(300);
  check("dock shows minimised notes", (await a.$$("[data-dock]")).length === 2);

  // hover the note with a sketch preview
  const dockSketch = await a.$(`[data-dock="${n1.space}/${n1.meta.id}"]`);
  await dockSketch.hover();
  await a.waitForSelector("[data-testid=hover-preview]", { timeout: 5000 });
  await a.waitForFunction(() => document.querySelector("[data-testid=hover-preview] img"), { timeout: 20000 });
  check("hover shows the linked sketch", (await a.$eval("[data-testid=hover-preview]", (el) => el.dataset.previewKind)) === "sketch");
  await sleep(400);
  await shot(a, "08b-hover-sketch");
  await a.mouse.move(700, 300);
  await sleep(500);
  const other = (await a.$$("[data-dock]"))[1];
  await other.hover();
  await a.waitForSelector("[data-testid=hover-preview]", { timeout: 5000 });
  const kind = await a.$eval("[data-testid=hover-preview]", (el) => el.dataset.previewKind);
  check("hover falls back to a mini window of the note", kind === "text");
  const scrollable = await a.$eval("[data-testid=hover-preview] .prose", (el) => el.scrollHeight > el.clientHeight);
  check("mini window scrolls", scrollable);
  // move into the popover and scroll it
  const pv = await (await a.$("[data-testid=hover-preview] .prose")).boundingBox();
  await a.mouse.move(pv.x + 40, pv.y + 40, { steps: 6 });
  await a.mouse.wheel({ deltaY: 200 });
  await sleep(300);
  const scrolled = await a.$eval("[data-testid=hover-preview] .prose", (el) => el.scrollTop);
  check("mini window can be scrolled with the pointer over it", scrolled > 0, String(scrolled));
  await shot(a, "08c-hover-text");
  await a.mouse.move(700, 300);
  await sleep(400);

  // --- search: Ctrl+F on the main window searches all notes
  await a.click("[data-testid=canvas]", { offset: { x: 5, y: 5 } });
  await a.keyboard.down("Control"); await a.keyboard.press("f"); await a.keyboard.up("Control");
  await sleep(200);
  check("Ctrl+F on the main window focuses note search", await a.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Search notes"));
  await a.keyboard.type("stratified");
  await a.waitForSelector("[data-testid=search-results] [role=option]");
  const hit = await a.$eval("[data-testid=search-results]", (el) => el.innerText);
  check("search finds text inside a note", hit.includes("Lecture 6"), hit);
  await shot(a, "search-global");
  await a.keyboard.press("Enter");
  await a.waitForSelector(`[data-window="${n1.space}/${n1.meta.id}"]`);
  check("Enter opens the result", true);

  // --- Ctrl+F inside a note searches within it
  await a.click(`[data-window="${n1.space}/${n1.meta.id}"] .ProseMirror`);
  await a.keyboard.down("Control"); await a.keyboard.press("f"); await a.keyboard.up("Control");
  await a.waitForSelector("[data-testid=find-bar]");
  await a.keyboard.type("sampling");
  await sleep(300);
  const count = await a.$eval("[data-testid=find-count]", (el) => el.textContent);
  check("Ctrl+F in a note finds matches in that note", /^1 of \d+/.test(count), count);
  const marks = await a.$$eval(".find-hit, .find-hit-current", (els) => els.length);
  check("matches highlighted in the text", marks >= 3, String(marks));
  await a.keyboard.press("Enter");
  await sleep(150);
  check("Enter moves to the next match", (await a.$eval("[data-testid=find-count]", (el) => el.textContent)).startsWith("2 of"));
  await shot(a, "search-in-note");
  await a.keyboard.press("Escape");
  await sleep(200);
  check("Esc closes the find bar", !(await a.$("[data-testid=find-bar]")));

  // --- reload: everything is still there from this device's folder
  await synced(a);
  await a.reload({ waitUntil: "networkidle2" });
  await a.waitForSelector("[data-testid=canvas]");
  await sleep(800);
  const titles = await state(a, (s) => Object.values(s.notes).map((n) => n.meta.title).sort());
  check("notes survive a reload", titles.length === 3, JSON.stringify(titles));
  check("windows restored after reload", (await a.$$("[data-window]")).length >= 1);
} catch (e) {
  console.log("ERROR", e.stack);
  await shot(a, "part1-error");
}
console.log(a.errors.filter((e) => !e.includes("401")).join("\n") || "no console errors");
await browser.close();
process.exit(failed() ? 1 : 0);
