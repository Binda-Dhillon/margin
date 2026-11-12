import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Ellipsis, FilePlus, FolderInput, History, Link as LinkIcon, LocateFixed, Maximize2, Minimize2, Minus, Palette, Pencil, Play, Search, Trash2, X } from "lucide-react";
import { Dot, Menu, MenuContent, MenuItem, MenuLabel, MenuSep, MenuTrigger, Tip } from "../components/ui";
import { NOTE_COLORS, type NoteColor } from "../core/types";
import { clamp } from "../lib/util";
import { canEdit, closeWindow, createNote, deleteNote, focusWindow, minimiseWindow, openDialog, openFind, openNote, patchNote, personalKey, setCanvasSize, startFocus, updateSettings, updateWindow, useApp, type WindowState } from "../store/app";
import { DrawingNote } from "../notes/DrawingNote";
import { Hover } from "../notes/HoverPreview";
import { focusEditor, TextNote } from "../notes/TextNote";
import { Checklist } from "../onboarding/Onboarding";

type DragMode = "move" | "e" | "s" | "se" | "w";

function useDrag(win: WindowState, canvas: { w: number; h: number }) {
  const start = useRef<{ x: number; y: number; win: WindowState; mode: DragMode } | null>(null);
  const frame = useRef(0);
  const begin = (mode: DragMode) => (e: React.PointerEvent) => {
    if (e.button !== 0 || win.max) return;
    const target = e.target as HTMLElement;
    if (mode === "move" && target.closest("button, input, [role='menu']")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, win, mode };
    e.preventDefault();
  };
  const move = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const w0 = s.win;
      if (s.mode === "move") {
        updateWindow(w0.uid, {
          x: clamp(w0.x + dx, 80 - w0.w, canvas.w - 80),
          y: clamp(w0.y + dy, 0, Math.max(0, canvas.h - 46)),
        });
      } else if (s.mode === "w") {
        const w = clamp(w0.w - dx, 320, w0.x + w0.w);
        updateWindow(w0.uid, { w, x: w0.x + (w0.w - w) });
      } else {
        updateWindow(w0.uid, {
          ...(s.mode !== "s" ? { w: clamp(w0.w + dx, 320, 2400) } : {}),
          ...(s.mode !== "e" ? { h: clamp(w0.h + dy, 200, 1800) } : {}),
        });
      }
    });
  };
  const end = (e: React.PointerEvent) => {
    if (!start.current) return;
    start.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* capture already released */
    }
  };
  return { begin, move, end };
}

const COLOR_NAMES: Record<NoteColor, string> = { green: "Green", purple: "Purple", blue: "Blue", yellow: "Yellow", coral: "Coral" };

function WindowMenu({ uid }: { uid: string }) {
  const note = useApp((s) => s.notes[uid]);
  const folders = useApp((s) => s.folders[personalKey()] ?? []);
  if (!note) return null;
  const editable = canEdit(note);
  const own = !note.meta.sharedOwner;
  return (
    <Menu>
      <Tip label="More">
        <MenuTrigger asChild>
          <button className="icon-btn" aria-label="More options">
            <Ellipsis size={17} />
          </button>
        </MenuTrigger>
      </Tip>
      <MenuContent align="end" width={230}>
        {note.meta.type === "text" ? (
          <>
            <MenuItem icon={<Search size={14} />} onSelect={() => openFind(uid)}>
              Find in this note
            </MenuItem>
            <MenuItem icon={<LocateFixed size={14} />} onSelect={() => startFocus(uid)}>
              Focus on this note
            </MenuItem>
          </>
        ) : null}
        <MenuItem icon={<LinkIcon size={14} />} onSelect={() => openDialog({ kind: "link", uid })} disabled={!editable}>
          Link to other notes
        </MenuItem>
        <MenuItem icon={<History size={14} />} onSelect={() => openDialog({ kind: "noteHistory", uid })}>
          Version history
        </MenuItem>
        {editable && own ? (
          <>
            <MenuSep />
            <MenuLabel>Colour</MenuLabel>
            <div className="flex gap-2 px-2.5 py-1.5">
              {(Object.keys(NOTE_COLORS) as NoteColor[]).map((c) => (
                <button
                  key={c}
                  aria-label={COLOR_NAMES[c]}
                  title={COLOR_NAMES[c]}
                  onClick={() => patchNote(uid, { meta: { color: c } }, { touch: false })}
                  style={{ width: 22, height: 22, borderRadius: "50%", border: 0, background: NOTE_COLORS[c], boxShadow: note.meta.color === c ? "0 0 0 2px var(--surface), 0 0 0 4px var(--ink)" : "none" }}
                />
              ))}
            </div>
          </>
        ) : null}
        {own && note.space.startsWith("u:") && folders.some((f) => !f.deleted) ? (
          <>
            <MenuSep />
            <MenuLabel>Move to folder</MenuLabel>
            <MenuItem icon={<FolderInput size={14} />} on={!note.meta.folder} onSelect={() => patchNote(uid, { meta: { folder: null } }, { touch: false })}>
              My notes
            </MenuItem>
            {folders
              .filter((f) => !f.deleted)
              .map((f) => (
                <MenuItem key={f.id} icon={<FolderInput size={14} />} on={note.meta.folder === f.id} onSelect={() => patchNote(uid, { meta: { folder: f.id } }, { touch: false })}>
                  {f.name}
                </MenuItem>
              ))}
          </>
        ) : null}
        {own ? (
          <>
            <MenuSep />
            <MenuItem
              icon={<Trash2 size={14} />}
              danger
              onSelect={() =>
                openDialog({
                  kind: "confirm",
                  title: `Delete “${note.meta.title}”?`,
                  body: note.space.startsWith("g:")
                    ? "It is removed for everyone in the group. Earlier versions stay in the group’s version history."
                    : "It is removed from all your devices. Earlier versions stay in your version history.",
                  confirmLabel: "Delete note",
                  danger: true,
                  onConfirm: () => void deleteNote(uid),
                })
              }
            >
              Delete note
            </MenuItem>
          </>
        ) : null}
      </MenuContent>
    </Menu>
  );
}

