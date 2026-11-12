import { useMemo, useState } from "react";
import { BookOpen, Check, ChevronDown, Eye, FileText, Kanban, Link as LinkIcon, Lock, Maximize2, PenLine, Plus, Search, Unlink, X } from "lucide-react";
import { Dot, Menu, MenuContent, MenuItem, MenuLabel, MenuSep, MenuTrigger, Modal, NoteIcon, Switch } from "../components/ui";
import { makeRef } from "../core/notefile";
import { NOTE_COLORS, type Access, type Note } from "../core/types";
import { canEdit, canonicalUid, linkNotes, linkProblem, openDialog, openGroup, openNote, setPreview, setShareAccess, unlinkNotes, useApp } from "../store/app";
import { areLinked, cardsLinking, folderName, isPrivateStub, linksOf, resolveRef, spaceLabel, visibleNotes, type LinkEntry } from "../store/select";
import { editedLine, Hover } from "./HoverPreview";

export const ACCESS_LABEL: Record<Access, string> = { private: "Private", view: "Can view", edit: "Can edit" };
const ACCESS_HELP: Record<Access, string> = {
  private: "The group sees that a note is linked, but not its title or content.",
  view: "Group members can read it. Only you can change it.",
  edit: "Group members can read and change it. Their edits come back to your note.",
};

function AccessItems({ value, onChange }: { value: Access | undefined; onChange: (a: Access) => void }) {
  return (
    <>
      {(["private", "view", "edit"] as Access[]).map((a) => (
        <MenuItem key={a} icon={value === a ? <Check size={14} /> : <span />} on={value === a} onSelect={() => onChange(a)}>
          <span>
            <span className="block">{ACCESS_LABEL[a]}</span>
            <span className="block t11 text-muted font-normal" style={{ whiteSpace: "normal", maxWidth: 220 }}>
              {ACCESS_HELP[a]}
            </span>
          </span>
        </MenuItem>
      ))}
    </>
  );
}

function LinkChip({ selfUid, entry, editable }: { selfUid: string; entry: LinkEntry; editable: boolean }) {
  const self = useApp((s) => s.notes[selfUid]);
  const userId = useApp((s) => s.user?.id);
  if (!self) return null;
  const other = entry.note;
  const locked = isPrivateStub(other, userId);
  const isSketch = other.meta.type === "drawing";
  const previewRef = makeRef(self.space, other.space, other.meta.id);
  const previewOn = !!self.meta.preview && resolveRef(self.space, self.meta.preview) === entry.uid;
  const personalUid = self.space.startsWith("u:") ? selfUid : entry.uid;
  const groupName = entry.gid ? spaceLabel(`g:${entry.gid}`) : "";
  const personalTitle = self.space.startsWith("u:") ? self.meta.title : other.meta.title;

  return (
    <Menu>
      <Hover uid={entry.uid} side="top">
        <MenuTrigger asChild>
          <button
            className="chip"
            data-link-chip={entry.uid}
            style={previewOn ? { background: "var(--surface)", boxShadow: "inset 0 0 0 1.5px var(--brand)", color: "var(--brand)" } : undefined}
          >
            <NoteIcon note={other} size={12} />
            <span className="truncate" style={{ maxWidth: 190 }}>
              {other.meta.title}
            </span>
            {entry.access && !locked ? <span className="t10 font-semibold opacity-70">· {ACCESS_LABEL[entry.access]}</span> : null}
            {locked && other.meta.sharedOwnerName ? <span className="t10 font-semibold opacity-70">· {other.meta.sharedOwnerName}</span> : null}
            {previewOn ? <Eye size={12} /> : null}
            <ChevronDown size={12} />
          </button>
        </MenuTrigger>
      </Hover>
      <MenuContent width={270}>
        <MenuItem icon={locked ? <Lock size={14} /> : <Maximize2 size={14} />} disabled={locked} onSelect={() => openNote(entry.uid)}>
          {locked ? "Private note" : isSketch ? "Open sketch" : "Open note"}
        </MenuItem>
        {isSketch && !locked && editable ? (
          <>
            <MenuItem icon={<Eye size={14} />} on={previewOn} keep onSelect={() => setPreview(selfUid, previewOn ? null : previewRef)}>
              <span className="flex-1">Show as preview</span>
              <Switch checked={previewOn} onChange={() => undefined} label="Show as preview" />
            </MenuItem>
          </>
        ) : null}
        {entry.access && entry.mine && entry.gid ? (
          <>
            <MenuSep />
            <MenuLabel>
              {groupName} access to “{personalTitle}”
            </MenuLabel>
            <AccessItems value={entry.access} onChange={(a) => setShareAccess(canonicalUid(personalUid), entry.gid!, a)} />
          </>
        ) : null}
        {entry.access && !entry.mine && !locked ? (
          <div className="menu-note">
            Shared by {other.meta.sharedOwnerName}. {ACCESS_HELP[entry.access].replace("Group members", "You").replace("Only you", "Only they")}
          </div>
        ) : null}
        {editable || entry.mine ? (
          <>
            <MenuSep />
            <MenuItem icon={<X size={14} />} danger onSelect={() => unlinkNotes(selfUid, entry.uid)}>
              Unlink
            </MenuItem>
          </>
        ) : null}
        {isSketch && !locked && editable ? (
          <>
            <MenuSep />
            <div className="menu-note">When on, hovering this note anywhere shows this sketch instead of its text.</div>
          </>
        ) : null}
      </MenuContent>
    </Menu>
  );
}

