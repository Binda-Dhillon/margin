import { launch, person, signUp, shot, sleep, clickText, check, failed, synced, state, waitText, hasText } from "./lib.mjs";
const browser = await launch();
const stamp = Date.now();
const a = await person(browser, "amara");
const M = (fn, ...args) => a.evaluate(fn, ...args);

try {
  await signUp(a, "Amara Okafor", `ao${stamp}@student.uni.ac.uk`);

  // ---------------------------------------------------------- onboarding
  check("first-use tip is shown", await hasText(a, "Start here"));
  for (let i = 0; i < 3; i++) { await clickText(a, "[data-testid=coachmark] button", "Next"); await sleep(150); }
  check("tour reaches tip 4 of 4", await hasText(a, "Tip 4 of 4"));
  await shot(a, "02c-tip-4");
  await clickText(a, "[data-testid=coachmark] button", "Done");
  check("tour ends", !(await a.$("[data-testid=coachmark]")));
  check("checklist starts at 1 of 4", (await a.$eval("[data-testid=checklist]", (el) => el.innerText)).includes("1 of 4"));
  // tooltip reveals the shortcut
  await a.hover("[data-tool=note]");
  await a.waitForSelector(".tooltip", { timeout: 4000 });
  check("hovering a tool shows its shortcut", (await a.$eval(".tooltip", (el) => el.innerText)).includes("N"));
  await a.mouse.move(800, 500);

  // ---------------------------------------------------------- seed content
  await clickText(a, "aside button", "New group");
  await a.type("#prompt-input", "Group poster");
  await a.keyboard.press("Enter");
  await a.waitForSelector("[data-testid=board]", { timeout: 20000 });
  const ids = await M(() => {
    const m = window.__margin;
    const st = () => m.useApp.getState();
    const p = `u:${st().user.id}`;
    const g = `g:${st().groups[0].id}`;
    const lectures = m.createFolder("Lectures");
    const readings = m.createFolder("Readings");
    const mk = (title, space, folder, body, color) => m.createNote("text", { title, space, folder, body, open: false, meta: color ? { color } : {} });
    const n = {
      l4: mk("Lecture 4 · Surveys", p, lectures, "Question wording and response bias. #methods"),
      l5: mk("Lecture 5 · Experiments", p, lectures, "Independent and repeated measures designs. #methods"),
      l6: mk("Lecture 6 · Sampling", p, lectures, "# Sampling methods\n\n## Probability sampling\n\n- Simple random: every member of the population has an equal chance of selection.\n- Stratified: split the population into groups, then sample randomly from each group.\n\n#methods #exam"),
      l7: mk("Lecture 7 · Ethics", p, lectures, "Informed consent, right to withdraw, debriefing. #ethics"),
      cool: mk("Coolican ch. 3", p, readings, "Sampling chapter notes.", "yellow"),
      mo: mk("Mueller & Oppenheimer", p, readings, "The pen is mightier than the keyboard. Handwritten notes and recall.", "yellow"),
      field: mk("Field (2018)", p, readings, "Statistics reference for the results section.", "yellow"),
      rl: mk("Reading list", p, readings, "Coolican (2019) ch. 3\n\nMueller & Oppenheimer (2014)\n\nField (2018) ch. 2", "yellow"),
      plan: mk("Group project plan", g, null, "Who does what before Friday. #poster", "blue"),
      methods: mk("Methods section draft", g, null, "# Methods\n\n### Participants\n\nForty second-year Psychology students will be recruited by opportunity sampling from Research Methods II lectures. All participants will give informed consent and can withdraw at any time.\n\n### Design\n\nAn independent-measures design will be used. Participants will be randomly allocated to a handwritten or a typed note-taking condition (n = 20 per group).\n\n### Procedure\n\nBoth groups will watch the same 15-minute recorded lecture and take notes in their allocated condition. One week later they will complete a 20-item recall quiz. #methods", "blue"),
      template: mk("Poster template", g, null, "A1 portrait, three columns. #poster", "blue"),
      results: mk("Results mock graphs", g, null, "Bar chart of mean recall by condition.", "blue"),
      ethics: mk("Ethics form draft", g, null, "Draft answers for the departmental ethics form. #ethics", "blue"),
    };
    m.linkNotes(n.l4, n.l5); m.linkNotes(n.l5, n.l6); m.linkNotes(n.l6, n.l7); m.linkNotes(n.l6, n.cool);
    m.linkNotes(n.mo, n.cool); m.linkNotes(n.field, n.mo); m.linkNotes(n.rl, n.cool);
    m.linkNotes(n.plan, n.methods); m.linkNotes(n.plan, n.template); m.linkNotes(n.results, n.methods);
    m.linkNotes(n.l6, n.methods, "view"); m.linkNotes(n.mo, n.methods, "view");
    return { ...n, p, g };
  });
  // a drawing made with the real tool, in the group
  await M((g) => window.__margin.createNote("drawing", { title: "Study design sketch", space: g }), ids.g);
  await a.waitForSelector(".excalidraw canvas.interactive", { timeout: 30000 });
  await sleep(900);
  const host = await (await a.$("[data-testid=drawing-host]")).boundingBox();
  const cx = host.x + host.width / 2 + 60, cy = host.y + host.height / 2;
  const rect = async (x, y, w, h, label) => {
    await a.keyboard.press("r");
    await a.mouse.move(x, y); await a.mouse.down(); await a.mouse.move(x + w, y + h, { steps: 6 }); await a.mouse.up();
    await a.keyboard.press("Enter"); await a.keyboard.type(label); await a.keyboard.press("Escape"); await a.keyboard.press("Escape");
  };
  await a.mouse.click(cx, cy + 150);
  await rect(cx - 110, cy - 190, 220, 54, "40 Psychology students");
  await rect(cx - 100, cy - 90, 200, 54, "Random allocation");
  await rect(cx - 250, cy + 20, 200, 54, "Handwritten (n=20)");
  await rect(cx + 50, cy + 20, 200, 54, "Typed (n=20)");
  await sleep(1200);
  const sketch = await state(a, (s) => Object.entries(s.notes).find(([, n]) => n.meta.type === "drawing")[0]);
  await M((ids, sketch) => { const m = window.__margin; m.linkNotes(sketch, ids.methods); m.linkNotes(sketch, ids.plan); m.linkNotes(ids.l6, sketch, "view"); m.linkNotes(ids.mo, sketch, "view"); m.setPreview(ids.methods, sketch.split("/")[1]); }, ids, sketch);
  await sleep(600);
  await shot(a, "04b-drawing-scene");
  await synced(a);

  // ---------------------------------------------------------- graph view (Screen 6)
  await a.keyboard.press("Escape");
  await a.click("[data-tool=graph]");
  await a.waitForSelector("[data-testid=graph-view] [data-node]");
  await sleep(500);
  const nodes = await a.$$eval("[data-node]", (els) => els.length);
  const edges = await a.$$eval("[data-testid=graph-view] svg line", (els) => els.length);
  check("graph shows every note as a node", nodes === 14, String(nodes));
  check("graph draws the links", edges === 16, String(edges));
  await a.click(`[data-node="${sketch}"]`);
  await a.waitForSelector("[data-testid=graph-preview]");
  const pv = await a.$eval("[data-testid=graph-preview]", (el) => el.innerText);
  check("selecting a node lists its linked notes", pv.includes("Study design sketch") && pv.includes("LINKED WITH 4 NOTES") && pv.includes("Methods section draft"), pv);
  await a.waitForFunction(() => document.querySelector("[data-testid=graph-preview] img"), { timeout: 15000 }).catch(() => {});
  await sleep(300);
  await shot(a, "06-graph");
  const dimmed = await a.$$eval("[data-node]", (els) => els.filter((e) => e.getAttribute("opacity") === "0.38").length);
  check("depth filter dims notes further away", dimmed > 0 && dimmed < nodes, String(dimmed));
  await a.evaluate(() => [...document.querySelectorAll("[role=radio]")].find((b) => b.textContent === "All").click());
  await sleep(150);
  check("depth All shows everything at full strength", (await a.$$eval("[data-node]", (els) => els.filter((e) => e.getAttribute("opacity") === "0.38").length)) === 0);
  await a.evaluate(() => document.querySelector('[role=switch][aria-label="Show unlinked notes"]').click());
  await sleep(300);
  check("unlinked notes can be hidden", (await a.$$eval("[data-node]", (els) => els.length)) === 13);
  await a.evaluate(() => document.querySelector('[role=switch][aria-label="Show unlinked notes"]').click());
  await a.evaluate(() => [...document.querySelectorAll("aside label")].find((l) => l.innerText.trim() === "Readings").click());
  await sleep(300);
  check("folder filter removes that folder's notes", (await a.$$eval("[data-node]", (els) => els.length)) === 10, String(await a.$$eval("[data-node]", (els) => els.length)));
  await a.evaluate(() => [...document.querySelectorAll("aside label")].find((l) => l.innerText.trim() === "Readings").click());
  await clickText(a, "[data-testid=graph-view] aside button", "#ethics");
  await sleep(300);
  check("tag filter keeps only tagged notes", (await a.$$eval("[data-node]", (els) => els.length)) === 2);
  await clickText(a, "[data-testid=graph-view] aside button", "#ethics");
  await clickText(a, "[data-testid=graph-preview] button", "Open note");
  await a.waitForSelector(`[data-window="${sketch}"]`);
  check("Open note from the graph opens it on the canvas", true);

  // ---------------------------------------------------------- board for the daily note
  const today = new Date(); const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  await M((g, due, sketchId, ids) => {
    const m = window.__margin; const me = m.useApp.getState().user.id;
    const c1 = m.addCard(g, "todo", "Write ethics section"); m.patchCard(g, c1, { label: "Ethics", assignee: me, due });
    const c2 = m.addCard(g, "todo", "Book poster printing"); m.patchCard(g, c2, { label: "Admin", assignee: me, due });
    const c3 = m.addCard(g, "doing", "Methods section draft"); m.patchCard(g, c3, { label: "Writing", assignee: me, notes: [ids.methods.split("/")[1]], checklist: [{ id: "a", text: "Participants", done: true }, { id: "b", text: "Design", done: true }, { id: "c", text: "Procedure", done: false }, { id: "d", text: "Analysis", done: false }] });
    const c4 = m.addCard(g, "review", "Study design diagram"); m.patchCard(g, c4, { label: "Design", notes: [sketchId] });
    const c5 = m.addCard(g, "done", "Choose research question"); m.patchCard(g, c5, { assignee: me });
  }, ids.g, iso(new Date(today.getTime() + 2 * 86400000)), sketch.split("/")[1], ids);
  await a.keyboard.press("b");
  await a.waitForSelector("[data-testid=board] [data-card]");
  await a.waitForFunction(() => document.querySelector("[data-card] img"), { timeout: 15000 }).catch(() => {});
  await sleep(400);
  check("board card shows its linked sketch as a thumbnail", !!(await a.$("[data-card] img")));
  check("board card shows checklist progress", await hasText(a, "2/4"));
  await shot(a, "07-board");

  // ---------------------------------------------------------- daily note
  await a.keyboard.press("t");
  await a.waitForSelector("[data-testid=daily-view]");
  check("daily note greets by first name", /Good (morning|afternoon|evening), Amara/.test(await a.$eval("[data-testid=daily-view]", (el) => el.innerText)));
  const dailyText = await a.$eval("[data-testid=daily-view]", (el) => el.innerText);
  check("daily note pulls due cards from the group board", dailyText.includes("Write ethics section") && dailyText.includes("Book poster printing") && dailyText.includes("Two things from your boards are due this week"), dailyText.slice(0, 400));
  await clickText(a, "[data-testid=daily-view] aside button", "Blank");
  await clickText(a, "[role=menuitem]", "Study day");
  await sleep(300);
  check("template fills the plan", (await a.$$("[data-testid=plan] input[type=checkbox]")).length === 3);
  await a.type('input[aria-label="Add something to the plan"]', "Write methods section · 45 min in Focus");
  await a.keyboard.press("Enter");
  await a.click("[data-testid=plan] input[type=checkbox]");
  await a.type('input[aria-label="Type a quick thought"]', "Ask Dr Shaw if we need consent forms for the recall quiz");
  await a.keyboard.press("Enter");
  await sleep(200);
  await clickText(a, "[data-testid=voice-note] button", "Add to plan");
  await clickText(a, "[role=radio]", "Okay");
  await sleep(900);
  const daily = await state(a, (s) => Object.values(s.notes).find((n) => n.meta.type === "daily"));
  check("daily note saved as a dated Markdown file", daily.path === `daily/${iso(today)}.md` && daily.body.includes("- [x] Review yesterday’s notes") && daily.body.includes("- [ ] Ask Dr Shaw"), daily.path + " " + daily.body);
  check("mood check-in and quick thought stored", daily.meta.mood === "okay" && daily.meta.voiceNotes.length === 1 && daily.meta.template === "study");
  await shot(a, "11-daily");

  // ---------------------------------------------------------- settings (Screen 10)
  await a.click('button[aria-label="Settings"]');
  await a.waitForSelector("[data-testid=settings]");
  await a.focus('[role=slider][aria-label="Text size"]');
  for (let i = 0; i < 5; i++) await a.keyboard.press("ArrowRight");
  await sleep(200);
  check("text size slider changes the size", (await a.$eval("[data-testid=text-size-value]", (el) => el.innerText)) === "20 px");
  check("text size applies to the whole interface live", (await a.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--text-size").trim())) === "20");
  await a.click("[data-testid=font-picker]");
  await a.type('input[aria-label="Search fonts"]', "lex");
  await sleep(200);
  const fontList = await a.$$eval("[role=listbox][aria-label=Fonts] [role=option]", (els) => els.map((e) => e.innerText.split("\n")[0]));
  check("font search narrows the list", fontList.join("|") === "Lexend|OpenDyslexic", fontList.join("|"));
  await shot(a, "10-settings");
  await clickText(a, "[role=option]", "Lexend");
  check("font applies", (await a.evaluate(() => getComputedStyle(document.body).fontFamily)).includes("Lexend"));
  await a.evaluate(() => document.querySelector('[role=switch][aria-label="High contrast"]').click());
  await a.evaluate(() => document.querySelector('[role=switch][aria-label="Reduce motion"]').click());
  await clickText(a, "[role=radio]", "Dark");
  await sleep(200);
  check("theme, contrast and motion settings apply", await a.evaluate(() => { const c = document.documentElement.classList; return c.contains("dark") && c.contains("hc") && c.contains("reduce-motion"); }));
  await a.click('button[aria-label="Blue"]');
  check("primary colour applies", (await a.evaluate(() => document.documentElement.style.getPropertyValue("--accent"))) === "#1f6f9c");
  // a custom colour that is too light is refused
  await a.$eval('input[aria-label="Custom primary colour"]', (el) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, "#ffe680"); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
  await sleep(200);
  check("custom colours that would make text unreadable are refused", (await hasText(a, "too light for readable text")) && (await a.evaluate(() => document.documentElement.style.getPropertyValue("--accent"))) === "#1f6f9c");
  await shot(a, "10b-settings-dark");
  await clickText(a, "[data-testid=settings] nav button", "Focus & well-being");
  await a.evaluate(() => document.querySelector('[role=switch][aria-label="Quiet hours"]').click());
  await a.evaluate(() => document.querySelector('[role=switch][aria-label="Weekly summary"]').click());
  await a.select('select[aria-label="Focus session length"]', "25");
  await sleep(300);
  await clickText(a, "[data-testid=settings] nav button", "Shortcuts");
  check("shortcuts are listed", await hasText(a, "Find inside the open note"));
  await clickText(a, "[data-testid=settings] nav button", "Account");
  await waitText(a, "Your folders as plain git");
  await a.keyboard.press("Escape");
  await synced(a);
  const settingsFile = JSON.parse(await M((p) => window.__margin.repoFor(p).read(".margin/settings.json"), ids.p));
  check("settings are saved in the personal space and so follow the user between devices", settingsFile.textSize === 20 && settingsFile.theme === "dark" && settingsFile.font === "Lexend" && settingsFile.quietHours.on === true, JSON.stringify(settingsFile));
  check("weekly summary appears in the daily note when switched on", !!(await a.$("[data-testid=week-summary]")));

  // back to defaults for the remaining screenshots, keep dark for focus (Screen 9)
  await M(() => window.__margin.updateSettings({ textSize: 15, font: "Inter", highContrast: false, reduceMotion: false, accent: "#2d6a5f", quietHours: { on: false, from: "22:00", to: "08:00" } }));

  // ---------------------------------------------------------- focus mode (Screen 9)
  await M((uid) => window.__margin.openNote(uid), ids.methods);
  await a.waitForSelector(`[data-window="${ids.methods}"] .ProseMirror`);
  await a.click(`[data-window="${ids.methods}"] .ProseMirror`);
  await a.keyboard.down("Shift"); await a.keyboard.press("F"); await a.keyboard.up("Shift");
  // typing Shift+F inside the editor must type an F, not start focus
  check("shortcuts do not fire while typing in a note", !(await a.$("[data-testid=focus-mode]")));
  await a.keyboard.press("Backspace");
  await clickText(a, "button[data-tool=focus]", "Focus");
  await a.waitForSelector("[data-testid=focus-mode]");
  await sleep(400);
  check("focus mode hides the toolbar and sidebar", !(await a.$("header nav[aria-label=Tools]")) && !(await a.$("aside")));
  check("focus timer counts down from the session length", /2[45]:\d\d left/.test(await a.$eval("[data-testid=focus-timer]", (el) => el.innerText)), await a.$eval("[data-testid=focus-timer]", (el) => el.innerText));
  check("notifications are shown as paused", await hasText(a, "Notifications paused until"));
  await a.click("[data-testid=focus-mode] .ProseMirror");
  await a.keyboard.down("Control"); await a.keyboard.press("End"); await a.keyboard.up("Control");
  await a.keyboard.type(" Written in focus.");
  await sleep(500);
  check("the note can be edited in focus mode", (await state(a, `(s) => s.notes[${JSON.stringify(ids.methods)}].body`)).includes("Written in focus."));
  // Ctrl+F in focus searches the focused note
  await a.keyboard.down("Control"); await a.keyboard.press("f"); await a.keyboard.up("Control");
  await a.waitForSelector("[data-testid=find-bar]");
  await a.keyboard.type("recall");
  await sleep(200);
  check("Ctrl+F works inside focus mode", /1 of \d/.test(await a.$eval("[data-testid=find-count]", (el) => el.innerText)));
  await a.keyboard.press("Escape");
  await sleep(200);
  check("first Esc closes find, not focus", !(await a.$("[data-testid=find-bar]")) && !!(await a.$("[data-testid=focus-mode]")));
  // a notification arriving now is held
  await M(() => { const s = window.__margin.useApp.getState(); });
  // jump to the end of the session
  await M(() => { const m = window.__margin; const f = m.useApp.getState().focus; m.setFocus({ ...f, endsAt: Date.now() + 700 }); });
  await a.waitForSelector("[data-testid=break-card]", { timeout: 6000 });
  check("a break is suggested when the session ends", (await a.$eval("[data-testid=break-card]", (el) => el.innerText)).includes("Time for a 5-minute break"));
  check("timer shows the finished session", (await a.$eval("[data-testid=focus-timer]", (el) => el.innerText)).includes("0:00 left"));
  await sleep(300);
  await shot(a, "09-focus");
  await clickText(a, "[data-testid=break-card] button", "Start break");
  await sleep(700);
  check("break countdown runs", /Break · [45]:\d\d left/.test(await a.$eval("[data-testid=focus-timer]", (el) => el.innerText)), await a.$eval("[data-testid=focus-timer]", (el) => el.innerText));
  await a.keyboard.press("Escape");
  await sleep(300);
  check("Esc leaves focus mode", !(await a.$("[data-testid=focus-mode]")));
  check("the note window shows what was written in focus", await a.evaluate((uid) => document.querySelector(`[data-window="${uid}"] .ProseMirror`).innerText.includes("Written in focus."), ids.methods));
  const dailyAfter = await state(a, (s) => Object.values(s.notes).find((n) => n.meta.type === "daily").meta.focusMinutes);
  check("finished focus time is logged for the weekly summary", dailyAfter === 25, String(dailyAfter));

  // ---------------------------------------------------------- Screen 8 composition, light theme
  await M(() => window.__margin.updateSettings({ theme: "light" }));
  await M((ids) => { const m = window.__margin; m.openNote(ids.l6); }, ids);
  await sleep(300);
  for (let i = 0; i < 3; i++) { await a.evaluate((keep) => { const w = [...document.querySelectorAll("[data-window]")].find((x) => x.dataset.window !== keep); w?.querySelector('button[aria-label="Minimise"]').click(); }, ids.methods); await sleep(120); }
  await M((ids) => window.__margin.openNote(ids.methods), ids);
  await sleep(400);
  const recentItem = await a.$(`[data-recent="${ids.methods}"]`);
  await recentItem.hover();
  await a.waitForFunction(() => document.querySelector("[data-testid=hover-preview] img"), { timeout: 15000 });
  await sleep(300);
  check("hovering the note in the sidebar shows its preview sketch", (await a.$eval("[data-testid=hover-preview]", (el) => el.dataset.previewKind)) === "sketch");
  await shot(a, "08-hover-preview");
  await a.mouse.move(900, 80);
  await synced(a);
} catch (e) {
  console.log("ERROR", e.stack);
  await shot(a, "part3-error");
}
const errs = a.errors.filter((e) => !e.includes("401") && !e.includes("subsetting"));
console.log(errs.join("\n") || "no console errors");
await browser.close();
process.exit(failed() ? 1 : 0);
