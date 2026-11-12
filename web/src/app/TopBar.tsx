import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CalendarDays, FilePlus, FolderPlus, Kanban, Link as LinkIcon, LocateFixed, LogOut, Network, Pencil, Plus, Search, Settings, Upload, UserPlus, Users } from "lucide-react";
import { Avatar, Dot, Menu, MenuContent, MenuItem, MenuSep, MenuTrigger, Tip } from "../components/ui";
import { isoDate, MOD } from "../lib/util";
import { createNote, openDialog, openGroup, openNote, setView, signOut, startFocus, toast, useApp } from "../store/app";
import { searchNotes, spaceLabel } from "../store/select";
import { editedLine } from "../notes/HoverPreview";

export function openBoard() {
  const s = useApp.getState();
  const gid = s.context.space.startsWith("g:") ? s.context.space.slice(2) : s.groups[0]?.id;
  if (gid) openGroup(gid, "board");
  else openDialog({ kind: "newGroup" });
}

export function openLinkDialog() {
  const s = useApp.getState();
  const uid = s.activeUid && s.windows.some((w) => w.uid === s.activeUid && !w.min) ? s.activeUid : null;
  if (!uid) {
    toast({ title: "Open a note first", body: "Link connects the note you are working on to other notes." }, { urgent: true });
    return;
  }
  openDialog({ kind: "link", uid });
}

export async function importFiles(files: FileList | null) {
  if (!files) return;
  let count = 0;
  for (const file of Array.from(files)) {
    const text = await file.text();
    const title = file.name.replace(/\.(md|markdown|txt|excalidraw)$/i, "");
    if (/\.excalidraw$/i.test(file.name)) createNote("drawing", { title, body: text, open: count === 0 });
    else createNote("text", { title, body: text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ""), open: count === 0 });
    count++;
  }
  if (count) toast({ title: count === 1 ? "Imported 1 file" : `Imported ${count} files` }, { urgent: true });
}

function Tool({ icon, label, keys, active, onClick, tip, id }: { icon: ReactNode; label: string; keys?: string; active?: boolean; onClick: () => void; tip: string; id: string }) {
  return (
    <Tip label={tip} keys={keys}>
      <button className="tool" data-active={active || undefined} data-tool={id} onClick={onClick} aria-label={label} aria-pressed={active}>
        {icon}
        <span>{label}</span>
      </button>
    </Tip>
  );
}