const NoteWindow = memo(function NoteWindow({ win, canvas }: { win: WindowState; canvas: { w: number; h: number } }) {
  const note = useApp((s) => s.notes[win.uid]);
  const active = useApp((s) => s.activeUid === win.uid);
  const drag = useDrag(win, canvas);
  const [title, setTitle] = useState(note?.meta.title ?? "");
  const titleRef = useRef<HTMLInputElement>(null);
  const fresh = useRef(note ? Date.now() - Date.parse(note.meta.created) < 1500 && /^Untitled/.test(note.meta.title) : false);

  useEffect(() => {
    if (note && document.activeElement !== titleRef.current) setTitle(note.meta.title);
  }, [note?.meta.title]); // eslint-disable-line react-hooks/exhaustive-deps

  // A brand-new note starts with its title selected, ready to be typed over.
  useLayoutEffect(() => {
    if (fresh.current) {
      fresh.current = false;
      titleRef.current?.focus();
      titleRef.current?.select();
    }
  }, []);

  if (!note) return null;
  const editable = canEdit(note);
  const rect = win.max ? { x: 12, y: 12, w: canvas.w - 24, h: canvas.h - 24 } : { x: win.x, y: win.y, w: Math.min(win.w, Math.max(320, canvas.w - 16)), h: Math.min(win.h, Math.max(200, canvas.h - 16)) };
  const commitTitle = () => {
    const t = title.trim() || (note.meta.type === "drawing" ? "Untitled drawing" : "Untitled note");
    setTitle(t);
    if (t !== note.meta.title) patchNote(win.uid, { meta: { title: t } });
  };

  return (
    <section
      className="window"
      data-active={active || undefined}
      data-window={win.uid}
      data-note-type={note.meta.type}
      aria-label={note.meta.title}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: win.z }}
      onPointerDownCapture={() => focusWindow(win.uid)}
      onFocusCapture={() => focusWindow(win.uid)}
    >
      <header className="window-head" onPointerDown={drag.begin("move")} onPointerMove={drag.move} onPointerUp={drag.end} onPointerCancel={drag.end} onDoubleClick={(e) => !(e.target as HTMLElement).closest("button, input") && updateWindow(win.uid, { max: !win.max })}>
        <Dot note={note} size={12} />
        <input
          ref={titleRef}
          className="window-title"
          style={{ flex: "0 1 auto", width: `${Math.max(8, title.length + 2)}ch`, maxWidth: "calc(100% - 190px)" }}
          value={title}
          readOnly={!editable}
          aria-label="Note title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Finish the title and carry on typing in the note itself. The Enter
              // must stop here, or it would add an empty line at the top of the note.
              e.preventDefault();
              const input = e.target as HTMLInputElement;
              input.blur();
              focusEditor(win.uid);
            }
            if (e.key === "Escape") {
              setTitle(note.meta.title);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        {note.meta.sharedOwner ? <span className="badge badge-muted flex-none">{note.meta.sharedAccess === "edit" ? "Shared · can edit" : "Shared · view only"}</span> : null}
        <span className="flex-1 self-stretch" />
        <WindowMenu uid={win.uid} />
        <Tip label="Minimise">
          <button className="icon-btn" aria-label="Minimise" onClick={() => minimiseWindow(win.uid)}>
            <Minus size={16} />
          </button>
        </Tip>
        <Tip label={win.max ? "Restore size" : "Maximise"}>
          <button className="icon-btn" aria-label={win.max ? "Restore size" : "Maximise"} onClick={() => updateWindow(win.uid, { max: !win.max })}>
            {win.max ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </Tip>
        <Tip label="Close">
          <button className="icon-btn" aria-label="Close" onClick={() => closeWindow(win.uid)}>
            <X size={16} />
          </button>
        </Tip>
      </header>
      {note.meta.type === "drawing" ? <DrawingNote uid={win.uid} layoutKey={`${rect.x}:${rect.y}:${rect.w}:${rect.h}`} /> : <TextNote uid={win.uid} />}
      {!win.max ? (
        <>
          <div className="resize-handle resize-w" onPointerDown={drag.begin("w")} onPointerMove={drag.move} onPointerUp={drag.end} />
          <div className="resize-handle resize-e" onPointerDown={drag.begin("e")} onPointerMove={drag.move} onPointerUp={drag.end} />
          <div className="resize-handle resize-s" onPointerDown={drag.begin("s")} onPointerMove={drag.move} onPointerUp={drag.end} />
          <div className="resize-handle resize-se" onPointerDown={drag.begin("se")} onPointerMove={drag.move} onPointerUp={drag.end} />
        </>
      ) : null}
    </section>
  );
});

