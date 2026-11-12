import { useMemo, useState } from "react";
import { Annoyed, Calendar, ChevronDown, ChevronLeft, ChevronRight, Clock, Frown, Heart, Kanban, Laugh, ListTodo, Meh, Mic, Plus, Smile, Square, Zap } from "lucide-react";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../components/ui";
import type { Card, Note } from "../core/types";
import { clock, daysUntil, firstName, greeting, isoDate, longDate, MONTHS_LONG, parseIsoDate, partOfDay, shortDate } from "../lib/util";
import { createNote, openDialog, openGroup, patchNote, personalKey, setView, useApp } from "../store/app";
import { liveCards } from "../store/select";
import { useDictation } from "../notes/TextNote";

const TEMPLATES: Record<string, { label: string; plan: string[] }> = {
  blank: { label: "Blank", plan: [] },
  study: { label: "Study day", plan: ["Review yesterday’s notes · 15 min", "Main study block · 45 min in Focus", "Plan tomorrow · 5 min"] },
  group: { label: "Group work day", plan: ["Check the group board · 5 min", "Do my card for today", "Tell the group where I got to"] },
};

const MOODS = [
  { id: "drained", label: "Drained", icon: Frown },
  { id: "low", label: "Low", icon: Annoyed },
  { id: "okay", label: "Okay", icon: Meh },
  { id: "good", label: "Good", icon: Smile },
  { id: "great", label: "Great", icon: Laugh },
];

interface PlanItem {
  done: boolean;
  text: string;
}

function parsePlan(body: string): PlanItem[] {
  return body
    .split("\n")
    .map((line) => line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ done: m[1] !== " ", text: m[2] }));
}

const planBody = (items: PlanItem[]) => items.map((i) => `- [${i.done ? "x" : " "}] ${i.text}`).join("\n");

function MonthGrid({ date, hasNote }: { date: string; hasNote: (d: string) => boolean }) {
  const selected = parseIsoDate(date);
  const [month, setMonth] = useState(new Date(selected.getFullYear(), selected.getMonth(), 1));
  const today = isoDate();
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // Monday first
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  return (
    <div>
      <div className="flex items-center mb-3">
        <span className="t14 font-semibold flex-1">
          {MONTHS_LONG[month.getMonth()]} {month.getFullYear()}
        </span>
        <button className="icon-btn" style={{ width: 28, height: 28 }} aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
          <ChevronLeft size={16} />
        </button>
        <button className="icon-btn" style={{ width: 28, height: 28 }} aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid text-center" style={{ gridTemplateColumns: "repeat(7, 1fr)", rowGap: 2 }} role="grid" aria-label="Pick a day">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i} className="t11 font-semibold text-muted pb-2">
            {d}
          </span>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <span key={i} />;
          const iso = isoDate(new Date(month.getFullYear(), month.getMonth(), day));
          const isSel = iso === date;
          const has = hasNote(iso);
          return (
            <button
              key={i}
              role="gridcell"
              aria-selected={isSel}
              aria-label={`${longDate(iso)}${has ? ", has a daily note" : ""}`}
              onClick={() => setView({ kind: "daily", date: iso })}
              className="t12 mx-auto grid place-items-center border-0 rounded-full"
              style={{
                width: 30,
                height: 30,
                fontWeight: isSel || iso === today ? 700 : 400,
                background: isSel ? "var(--brand)" : has ? "var(--brand-tint)" : "transparent",
                color: isSel ? "var(--brand-ink)" : "var(--ink)",
                boxShadow: iso === today && !isSel ? "inset 0 0 0 1.5px var(--brand)" : "none",
              }}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WeekSummary({ date }: { date: string }) {
  const notes = useApp((s) => s.notes);
  const pKey = personalKey();
  const days = useMemo(() => {
    const end = parseIsoDate(date);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (6 - i));
      const iso = isoDate(d);
      return { iso, note: notes[`${pKey}/${iso}`] as Note | undefined };
    });
  }, [date, notes, pKey]);
  const focus = days.reduce((sum, d) => sum + (d.note?.meta.focusMinutes ?? 0), 0);
  const done = days.reduce((sum, d) => sum + (d.note ? parsePlan(d.note.body).filter((p) => p.done).length : 0), 0);
  const checkins = days.filter((d) => d.note?.meta.mood).length;
  return (
    <section className="rounded-xl p-4 mt-7" style={{ background: "var(--brand-tint)" }} aria-label="Weekly summary" data-testid="week-summary">
      <div className="caps" style={{ color: "var(--brand)" }}>
        Your week
      </div>
      <div className="flex items-end gap-6 mt-3 flex-wrap">
        <div className="flex gap-2">
          {days.map((d) => {
            const mood = MOODS.find((m) => m.id === d.note?.meta.mood);
            const Icon = mood?.icon;
            return (
              <div key={d.iso} className="flex flex-col items-center gap-1" title={`${shortDate(d.iso)}${mood ? `: ${mood.label}` : ": no check-in"}`}>
                <span className="grid place-items-center rounded-full bg-surface" style={{ width: 30, height: 30, color: mood ? "var(--brand)" : "var(--line)" }}>
                  {Icon ? <Icon size={17} /> : <span className="dot" style={{ width: 6, height: 6, background: "var(--line)" }} />}
                </span>
                <span className="t10 text-muted">{shortDate(d.iso).slice(0, 1)}</span>
              </div>
            );
          })}
        </div>
        <div className="t13">
          <strong>{focus}</strong> min in Focus · <strong>{done}</strong> plan item{done === 1 ? "" : "s"} done · <strong>{checkins}</strong> check-in{checkins === 1 ? "" : "s"}
        </div>
      </div>
    </section>
  );
}

