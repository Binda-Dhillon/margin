import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launch, person, signUp, shot, sleep, clickText, check, failed, synced, state, waitText, hasText, BASE } from "./lib.mjs";

const browser = await launch();
const stamp = Date.now();
const a = await person(browser, "amara");
const s = await person(browser, "sanjay");
const emailA = `ao${stamp}@student.uni.ac.uk`;
const emailS = `sm${stamp}@student.uni.ac.uk`;

const noteByTitle = (page, title) => state(page, `(st) => { const e = Object.entries(st.notes).find(([, n]) => n.meta.title === ${JSON.stringify(title)}); return e ? { uid: e[0], ...e[1] } : null; }`);
const both = async () => { await synced(a); await synced(s); await synced(a); await sleep(300); };
const skipTips = (p) => p.evaluate(() => document.querySelector("[data-testid=coachmark] button")?.click());

try {
  await signUp(a, "Amara Okafor", emailA);
  await signUp(s, "Sanjay Mehta", emailS);
  await skipTips(a); await skipTips(s);

  // ---------------------------------------------------- group + invite
  await clickText(a, "aside button", "New group");
  await a.waitForSelector("#prompt-input");
  await a.type("#prompt-input", "Group poster");
  await a.keyboard.press("Enter");
  await a.waitForSelector("[data-testid=board]", { timeout: 20000 });
  check("group created and board shown", await hasText(a, "Group poster"));
  await clickText(a, "button", "Invite");
  await a.waitForSelector("#invite-email");
  await a.type("#invite-email", emailS);
  await clickText(a, "[role=dialog] button", "Add");
  await waitText(a, "now appears in their sidebar");
  await a.keyboard.press("Escape");
  await s.waitForFunction(() => document.body.innerText.includes("added you to a group"), { timeout: 15000 });
  check("invited member is told live", await hasText(s, "Amara Okafor added you to a group"));
  await shot(s, "02b-added-to-group");
  await clickText(s, "aside button", "Open group");
  await s.waitForSelector("[data-testid=board]", { timeout: 20000 });
  check("member opens the group board", true);

  // ---------------------------------------------------- board cards
  const addCard = async (page, col, title) => {
    await page.click(`[data-add-card="${col}"]`);
    await page.keyboard.type(title);
    await page.keyboard.press("Enter");
    await sleep(200);
    await page.keyboard.press("Escape");
  };
  await addCard(a, "todo", "Write ethics section");
  await addCard(a, "todo", "Book poster printing");
  await addCard(a, "doing", "Study design diagram");
  await clickText(a, "[data-card]", "Write ethics section");
  await a.waitForSelector("#card-label");
  await a.select("#card-label", "Ethics");
  const sanjayId = await state(a, (st) => st.groups[0].members.find((m) => m.name === "Sanjay Mehta").id);
  await a.select("#card-who", sanjayId);
  const due = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await a.$eval("#card-due", (el, v) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); }, due);
  await a.type('input[aria-label="Add a checklist step"]', "Find the ethics form");
  await a.keyboard.press("Enter");
  await clickText(a, "[role=dialog] button", "Done");
  await both();
  check("cards reach the other member", (await s.$$("[data-card]")).length === 3, String((await s.$$("[data-card]")).length));
  check("card shows label, assignee and due date", await s.evaluate(() => { const c = [...document.querySelectorAll("[data-card]")].find((e) => e.innerText.includes("Write ethics section")); return c.innerText.includes("Ethics") && !!c.querySelector(".avatar") && !!c.querySelector(".badge"); }));

  // Sanjay drags "Study design diagram" from Doing to Review
  const card = await (await s.waitForFunction(() => [...document.querySelectorAll("[data-card]")].find((e) => e.innerText.includes("Study design diagram")))).asElement().boundingBox();
  const target = await (await s.$('[data-column="review"]')).boundingBox();
  await s.mouse.move(card.x + 40, card.y + 20);
  await s.mouse.down();
  await s.mouse.move(card.x + 60, card.y + 30, { steps: 4 });
  await s.mouse.move(target.x + target.width / 2, target.y + 120, { steps: 12 });
  await sleep(200);
  await s.mouse.up();
  await sleep(600);
  const moved = await state(s, (st) => Object.values(Object.values(st.boards).find((b) => Object.keys(b.cards).length).cards).find((c) => c.title === "Study design diagram"));
  check("card dragged to Review", moved.column === "review", moved.column);
  await both();
  await a.waitForFunction(() => document.querySelector('[data-column="review"]')?.innerText.includes("Moved here by Sanjay Mehta"), { timeout: 10000 }).catch(() => {});
  check("board shows who moved the card and when", await a.evaluate(() => /Moved here by Sanjay Mehta · \d\d:\d\d/.test(document.querySelector('[data-column="review"]').innerText)));
  // people filter
  await a.click("[data-testid=people-filter]");
  await clickText(a, "[role=menuitem]", "Sanjay Mehta");
  await sleep(300);
  check("people filter narrows the board", (await a.$$("[data-card]")).length === 1);
  await a.click("[data-testid=people-filter]");
  await clickText(a, "[role=menuitem]", "Everyone");

  // ---------------------------------------------------- group note with edited-by
  await clickText(s, "[role=tab]", "Notes");
  await clickText(s, "button", "New group note");
  await s.waitForSelector("[data-window] .ProseMirror");
  await sleep(250);
  await s.keyboard.type("Methods section draft");
  await s.keyboard.press("Enter");
  await s.keyboard.type("# Methods\n### Participants\nForty second-year Psychology students will be recruited by opportunity sampling.\n### Design\nParticipants will be randomly allocated to a handwritten or a typed note-taking condition.", { delay: 1 });
  await sleep(700);
  await both();
  const methodsA = await noteByTitle(a, "Methods section draft");
  check("group note syncs to the other member", !!methodsA && methodsA.space.startsWith("g:"));
  check("group note is marked with who last changed it", methodsA?.meta.updatedByName === "Sanjay Mehta");
  check("a new note does not start with an empty line", methodsA?.body.startsWith("# Methods"), JSON.stringify(methodsA?.body.slice(0, 20)));
  await clickText(a, "[role=tab]", "Notes");
  await a.waitForSelector("[data-testid=group-notes] [data-note-row]");
  check("group list shows 'by Sanjay Mehta' and a time", await a.evaluate(() => /Edited .* by Sanjay Mehta/.test(document.querySelector("[data-testid=group-notes]").innerText)), await a.evaluate(() => document.querySelector("[data-testid=group-notes]").innerText));

  // ---------------------------------------------------- personal vs group separation
  await a.evaluate(() => [...document.querySelectorAll("aside .side-item")].find((b) => b.innerText.includes("My notes")).click());
  await a.waitForSelector("[data-testid=note-list]");
  await clickText(a, "button", "New note");
  await sleep(300);
  await a.keyboard.type("Reading list");
  await a.keyboard.press("Enter");
  await a.keyboard.type("Coolican (2019) ch. 3, Sampling\nMueller & Oppenheimer (2014)", { delay: 1 });
  await sleep(700);
  const readingA = await noteByTitle(a, "Reading list");
  check("personal note lives in the personal space", readingA.space.startsWith("u:"));
  check("typing straight after naming a note loses nothing", readingA.body.startsWith("Coolican (2019)"), JSON.stringify(readingA.body.slice(0, 30)));
  await a.evaluate(() => [...document.querySelectorAll("aside .side-item")].find((b) => b.innerText.includes("My notes")).click());
  await a.waitForSelector("[data-testid=note-list]");
  const personalList = await a.$eval("[data-testid=note-list]", (el) => el.innerText);
  check("personal list has no group notes", personalList.includes("Reading list") && !personalList.includes("Methods section draft"), personalList);
  await both();
  check("the other member cannot see the personal note", !(await noteByTitle(s, "Reading list")));

  // ---------------------------------------------------- link personal -> group, view access
  await a.evaluate((uid) => window.__margin.useApp.getState().windows.length, readingA.uid);
  await clickText(a, "[data-note-row]", "Reading list");
  await a.waitForSelector(`[data-window="${readingA.uid}"]`);
  await a.keyboard.press("Escape");
  await a.click("[data-tool=link]");
  await a.waitForSelector("[data-link-row]");
  await a.type('input[aria-label="Search notes and drawings"]', "Methods");
  await sleep(300);
  check("link dialog explains the personal note needs an access level", await hasText(a, "Choose what Group poster can do with it"));
  await shot(a, "05b-link-access");
  await a.click("[data-access-trigger]");
  await a.waitForSelector("[role=menuitem]");
  check("three access levels offered", (await a.$$eval("[role=menuitem]", (els) => els.map((e) => e.innerText.split("\n")[0]))).join("|") === "Private|Can view|Can edit");
  await clickText(a, "[role=menuitem]", "Can view");
  await clickText(a, "[data-link-row] button", "Link");
  await waitText(a, "Linked");
  await clickText(a, "[role=dialog] button", "Done");
  await sleep(900);
  await both();
  const sharedS = await noteByTitle(s, "Reading list");
  check("view: group member receives the note", !!sharedS && sharedS.meta.sharedAccess === "view" && sharedS.body.includes("Coolican"), JSON.stringify(sharedS?.meta));
  await clickText(s, "aside .side-item", "Group poster");
  await clickText(s, "[role=tab]", "Notes");
  await s.waitForSelector("[data-testid=shared-notes]");
  check("shown as Amara's personal note, view only", await s.evaluate(() => document.querySelector("[data-testid=shared-notes]").innerText.includes("Amara Okafor’s personal note · Can view")));
  await clickText(s, "[data-testid=shared-notes] [data-note-row]", "Reading list");
  await s.waitForSelector(`[data-window="${sharedS.uid}"]`);
  await sleep(300);
  check("view: opens read-only", await s.evaluate((uid) => { const w = document.querySelector(`[data-window="${uid}"]`); return w.innerText.includes("view only") && !w.querySelector(".format-bar") && w.querySelector(".ProseMirror").getAttribute("contenteditable") === "false"; }, sharedS.uid));
  await shot(s, "access-view-only");
  // the group note shows the link
  const methodsS = await noteByTitle(s, "Methods section draft");
  await s.evaluate((uid) => window.__margin.useApp.getState().notes[uid] && null, methodsS.uid);
  check("group note lists the linked personal note", await state(s, `(st) => st.notes[${JSON.stringify(sharedS.uid)}].meta.links.includes(${JSON.stringify(methodsS.meta.id)})`));

  // ---------------------------------------------------- raise to edit
  await a.click(`[data-window="${readingA.uid}"] [data-link-chip]`);
  await clickText(a, "[role=menuitem]", "Can edit");
  await sleep(900);
  await both();
  check("edit: access level reaches the member", (await noteByTitle(s, "Reading list")).meta.sharedAccess === "edit");
  await s.waitForFunction((uid) => document.querySelector(`[data-window="${uid}"] .ProseMirror`)?.getAttribute("contenteditable") === "true", { timeout: 8000 }, sharedS.uid);
  await s.click(`[data-window="${sharedS.uid}"] .ProseMirror`);
  await s.keyboard.down("Control"); await s.keyboard.press("End"); await s.keyboard.up("Control");
  await s.keyboard.type("\nField (2018) ch. 2");
  await sleep(700);
  await both(); await both();
  const readingAfter = await noteByTitle(a, "Reading list");
  check("edit: member's change comes back to the owner's personal note", readingAfter.space.startsWith("u:") && readingAfter.body.includes("Field (2018)"), readingAfter.body);
  check("owner sees who edited it", readingAfter.meta.updatedByName === "Sanjay Mehta");
  check("owner's open editor shows the change", await a.evaluate((uid) => document.querySelector(`[data-window="${uid}"] .ProseMirror`).innerText.includes("Field (2018)"), readingA.uid));

  // ---------------------------------------------------- private
  await a.click(`[data-window="${readingA.uid}"] [data-link-chip]`);
  await clickText(a, "[role=menuitem]", "Private");
  await sleep(900);
  await both();
  const stub = await state(s, `(st) => st.notes[${JSON.stringify(sharedS.uid)}]`);
  check("private: member sees no title or content", stub.meta.title === "Private note" && stub.body === "" && stub.meta.sharedAccess === "private", JSON.stringify(stub.body));
  check("private: the member's window on it is gone or locked", await s.evaluate((uid) => { const w = document.querySelector(`[data-window="${uid}"]`); return !w || w.innerText.includes("Private note"); }, sharedS.uid));
  await a.click(`[data-window="${readingA.uid}"] [data-link-chip]`);
  await clickText(a, "[role=menuitem]", "Can view");
  await sleep(900);
  await both();

  // ---------------------------------------------------- clash: both edit the same line apart
  const openMethods = async (p, uid) => { await p.evaluate((u) => window.__margin.useApp.getState() && document.dispatchEvent(new CustomEvent("x")), uid); await p.evaluate((u) => { const st = window.__margin.useApp; }, uid); };
  await clickText(a, "aside .side-item", "Group poster");
  await clickText(a, "[role=tab]", "Notes");
  await clickText(a, "[data-testid=group-notes] [data-note-row]", "Methods section draft");
  await a.waitForSelector(`[data-window="${methodsA.uid}"] .ProseMirror`);
  await s.setOfflineMode(true);
  await clickText(s, "aside .side-item", "Group poster");
  await clickText(s, "[role=tab]", "Notes");
  await clickText(s, "[data-testid=group-notes] [data-note-row]", "Methods section draft");
  await s.waitForSelector(`[data-window="${methodsS.uid}"] .ProseMirror`);
  const editLine = async (p, uid, text) => {
    await p.evaluate((u, t) => {
      const st = window.__margin.useApp.getState();
      const n = st.notes[u];
      return n.body;
    }, uid, text);
    await p.click(`[data-window="${uid}"] .ProseMirror p`);
    await p.keyboard.press("End");
    await p.keyboard.type(text);
    await sleep(600);
  };
  await editLine(s, methodsS.uid, " (n = 40, Sanjay)");
  await s.evaluate(() => window.__margin.flush());
  await s.evaluate(() => window.__margin.syncAll()).catch(() => {});
  await sleep(500);
  check("offline: status says changes are saved on this device", await s.evaluate(() => document.querySelector("[data-testid=sync-status]").innerText.includes("Offline")), await s.evaluate(() => document.querySelector("[data-testid=sync-status]").innerText));
  await editLine(a, methodsA.uid, " (aged 18 to 25, Amara)");
  await synced(a);
  await s.setOfflineMode(false);
  await s.evaluate(() => window.dispatchEvent(new Event("online")));
  await sleep(1500);
  await synced(s);
  await s.waitForSelector("[data-testid=conflict-banner]", { timeout: 10000 });
  check("clash: both versions kept and the note is flagged", await s.evaluate(() => document.querySelector("[data-testid=conflict-banner]").innerText.includes("Amara Okafor")));
  await shot(s, "conflict-banner");
  await synced(a);
  await a.waitForSelector("[data-testid=conflict-banner]", { timeout: 10000 });
  check("clash: the other member sees the flag too", true);
  await clickText(s, "[data-testid=conflict-banner] button", "Keep mine");
  await sleep(500);
  await both();
  check("clash resolved for everyone", !(await a.$("[data-testid=conflict-banner]")) && (await noteByTitle(a, "Methods section draft")).body.includes("Sanjay)"));

  // ---------------------------------------------------- version history + restore
  await clickText(a, "aside .side-item", "Group poster");
  await clickText(a, "[role=tab]", "History");
  await a.waitForSelector("[data-testid=history] [data-commit]", { timeout: 15000 });
  const historyText = await a.$eval("[data-testid=history]", (el) => el.innerText);
  check("group history lists who and when", historyText.includes("Sanjay Mehta") && historyText.includes("Amara Okafor"), historyText.slice(0, 300));
  await shot(a, "history-group");
  // per-note versions
  await a.evaluate((uid) => window.__margin.useApp.setState({ dialog: { kind: "noteHistory", uid } }), methodsA.uid);
  await a.waitForFunction(() => document.querySelectorAll("[data-testid=note-versions] button").length >= 2, { timeout: 15000 });
  const versions = await a.$$("[data-testid=note-versions] button");
  check("note has several versions", versions.length >= 2, String(versions.length));
  await versions[versions.length - 1].click();
  await sleep(500);
  await shot(a, "history-note");
  await clickText(a, "button", "Restore this version");
  await sleep(800);
  await both();
  const restored = await noteByTitle(s, "Methods section draft");
  check("restoring an old version reaches the group", !restored.body.includes("Sanjay)") && restored.body.includes("Participants"), restored.body);

  // ---------------------------------------------------- a real folder via plain git
  const token = await a.evaluate(async () => (await (await fetch("/api/tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "e2e" }) })).json()).token);
  const gid = methodsA.space.slice(2);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "margin-clone-"));
  execFileSync("git", ["clone", "-q", BASE.replace("://", `://x:${token}@`) + `/git/g/${gid}.git`, tmp]);
  const files = execFileSync("git", ["ls-files"], { cwd: tmp, encoding: "utf8" }).trim().split("\n");
  check("any git client can clone the group as plain files", files.includes("board.json") && files.some((f) => /^notes\/.*\.md$/.test(f)) && files.some((f) => f.startsWith("shared/")), files.join(","));
  const md = fs.readFileSync(path.join(tmp, files.find((f) => /^notes\/.*\.md$/.test(f))), "utf8");
  check("notes are readable Markdown with front matter", md.startsWith("---\n") && md.includes("title: Methods section draft") && md.includes("# Methods"), md.slice(0, 200));
  const authors = execFileSync("git", ["log", "--format=%an"], { cwd: tmp, encoding: "utf8" });
  check("git history carries each member's name", authors.includes("Sanjay Mehta") && authors.includes("Amara Okafor"));

  // ---------------------------------------------------- second device for the same person
  const tablet = await person(browser, "sanjay-tablet");
  const { logIn } = await import("./lib.mjs");
  await logIn(tablet, emailS);
  await tablet.waitForFunction(() => { const st = window.__margin.useApp.getState(); return Object.values(st.spaces).length === 2 && Object.values(st.spaces).every((x) => x.loaded); }, { timeout: 30000 });
  check("a new device gets the group folder on first connection", !!(await noteByTitle(tablet, "Methods section draft")));
  a.errors.push(...tablet.errors);
} catch (e) {
  console.log("ERROR", e.stack);
  await shot(a, "part2-error-amara");
  await shot(s, "part2-error-sanjay");
}
const errs = [...a.errors, ...s.errors].filter((e) => !e.includes("401") && !e.includes("subsetting") && !e.includes("ERR_INTERNET_DISCONNECTED"));
console.log(errs.join("\n") || "no console errors");
await browser.close();
process.exit(failed() ? 1 : 0);
