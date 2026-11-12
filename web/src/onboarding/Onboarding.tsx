import { useEffect, useLayoutEffect, useState } from "react";
import { CircleCheck, Circle, X } from "lucide-react";
import { MOD } from "../lib/util";
import { createNote, openDialog, openGroup, updateSettings, useApp } from "../store/app";

const TIPS = [
  { anchor: "note", title: "Start here", body: "Press N to add a note. Hover over any tool to see its shortcut." },
  { anchor: "drawing", title: "Think in sketches", body: "Press D for a drawing. Link a sketch to a note and it can appear when you hover that note." },
  { anchor: "search", title: "Find anything", body: `Press ${MOD} F to search every note. With a note open, it searches inside that note.` },
  { anchor: "focus", title: "Protect your attention", body: "Focus hides everything except one note and holds notifications until you finish." },
];

/** The first-use coachmark tour (Screen 2). */
export function Tips() {
  const tips = useApp((s) => s.settings.tips);
  const dialogOpen = useApp((s) => !!s.dialog);
  const focus = useApp((s) => !!s.focus);
  const [pos, setPos] = useState<{ left: number; top: number; arrow: number } | null>(null);
  const step = Math.min(tips.step, TIPS.length - 1);
  const tip = TIPS[step];
  const show = !tips.done && !dialogOpen && !focus;

  useLayoutEffect(() => {
    if (!show) return;
    const place = () => {
      const el = document.querySelector(`[data-tool="${tip.anchor}"]`);
      if (!el) return setPos(null);
      const r = el.getBoundingClientRect();
      const width = 310;
      const left = Math.max(12, Math.min(window.innerWidth - width - 12, r.left + r.width / 2 - 40));
      setPos({ left, top: r.bottom + 14, arrow: Math.max(16, Math.min(width - 24, r.left + r.width / 2 - left - 7)) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [show, tip.anchor]);

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && updateSettings({ tips: { step, done: true } });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, step]);

  if (!show || !pos) return null;
  const last = step === TIPS.length - 1;
  return (
    <div role="dialog" aria-label={`Tip ${step + 1} of ${TIPS.length}: ${tip.title}`} className="fixed rounded-xl" style={{ left: pos.left, top: pos.top, width: 310, zIndex: 150, background: "#1d2321", color: "#fff", padding: "14px 16px 12px", boxShadow: "var(--shadow-lg)" }} data-testid="coachmark">
      <span className="absolute" style={{ left: pos.arrow, top: -6, width: 14, height: 14, background: "#1d2321", transform: "rotate(45deg)", borderRadius: 2 }} />
      <div className="t14 font-semibold">{tip.title}</div>
      <div className="t12 mt-1.5" style={{ color: "rgba(255,255,255,0.86)", lineHeight: 1.5 }}>
        {tip.body}
      </div>
      <div className="flex items-center mt-3 t12">
        <span style={{ color: "rgba(255,255,255,0.7)" }}>
          Tip {step + 1} of {TIPS.length}
        </span>
        <span className="flex-1" />
        {!last ? (
          <button className="bg-transparent border-0 font-medium px-2 py-1 rounded-md" style={{ color: "rgba(255,255,255,0.8)" }} onClick={() => updateSettings({ tips: { step, done: true } })}>
            Skip tips
          </button>
        ) : null}
        <button className="bg-transparent border-0 font-semibold px-2 py-1 rounded-md" style={{ color: "#fff" }} onClick={() => updateSettings({ tips: last ? { step: 0, done: true } : { step: step + 1, done: false } })} autoFocus>
          {last ? "Done" : "Next"}
        </button>
      </div>
    </div>
  );
}

/** The getting-started checklist on the canvas (Screen 2). */
export function Checklist() {
  const checklist = useApp((s) => s.settings.checklist);
  const groups = useApp((s) => s.groups);
  if (checklist.dismissed) return null;
  const items = [
    { done: true, label: "Create your account", run: () => undefined },
    { done: checklist.note, label: "Add your first note", run: () => createNote("text") },
    { done: checklist.drawing, label: "Try a drawing with your pen", run: () => createNote("drawing") },
    { done: checklist.board, label: "Open your group’s board", run: () => (groups[0] ? openGroup(groups[0].id, "board") : openDialog({ kind: "newGroup" })) },
  ];
  const count = items.filter((i) => i.done).length;
  return (
    <div className="absolute bg-surface rounded-xl" style={{ right: 24, bottom: 78, width: 276, padding: "16px 18px 14px", boxShadow: "var(--shadow)", zIndex: 0 }} data-testid="checklist">
      <div className="flex items-center">
        <span className="t14 font-semibold">Getting started</span>
        <span className="flex-1" />
        <span className="t12 text-muted">
          {count} of {items.length}
        </span>
        <button className="icon-btn ml-1" style={{ width: 24, height: 24 }} aria-label="Hide the getting-started list" onClick={() => updateSettings({ checklist: { ...checklist, dismissed: true } })}>
          <X size={13} />
        </button>
      </div>
      <div className="rounded-full mt-2.5 mb-3 overflow-hidden" style={{ height: 4, background: "var(--hair)" }} role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={count} aria-label="Getting started progress">
        <div style={{ width: `${(count / items.length) * 100}%`, height: "100%", background: "var(--brand)", transition: "width 0.3s" }} />
      </div>
      {items.map((item) => (
        <button
          key={item.label}
          className="flex items-center gap-2.5 w-full bg-transparent border-0 py-1.5 px-0 text-left t13"
          style={{ color: item.done ? "var(--muted)" : "var(--ink)", textDecoration: item.done ? "line-through" : "none", cursor: item.done ? "default" : "pointer" }}
          onClick={() => !item.done && item.run()}
          disabled={item.done}
        >
          {item.done ? <CircleCheck size={15} style={{ color: "var(--brand)" }} /> : <Circle size={15} />}
          {item.label}
        </button>
      ))}
    </div>
  );
}
