import { useEffect, useState } from "react";
import { EditorContent } from "@tiptap/react";
import { BellOff, Coffee, LocateFixed } from "lucide-react";
import { clock } from "../lib/util";
import { canEdit, logFocusMinutes, openFind, setFocus, useApp } from "../store/app";
import { spaceLabel } from "../store/select";
import { FindBar, useNoteEditor } from "../notes/TextNote";

function Ring({ progress }: { progress: number }) {
  const r = 12;
  const c = 2 * Math.PI * r;
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r={r} fill="none" strokeWidth="3.5" className="focus-ring-track" />
      <circle cx="16" cy="16" r={r} fill="none" stroke="var(--brand)" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, progress)))} transform="rotate(-90 16 16)" />
    </svg>
  );
}

const mmss = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** One note, a timer, and nothing else (Screen 9). */
export function FocusMode() {
  const focus = useApp((s) => s.focus)!;
  const note = useApp((s) => s.notes[focus.uid]);
  const settings = useApp((s) => s.settings);
  const findOpen = useApp((s) => s.findUid === focus.uid);
  const held = useApp((s) => s.held.length);
  const [now, setNow] = useState(Date.now());
  const editor = useNoteEditor(focus.uid, { editable: note ? canEdit(note) : false, placeholder: "Write here. Everything else can wait." });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  // The session (or the break) has run out.
  useEffect(() => {
    if (now < focus.endsAt) return;
    if (focus.phase === "running") {
      logFocusMinutes(focus.minutes);
      setFocus({ ...focus, phase: "done" });
    } else if (focus.phase === "break") {
      setFocus({ ...focus, phase: "done", minutes: 0 });
    }
  }, [now, focus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (useApp.getState().findUid) return openFind(null);
      if (useApp.getState().dialog) return;
      exit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exit = () => {
    openFind(null);
    setFocus(null);
  };

  if (!note) {
    return null;
  }
  const total = focus.endsAt - focus.startedAt;
  const left = focus.endsAt - now;
  const afterBreak = focus.phase === "done" && focus.minutes === 0;
  const again = (minutes: number) => setFocus({ uid: focus.uid, phase: "running", minutes, startedAt: Date.now(), endsAt: Date.now() + minutes * 60_000 });

  return (
    <div className="fixed inset-0 flex flex-col bg-canvas" style={{ zIndex: 120 }} data-testid="focus-mode" role="region" aria-label={`Focus mode: ${note.meta.title}`}>
      <header className="flex items-center gap-4 flex-none" style={{ height: 76, padding: "0 28px", borderBottom: "1px solid var(--hair)" }}>
        <span className="flex items-center gap-2.5 t14 font-semibold" style={{ color: "var(--brand)" }}>
          <LocateFixed size={18} /> Focus
        </span>
        <span className="t13 text-muted truncate" style={{ maxWidth: 320 }}>
          {note.meta.title}
        </span>
        <span className="flex-1" />
        <span className="flex items-center gap-3" role="timer" aria-live="off" data-testid="focus-timer">
          <Ring progress={focus.phase === "done" ? 1 : 1 - left / total} />
          <span className="t19 font-bold" style={{ fontVariantNumeric: "tabular-nums" }}>
            {focus.phase === "break" ? `Break · ${mmss(left)} left` : `${mmss(focus.phase === "done" ? 0 : left)} left`}
          </span>
        </span>
        <span className="flex-1" />
        <span className="flex items-center gap-2 t13 text-muted">
          <BellOff size={15} />
          {focus.phase === "running" ? `Notifications paused until ${clock(focus.endsAt)}` : held ? `${held} update${held === 1 ? "" : "s"} waiting` : "Notifications paused"}
        </span>
        <button className="btn" onClick={exit}>
          Exit focus <span className="kbd">Esc</span>
        </button>
      </header>
      {editor && findOpen ? (
        <FindBar
          editor={editor}
          onClose={() => {
            openFind(null);
            editor.commands.focus();
          }}
        />
      ) : null}
      <div className="scroll flex-1 min-h-0" onMouseDown={(e) => e.target === e.currentTarget && editor?.commands.focus("end")}>
        <div className="mx-auto" style={{ maxWidth: 760, padding: "64px 24px 200px" }}>
          <div className="caps mb-3">{spaceLabel(note.space)}</div>
          <h1 className="font-bold m-0 mb-7" style={{ fontSize: "calc(34px * var(--ts))", letterSpacing: "-0.4px" }}>
            {note.meta.title}
          </h1>
          <div style={{ fontSize: "calc(17px * var(--ts))" }} className="focus-prose">
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>

      {focus.phase === "done" ? (
        <div className="fixed bg-surface border border-line rounded-2xl" style={{ right: 40, bottom: 40, width: 400, padding: 22, boxShadow: "var(--shadow-lg)", animation: "slide-up 0.2s ease-out" }} role="alertdialog" aria-label="Session finished" data-testid="break-card">
          <div className="flex items-center gap-3">
            <span className="grid place-items-center rounded-full" style={{ width: 40, height: 40, background: "var(--warn-bg)", color: "var(--warn-ink)" }}>
              <Coffee size={19} />
            </span>
            <span className="t16 font-bold">{afterBreak ? "Break over. Ready for another round?" : settings.breakReminders ? `Time for a ${settings.breakMinutes}-minute break` : "Session finished"}</span>
          </div>
          <p className="t13 text-ink-2 mt-3 mb-4" style={{ lineHeight: 1.55 }}>
            {afterBreak
              ? "Pick up where you left off, or stop here for now."
              : `You’ve focused for ${focus.minutes} minutes. Stand up, stretch or look out of a window, then come back fresher.`}
          </p>
          <div className="flex items-center gap-2.5">
            {afterBreak ? (
              <button className="btn btn-primary" onClick={() => again(settings.focusMinutes)} autoFocus>
                Start {settings.focusMinutes} minutes
              </button>
            ) : (
              <>
                {settings.breakReminders ? (
                  <button className="btn btn-primary" onClick={() => setFocus({ ...focus, phase: "break", startedAt: Date.now(), endsAt: Date.now() + settings.breakMinutes * 60_000 })} autoFocus>
                    Start break
                  </button>
                ) : null}
                <button className="btn" onClick={() => again(5)}>
                  5 more minutes
                </button>
              </>
            )}
            <span className="flex-1" />
            <button className="btn btn-ghost" style={{ color: "var(--muted)" }} onClick={() => (afterBreak ? exit() : again(settings.focusMinutes))} title={afterBreak ? undefined : "Skip the break and keep going"}>
              {afterBreak ? "Finish" : "Skip"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