/** The "Linked to" chips at the foot of a note. */
export function LinkedRow({ uid, compact }: { uid: string; compact?: boolean }) {
  const notes = useApp((s) => s.notes);
  const boards = useApp((s) => s.boards);
  const userId = useApp((s) => s.user?.id);
  const note = notes[uid];
  const entries = useMemo(() => linksOf(uid, notes, userId), [uid, notes, userId]);
  if (!note) return null;
  const editable = canEdit(note);
  const cards = cardsLinking(note.meta.id, note.space, boards);
  if (compact && entries.length === 0 && cards.length === 0) return null;
  return (
    <div className="flex items-center flex-wrap gap-2" data-testid="linked-row">
      <span className="t12 font-semibold text-muted uppercase mr-1" style={{ letterSpacing: "0.3px" }}>
        Linked to
      </span>
      {entries.map((entry) => (
        <LinkChip key={entry.uid} selfUid={uid} entry={entry} editable={editable} />
      ))}
      {cards.length > 0 && note.space.startsWith("g:") ? (
        <button className="chip" onClick={() => openGroup(note.space.slice(2), "board")} title={cards.map((c) => c.title).join(", ")}>
          <Kanban size={12} />
          {spaceLabel(note.space)} board
        </button>
      ) : null}
      {editable ? (
        <button className="chip" style={{ background: "transparent", boxShadow: "inset 0 0 0 1px var(--line)" }} onClick={() => openDialog({ kind: "link", uid })}>
          <Plus size={12} />
          {entries.length === 0 ? "Link a note" : "Link"}
        </button>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------- dialog ----

function tileStyle(note: Note) {
  const color = NOTE_COLORS[note.meta.color] ?? NOTE_COLORS.green;
  return { background: `color-mix(in srgb, ${color} 18%, var(--surface))`, color: `color-mix(in srgb, ${color} 75%, var(--ink))` };
}

function Row({ selfUid, note, uid }: { selfUid: string; note: Note; uid: string }) {
  const notes = useApp((s) => s.notes);
  const userId = useApp((s) => s.user?.id);
  const now = useApp((s) => s.now);
  const self = notes[selfUid];
  const [access, setAccess] = useState<Access>("view");
  if (!self) return null;
  const linked = areLinked(selfUid, uid, notes, userId);
  const problem = linkProblem(selfUid, uid);
  const cross = self.space !== note.space;
  const personal = self.space.startsWith("u:") ? self : note;
  const group = self.space.startsWith("g:") ? self : note;
  const gid = cross ? group.space.slice(2) : "";
  const currentAccess = cross ? personal.meta.shares[gid] : undefined;
  const where = folderName(note) ?? spaceLabel(note.space);
  const Icon = note.meta.type === "drawing" ? PenLine : note.meta.tags.includes("reading") ? BookOpen : FileText;

  return (
    <div className="flex items-center gap-3 py-3 border-b border-hair" data-link-row={uid}>
      <span className="grid place-items-center rounded-lg flex-none" style={{ width: 40, height: 40, ...tileStyle(note) }}>
        <Icon size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="t14 font-semibold truncate">{note.meta.title}</div>
        <div className="t12 text-muted truncate">
          {where}
          {note.meta.sharedOwnerName && note.meta.sharedOwner !== userId ? ` · ${note.meta.sharedOwnerName}` : ""} · {editedLine(note, userId, now)}
        </div>
        {cross && !problem ? (
          <div className="t11 text-muted mt-1">
            {personal === self ? "This note" : `“${personal.meta.title}”`} is personal. Choose what {spaceLabel(group.space)} can do with it.
          </div>
        ) : null}
        {problem === "cross-group" ? <div className="t11 text-muted mt-1">Notes in two different groups cannot be linked.</div> : null}
      </div>
      {cross && !problem ? (
        <Menu>
          <MenuTrigger asChild>
            <button className="btn btn-sm" aria-label="Access level" data-access-trigger>
              {ACCESS_LABEL[currentAccess ?? access]}
              <ChevronDown size={13} />
            </button>
          </MenuTrigger>
          <MenuContent align="end" width={270}>
            <AccessItems
              value={currentAccess ?? access}
              onChange={(a) => {
                setAccess(a);
                if (linked) setShareAccess(canonicalUid(personal === self ? selfUid : uid), gid, a);
              }}
            />
          </MenuContent>
        </Menu>
      ) : null}
      {linked ? (
        <button className="btn btn-sm" style={{ background: "var(--brand-tint)", borderColor: "transparent", color: "var(--brand)" }} onClick={() => unlinkNotes(selfUid, uid)} title="Click to unlink">
          <Check size={14} /> Linked
        </button>
      ) : (
        <button className="btn btn-sm btn-primary" disabled={!!problem} onClick={() => linkNotes(selfUid, uid, access)}>
          <LinkIcon size={14} /> Link
        </button>
      )}
    </div>
  );
}

export function LinkDialog({ uid }: { uid: string }) {
  const notes = useApp((s) => s.notes);
  const userId = useApp((s) => s.user?.id);
  const recent = useApp((s) => s.recent);
  const [query, setQuery] = useState("");
  const self = notes[uid];

  const { linked, rest } = useMemo(() => {
    if (!self) return { linked: [] as Note[], rest: [] as Note[] };
    const q = query.trim().toLowerCase();
    const all = visibleNotes(notes, userId).filter((n) => {
      const nUid = `${n.space}/${n.meta.id}`;
      if (nUid === uid || n.meta.type === "daily" || isPrivateStub(n, userId)) return false;
      if (q && !n.meta.title.toLowerCase().includes(q) && !n.meta.tags.join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
    const linkedSet = new Set(linksOf(uid, notes, userId).map((e) => e.uid));
    const rank = (n: Note) => {
      const i = recent.indexOf(`${n.space}/${n.meta.id}`);
      return i === -1 ? 100 : i;
    };
    const byRecent = [...all].sort((a, b) => rank(a) - rank(b) || (Date.parse(b.meta.updated) || 0) - (Date.parse(a.meta.updated) || 0));
    return {
      linked: byRecent.filter((n) => linkedSet.has(`${n.space}/${n.meta.id}`)),
      rest: byRecent.filter((n) => !linkedSet.has(`${n.space}/${n.meta.id}`)).slice(0, 30),
    };
  }, [notes, userId, uid, query, recent, self]);

  if (!self) return null;
  return (
    <Modal
      open
      onClose={() => openDialog(null)}
      title={`Link “${self.meta.title}” to other notes`}
      icon={<LinkIcon size={18} />}
      width={720}
      footer={
        <>
          <span className="t12 text-muted flex-1">Links work both ways. A linked sketch can be set as this note’s hover preview.</span>
          <button className="btn btn-primary" onClick={() => openDialog(null)}>
            Done
          </button>
        </>
      }
    >
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input className="input" style={{ paddingLeft: 40, height: 44 }} placeholder="Search notes and drawings" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search notes and drawings" />
      </div>
      {linked.length > 0 ? (
        <>
          <div className="caps mt-1">Linked</div>
          {linked.map((n) => (
            <Row key={`${n.space}/${n.meta.id}`} selfUid={uid} note={n} uid={`${n.space}/${n.meta.id}`} />
          ))}
        </>
      ) : null}
      <div className="caps mt-4">{query.trim() ? "Results" : "Recently opened"}</div>
      {rest.length === 0 ? <div className="t13 text-muted py-5">{query.trim() ? "No notes match that search." : "No other notes yet."}</div> : null}
      {rest.map((n) => (
        <Row key={`${n.space}/${n.meta.id}`} selfUid={uid} note={n} uid={`${n.space}/${n.meta.id}`} />
      ))}
    </Modal>
  );
}

export { Dot };