function Dock() {
  const windows = useApp((s) => s.windows);
  const notes = useApp((s) => s.notes);
  const minimised = windows.filter((w) => w.min && notes[w.uid]);
  if (minimised.length === 0) return null;
  return (
    <div className="absolute left-0 right-0 flex items-center justify-center gap-3 px-6 pointer-events-none" style={{ bottom: 20, zIndex: 100000 }} data-testid="dock">
      <span className="caps pointer-events-auto">Minimised</span>
      <div className="flex gap-2 flex-wrap justify-center pointer-events-auto">
        {minimised.map((w) => (
          <Hover key={w.uid} uid={w.uid} side="top">
            <button
              className="flex items-center gap-2.5 bg-surface border border-line rounded-[9px] t13 font-medium text-ink"
              style={{ height: 40, padding: "0 12px", boxShadow: "0 2px 6px rgba(29,35,33,0.08)", maxWidth: 240 }}
              onClick={() => openNote(w.uid)}
              data-dock={w.uid}
            >
              <Dot note={notes[w.uid]} />
              <span className="truncate">{notes[w.uid].meta.title}</span>
              <Maximize2 size={13} className="text-muted flex-none" />
            </button>
          </Hover>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ firstRun }: { firstRun: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6" data-testid="empty-canvas">
      <div className="relative mb-10" style={{ width: 170, height: 96 }} aria-hidden="true">
        <div className="absolute rounded-lg" style={{ left: 0, top: 10, width: 110, height: 86, border: "1.5px dashed var(--line)" }} />
        <div className="absolute rounded-lg bg-surface overflow-hidden" style={{ left: 54, top: 0, width: 110, height: 82, boxShadow: "var(--shadow)" }}>
          <div style={{ height: 6, background: "#5fa88c" }} />
          <div style={{ margin: "14px 12px 0", height: 6, width: 62, borderRadius: 3, background: "var(--hair)" }} />
          <div style={{ margin: "9px 12px 0", height: 6, width: 78, borderRadius: 3, background: "var(--hair)" }} />
        </div>
      </div>
      <h2 className="font-bold m-0" style={{ fontSize: "calc(24px * var(--ts))" }}>
        {firstRun ? "Your canvas is ready" : "Nothing open right now"}
      </h2>
      <p className="t15 text-ink-2 mt-3 mb-7" style={{ maxWidth: 400 }}>
        {firstRun ? "Add a note, a sketch or a board. You can drag anything anywhere on the canvas." : "Open a note from the sidebar, search for one, or start something new."}
      </p>
      <div className="flex gap-3">
        <button className="btn btn-primary" style={{ height: 42 }} onClick={() => createNote("text")}>
          <FilePlus size={17} /> New note
        </button>
        <button className="btn" style={{ height: 42 }} onClick={() => createNote("drawing")}>
          <Pencil size={17} /> New drawing
        </button>
      </div>
      {firstRun ? (
        <button className="flex items-center gap-2 t13 font-semibold text-brand bg-transparent border-0 mt-6" onClick={() => updateSettings({ tips: { step: 0, done: false } })}>
          <Play size={14} /> Take the 1-minute tour
        </button>
      ) : null}
    </div>
  );
}

export function Canvas() {
  const windows = useApp((s) => s.windows);
  const notes = useApp((s) => s.notes);
  const canvas = useApp((s) => s.canvas);
  const noteCount = useApp((s) => Object.values(s.notes).filter((n) => n.meta.type !== "daily").length);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setCanvasSize(el.clientWidth, el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const open = windows.filter((w) => !w.min && notes[w.uid]);
  return (
    <div ref={ref} className="relative flex-1 min-w-0 overflow-hidden bg-canvas" data-testid="canvas">
      {open.length === 0 ? <EmptyState firstRun={noteCount === 0} /> : null}
      {open.map((w) => (
        <NoteWindow key={w.uid} win={w} canvas={canvas} />
      ))}
      <Dock />
      <Checklist />
    </div>
  );
}