export function DailyView({ date }: { date: string }) {
  const user = useApp((s) => s.user)!;
  const pKey = personalKey();
  const uid = `${pKey}/${date}`;
  const note = useApp((s) => s.notes[uid]);
  const notes = useApp((s) => s.notes);
  const boards = useApp((s) => s.boards);
  const groups = useApp((s) => s.groups);
  const weekly = useApp((s) => s.settings.weeklySummary);
  const [draft, setDraft] = useState("");
  const [quick, setQuick] = useState("");
  const [recStart, setRecStart] = useState(0);
  const today = isoDate();
  const isToday = date === today;

  const ensure = (): Note => {
    const existing = useApp.getState().notes[uid];
    if (existing) return existing;
    createNote("daily", { date, open: false, meta: { template: "blank" } });
    return useApp.getState().notes[uid];
  };
  const plan = note ? parsePlan(note.body) : [];
  const setPlan = (items: PlanItem[]) => {
    ensure();
    patchNote(uid, { body: planBody(items) });
  };

  const addVoice = (text: string) => {
    if (!text.trim()) return;
    const current = ensure();
    const seconds = recStart ? Math.max(1, Math.round((Date.now() - recStart) / 1000)) : 0;
    patchNote(uid, { meta: { voiceNotes: [...(current.meta.voiceNotes ?? []), { at: new Date().toISOString(), seconds, text: text.trim() }] } });
  };
  const dictation = useDictation(addVoice);

  // Cards on any group board that are mine (or nobody's) and not finished.
  const upcoming = useMemo(() => {
    const out: { card: Card; group: (typeof groups)[number]; days: number | null; assignedToday: boolean }[] = [];
    for (const g of groups) {
      const board = boards[`g:${g.id}`];
      if (!board) continue;
      const doneCol = board.columns[board.columns.length - 1]?.id;
      for (const card of liveCards(board)) {
        if (card.column === doneCol) continue;
        if (card.assignee && card.assignee !== user.id) continue;
        const days = card.due ? daysUntil(card.due, parseIsoDate(date)) : null;
        const assignedToday = card.assignee === user.id && card.movedAt.slice(0, 10) === date && card.movedById !== user.id;
        if ((days !== null && days <= 7) || assignedToday) out.push({ card, group: g, days, assignedToday });
      }
    }
    return out.sort((a, b) => (a.days ?? 99) - (b.days ?? 99)).slice(0, 6);
  }, [groups, boards, user.id, date]);
  const dueCount = upcoming.filter((u) => u.days !== null).length;

  const applyTemplate = (id: string) => {
    ensure();
    const have = new Set(plan.map((p) => p.text));
    const extra = TEMPLATES[id].plan.filter((t) => !have.has(t)).map((text) => ({ done: false, text }));
    patchNote(uid, { meta: { template: id }, body: planBody([...plan, ...extra]) });
  };

  const hasNote = (d: string) => !!notes[`${pKey}/${d}`];
  const template = TEMPLATES[note?.meta.template ?? "blank"] ?? TEMPLATES.blank;
  const hello = isToday ? `${greeting()}, ${firstName(user.name)}` : longDate(date);
  const numberWord = ["No", "One", "Two", "Three", "Four", "Five", "Six"][dueCount] ?? String(dueCount);

  return (
    <div className="scroll flex-1 min-w-0 bg-canvas" style={{ padding: "22px 28px" }} data-testid="daily-view">
      <section className="bg-surface border border-line rounded-xl mx-auto flex flex-col" style={{ maxWidth: 1040, minHeight: 720, boxShadow: "var(--shadow)" }} aria-label={`Daily note for ${longDate(date)}`}>
        <header className="flex items-center gap-3 border-b border-hair flex-none" style={{ height: 46, padding: "0 16px" }}>
          <span className="dot" style={{ width: 12, height: 12, background: "#5b8fd0" }} />
          <h1 className="t15 font-semibold m-0">{longDate(date)}</h1>
          <span className="badge" style={{ background: "#dbe9fa", color: "#22548f" }}>
            Daily note
          </span>
          <span className="flex-1" />
          {!isToday ? (
            <button className="btn btn-sm" onClick={() => setView({ kind: "daily", date: today })}>
              <Calendar size={13} /> Today
            </button>
          ) : null}
        </header>
        <div className="flex flex-1 min-h-0 flex-wrap">
          <aside className="border-r border-hair flex-none" style={{ width: 260, padding: "22px 20px" }}>
            <MonthGrid key={date.slice(0, 7)} date={date} hasNote={hasNote} />
            <div className="caps mt-7 mb-2">Template</div>
            <Menu>
              <MenuTrigger asChild>
                <button className="btn w-full" style={{ justifyContent: "space-between", fontWeight: 500 }}>
                  {template.label} <ChevronDown size={15} />
                </button>
              </MenuTrigger>
              <MenuContent width={220}>
                {Object.entries(TEMPLATES).map(([id, t]) => (
                  <MenuItem key={id} on={(note?.meta.template ?? "blank") === id} onSelect={() => applyTemplate(id)}>
                    {t.label}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
            <div className="flex items-center gap-2 t12 text-muted mt-3">
              <Clock size={13} /> {note ? `Created at ${clock(note.meta.created)}` : "Created when you first add something"}
            </div>
          </aside>

          <div className="flex-1 min-w-0" style={{ padding: "22px 30px 30px", minWidth: 320 }}>
            <h2 className="font-bold m-0" style={{ fontSize: "calc(24px * var(--ts))" }}>
              {hello}
            </h2>
            <p className="t14 text-ink-2 mt-1 mb-0">
              {dueCount === 0 ? "Nothing from your boards is due this week." : `${numberWord} thing${dueCount === 1 ? "" : "s"} from your boards ${dueCount === 1 ? "is" : "are"} due this week.`}
            </p>

            <div className="flex items-center gap-2 caps mt-6 mb-1">
              <Zap size={14} /> Coming up · from your boards
            </div>
            {upcoming.length === 0 ? (
              <div className="t13 text-muted py-3 border-b border-hair">
                {groups.length === 0 ? (
                  <>
                    Cards assigned to you on a group board appear here.{" "}
                    <button className="bg-transparent border-0 p-0 text-brand font-semibold" onClick={() => openDialog({ kind: "newGroup" })}>
                      Start a group
                    </button>
                  </>
                ) : (
                  "No cards with a due date are waiting on you."
                )}
              </div>
            ) : (
              upcoming.map(({ card, group, days, assignedToday }) => (
                <button key={card.id} className="flex items-center gap-3 w-full bg-transparent border-0 border-b border-hair text-left" style={{ minHeight: 40 }} onClick={() => openGroup(group.id, "board")}>
                  <Kanban size={14} className="text-muted flex-none" />
                  <span className="t14 font-medium truncate">{card.title}</span>
                  <span className="t12 text-muted truncate">{group.name}</span>
                  <span className="flex-1" />
                  {assignedToday && days === null ? <span className="badge badge-brand">Assigned today</span> : null}
                  {days !== null && card.due ? (
                    <span className={`badge ${days <= 2 ? "badge-warn" : "badge-muted"}`}>
                      <Calendar size={12} /> {shortDate(card.due)}
                      {days < 0 ? " · overdue" : days === 0 ? " · today" : days <= 2 ? ` · ${days} day${days === 1 ? "" : "s"}` : ""}
                    </span>
                  ) : null}
                </button>
              ))
            )}

            <div className="flex items-center gap-2 caps mt-7 mb-2">
              <ListTodo size={14} /> {isToday ? "Today’s plan" : "Plan"}
            </div>
            <div className="prose" data-testid="plan">
              {plan.map((item, i) => {
                const [main, detail] = item.text.split(" · ");
                return (
                  <div key={i} className="flex items-center gap-3 group" style={{ minHeight: 32 }}>
                    <input type="checkbox" checked={item.done} aria-label={main} onChange={(e) => setPlan(plan.map((p, j) => (j === i ? { ...p, done: e.target.checked } : p)))} />
                    <span className="t15" style={item.done ? { textDecoration: "line-through", color: "var(--muted)" } : undefined}>
                      {main}
                    </span>
                    {detail ? <span className="t12 text-muted">{detail}</span> : null}
                    <span className="flex-1" />
                    <button className="icon-btn opacity-0 group-hover:opacity-100 focus:opacity-100" style={{ width: 24, height: 24 }} aria-label={`Remove ${main}`} onClick={() => setPlan(plan.filter((_, j) => j !== i))}>
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-3 mt-1.5">
              <Plus size={16} className="text-muted" />
              <input
                className="flex-1 bg-transparent border-0 outline-none t14 py-1.5"
                placeholder="Add something to the plan (use “ · 15 min” for a time)"
                aria-label="Add something to the plan"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && draft.trim()) {
                    setPlan([...plan, { done: false, text: draft.trim() }]);
                    setDraft("");
                  }
                }}
              />
            </div>

            <div className="flex items-center gap-2 caps mt-7 mb-2">
              <Mic size={14} /> Voice notes
            </div>
            {(note?.meta.voiceNotes ?? []).map((v, i) => (
              <div key={i} className="border border-line rounded-xl p-3.5 mb-2.5" data-testid="voice-note">
                <div className="flex items-center gap-3">
                  <span className="grid place-items-center rounded-full flex-none" style={{ width: 34, height: 34, background: "var(--brand)", color: "var(--brand-ink)" }}>
                    <Mic size={16} />
                  </span>
                  <span className="t13 font-semibold">{clock(v.at)}</span>
                  {v.seconds ? <span className="t12 text-muted">0:{String(Math.min(59, v.seconds)).padStart(2, "0")}</span> : null}
                  <span className="badge badge-muted">{v.seconds ? "Transcribed" : "Typed"}</span>
                  <span className="flex-1" />
                  <button className="btn btn-sm" disabled={plan.some((p) => p.text === v.text)} onClick={() => setPlan([...plan, { done: false, text: v.text }])}>
                    <Plus size={13} /> Add to plan
                  </button>
                  <button className="icon-btn" style={{ width: 26, height: 26 }} aria-label="Delete voice note" onClick={() => patchNote(uid, { meta: { voiceNotes: (note?.meta.voiceNotes ?? []).filter((_, j) => j !== i) } })}>
                    ×
                  </button>
                </div>
                <p className="t14 text-ink-2 mt-2.5 mb-0">“{v.text}”</p>
              </div>
            ))}
            <div className="flex items-center gap-2.5">
              {dictation.supported ? (
                <button
                  className={`btn ${dictation.on ? "btn-primary" : ""}`}
                  onClick={() => {
                    if (!dictation.on) setRecStart(Date.now());
                    dictation.toggle();
                  }}
                  aria-pressed={dictation.on}
                >
                  {dictation.on ? <Square size={14} /> : <Mic size={15} />} {dictation.on ? "Stop and save" : "Record a voice note"}
                </button>
              ) : null}
              <input
                className="input flex-1"
                style={{ height: 38 }}
                placeholder={dictation.supported ? "or type a quick thought" : "Type a quick thought (this browser cannot transcribe speech)"}
                aria-label="Type a quick thought"
                value={quick}
                onChange={(e) => setQuick(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && quick.trim()) {
                    setRecStart(0);
                    const current = ensure();
                    patchNote(uid, { meta: { voiceNotes: [...(current.meta.voiceNotes ?? []), { at: new Date().toISOString(), seconds: 0, text: quick.trim() }] } });
                    setQuick("");
                  }
                }}
              />
            </div>

            <div className="flex items-center gap-2 caps mt-7 mb-2.5">
              <Heart size={14} /> How are you feeling {isToday ? partOfDay() : "that day"}?
            </div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="flex gap-2" role="radiogroup" aria-label="How are you feeling">
                {MOODS.map((m) => {
                  const on = note?.meta.mood === m.id;
                  return (
                    <button
                      key={m.id}
                      role="radio"
                      aria-checked={on}
                      className="flex flex-col items-center justify-center gap-1.5 rounded-[10px] t12 font-medium"
                      style={{ width: 76, height: 64, background: on ? "var(--brand-tint)" : "var(--surface)", border: on ? "2px solid var(--brand)" : "1px solid var(--line)", color: on ? "var(--brand)" : "var(--ink-2)" }}
                      onClick={() => {
                        ensure();
                        patchNote(uid, { meta: { mood: on ? null : m.id } }, { touch: false });
                      }}
                    >
                      <m.icon size={20} />
                      {m.label}
                    </button>
                  );
                })}
              </div>
              <span className="t12 text-muted" style={{ maxWidth: 230 }}>
                Private to you. Used for your weekly summary.
              </span>
            </div>
            {weekly ? <WeekSummary date={date} /> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