function highlight(text: string, terms: string[]): ReactNode {
  if (!terms.length) return text;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  return text.split(re).map((part, i) =>
    terms.some((t) => t.toLowerCase() === part.toLowerCase()) ? (
      <mark key={i} style={{ background: "var(--mark)", color: "inherit", borderRadius: 2 }}>
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function SearchBox() {
  const notes = useApp((s) => s.notes);
  const userId = useApp((s) => s.user?.id);
  const now = useApp((s) => s.now);
  const focusTick = useApp((s) => s.searchFocus);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusTick > 0) {
      input.current?.focus();
      input.current?.select();
      setOpen(true);
    }
  }, [focusTick]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const hits = useMemo(() => (open ? searchNotes(query, notes, userId, 12) : []), [open, query, notes, userId]);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  const choose = (uid: string) => {
    openNote(uid);
    setOpen(false);
    setQuery("");
    input.current?.blur();
  };

  return (
    <div ref={wrap} className="relative" data-tool="search" style={{ width: 250 }}>
      <div className="flex items-center gap-2 rounded-[9px] bg-surface-2 px-3" style={{ height: 38 }}>
        <Search size={16} className="text-muted flex-none" />
        <input
          ref={input}
          className="flex-1 min-w-0 bg-transparent border-0 outline-none t13"
          placeholder="Search notes"
          aria-label="Search notes"
          role="combobox"
          aria-expanded={open && query.trim().length > 0}
          aria-controls="search-results"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === "Enter" && hits[cursor]) {
              choose(hits[cursor].uid);
            } else if (e.key === "Escape") {
              setOpen(false);
              setQuery("");
              input.current?.blur();
            }
          }}
        />
        <span className="kbd">{MOD} F</span>
      </div>
      {open && query.trim() ? (
        <div id="search-results" role="listbox" className="menu scroll absolute right-0 mt-2" style={{ width: 420, maxHeight: 440, padding: 6 }} data-testid="search-results">
          {hits.length === 0 ? (
            <div className="t13 text-muted px-3 py-4">No notes match “{query.trim()}”.</div>
          ) : (
            hits.map((hit, i) => (
              <button
                key={hit.uid}
                role="option"
                aria-selected={i === cursor}
                className="menu-item"
                data-highlighted={i === cursor ? "" : undefined}
                style={{ alignItems: "flex-start", padding: "8px 10px" }}
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(hit.uid)}
              >
                <span className="mt-[5px]">
                  <Dot note={hit.note} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block t13 font-semibold truncate">{highlight(hit.note.meta.title, terms)}</span>
                  <span className="block t11 text-muted truncate">
                    {spaceLabel(hit.note.space)} · {editedLine(hit.note, userId, now)}
                  </span>
                  {hit.snippet ? <span className="block t12 text-ink-2 mt-0.5" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{highlight(hit.snippet, terms)}</span> : null}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export function TopBar() {
  const user = useApp((s) => s.user)!;
  const view = useApp((s) => s.view);
  const dialog = useApp((s) => s.dialog);
  const activeType = useApp((s) => {
    const w = s.windows.find((x) => x.uid === s.activeUid && !x.min);
    return w ? s.notes[w.uid]?.meta.type : undefined;
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const onCanvas = view.kind === "canvas";

  return (
    <header className="grid items-center bg-surface border-b border-line flex-none" style={{ minHeight: 72, padding: "0 20px", gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)", columnGap: 12 }}>
      <button className="flex items-center gap-2.5 bg-transparent border-0 p-0 justify-self-start" onClick={() => setView({ kind: "canvas" })} aria-label="Margin: back to the canvas">
        <span className="grid place-items-center rounded-[9px] bg-brand text-brand-ink font-bold t16" style={{ width: 32, height: 32 }}>
          M
        </span>
        <span className="t19 font-bold tracking-[-0.2px] hidden md:inline">Margin</span>
      </button>

      <nav className="flex items-center gap-1" aria-label="Tools" style={{ minWidth: 0 }}>
        <Tool id="note" icon={<FilePlus size={20} />} label="New note" tip="New text note" keys="N" active={onCanvas && activeType === "text" && dialog?.kind !== "link"} onClick={() => createNote("text")} />
        <Tool id="link" icon={<LinkIcon size={20} />} label="Link" tip="Link this note to others" keys="L" active={dialog?.kind === "link"} onClick={openLinkDialog} />
        <Tool id="drawing" icon={<Pencil size={20} />} label="Drawing" tip="New drawing" keys="D" active={onCanvas && activeType === "drawing" && dialog?.kind !== "link"} onClick={() => createNote("drawing")} />
        <Tool id="folder" icon={<FolderPlus size={20} />} label="Folder" tip="New folder" onClick={() => openDialog({ kind: "newFolder" })} />
        <Tool id="board" icon={<Kanban size={20} />} label="Board" tip="Group board" keys="B" active={view.kind === "group"} onClick={openBoard} />
        <Tool id="daily" icon={<CalendarDays size={20} />} label="Daily" tip="Today's daily note" keys="T" active={view.kind === "daily"} onClick={() => setView({ kind: "daily", date: isoDate() })} />
        <Tool id="graph" icon={<Network size={20} />} label="Graph" tip="Graph of linked notes" keys="G" active={view.kind === "graph"} onClick={() => setView({ kind: "graph" })} />
        <Menu>
          <Tip label="More to add">
            <MenuTrigger asChild>
              <button className="tool tool-add ml-1.5" aria-label="Add">
                <Plus size={18} />
                <span>Add</span>
              </button>
            </MenuTrigger>
          </Tip>
          <MenuContent align="end">
            <MenuItem icon={<Users size={15} />} onSelect={() => openDialog({ kind: "newGroup" })}>
              New group
            </MenuItem>
            <MenuItem icon={<UserPlus size={15} />} onSelect={() => openDialog({ kind: "joinGroup" })}>
              Join a group with a link
            </MenuItem>
            <MenuSep />
            <MenuItem icon={<Upload size={15} />} onSelect={() => fileInput.current?.click()}>
              Import Markdown or Excalidraw files
            </MenuItem>
          </MenuContent>
        </Menu>
        <input
          ref={fileInput}
          type="file"
          accept=".md,.markdown,.txt,.excalidraw"
          multiple
          hidden
          onChange={(e) => {
            void importFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </nav>

      <div className="flex items-center gap-2.5 justify-self-end">
        <SearchBox />
        <Tip label="Focus on one note" keys="Shift F">
          <button className="btn" data-tool="focus" onClick={() => startFocus()}>
            <LocateFixed size={16} />
            Focus
          </button>
        </Tip>
        <Tip label="Settings">
          <button className="icon-btn" style={{ width: 38, height: 38 }} aria-label="Settings" onClick={() => openDialog({ kind: "settings" })}>
            <Settings size={20} />
          </button>
        </Tip>
        <Menu>
          <MenuTrigger asChild>
            <button className="bg-transparent border-0 p-0 rounded-full" aria-label={`Account: ${user.name}`}>
              <Avatar name={user.name} id={user.id} size={34} />
            </button>
          </MenuTrigger>
          <MenuContent align="end" width={240}>
            <div className="px-2.5 py-2">
              <div className="t13 font-semibold truncate">{user.name}</div>
              <div className="t12 text-muted truncate">{user.email}</div>
            </div>
            <MenuSep />
            <MenuItem icon={<Settings size={15} />} onSelect={() => openDialog({ kind: "settings", section: "account" })}>
              Account and settings
            </MenuItem>
            <MenuItem icon={<LogOut size={15} />} danger onSelect={() => void signOut()}>
              Log out
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </header>
  );
}
