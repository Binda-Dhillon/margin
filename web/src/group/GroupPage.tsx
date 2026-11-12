import { useMemo, useState } from "react";
import { Calendar, Check, ChevronDown, Copy, FilePlus, FileText, History, Kanban, ListFilter, LogOut, Pencil, RefreshCw, Trash2, UserPlus, Users } from "lucide-react";
import { Avatar, Dot, Empty, Menu, MenuContent, MenuItem, MenuSep, MenuTrigger, Modal, NoteIcon, Popover, PopoverContent, PopoverTrigger } from "../components/ui";
import type { Note } from "../core/types";
import { api, type Group } from "../lib/api";
import { daysUntil, shortDate } from "../lib/util";
import { createNote, groupKey, openDialog, openGroup, openNote, personalKey, refreshGroups, toast, useApp, type GroupTab } from "../store/app";
import { isOwnSharedCopy, linkCount } from "../store/select";
import { editedLine, Hover } from "../notes/HoverPreview";
import { ACCESS_LABEL } from "../notes/Links";
import { SpaceHistory } from "../history/History";
import { Board } from "./Board";

// ------------------------------------------------------------ note lists --

export function NoteRow({ note, uid }: { note: Note; uid: string }) {
  const userId = useApp((s) => s.user?.id);
  const notes = useApp((s) => s.notes);
  const now = useApp((s) => s.now);
  const links = linkCount(uid, notes, userId);
  const locked = note.meta.sharedAccess === "private" && note.meta.sharedOwner !== userId;
  return (
    <Hover uid={uid} side="bottom">
      <button className="flex items-center gap-3 w-full bg-surface border-0 border-b border-hair text-left px-4 hover:bg-surface-3" style={{ minHeight: 56 }} onClick={() => !locked && openNote(uid)} data-note-row={uid} aria-disabled={locked}>
        <Dot note={note} />
        <span className="text-muted flex">
          <NoteIcon note={note} size={15} />
        </span>
        <span className="min-w-0 flex-1 py-2">
          <span className="block t14 font-medium truncate">{note.meta.title}</span>
          <span className="block t12 text-muted truncate">
            {note.meta.sharedOwner ? `${note.meta.sharedOwner === userId ? "Your personal note" : `${note.meta.sharedOwnerName}’s personal note`} · ${ACCESS_LABEL[note.meta.sharedAccess ?? "view"]} · ` : ""}
            {editedLine(note, userId, now).replace(/^e/, "E")}
          </span>
        </span>
        {note.conflict ? <span className="badge badge-warn">2 versions</span> : null}
        {links > 0 ? (
          <span className="t12 text-muted flex-none">
            {links} link{links === 1 ? "" : "s"}
          </span>
        ) : null}
      </button>
    </Hover>
  );
}

function sortNotes(list: Note[]): Note[] {
  return [...list].sort((a, b) => (Date.parse(b.meta.updated) || 0) - (Date.parse(a.meta.updated) || 0));
}

/** Personal notes in a folder (or all of them). */
export function FolderView({ folder }: { folder: string | null }) {
  const notes = useApp((s) => s.notes);
  const folders = useApp((s) => s.folders[personalKey()] ?? []);
  const pKey = personalKey();
  const name = folder ? (folders.find((f) => f.id === folder)?.name ?? "Folder") : "My notes";
  const list = useMemo(
    () => sortNotes(Object.values(notes).filter((n) => n.space === pKey && n.meta.type !== "daily" && (!folder || n.meta.folder === folder))),
    [notes, pKey, folder],
  );
  return (
    <div className="scroll flex-1 min-w-0 bg-canvas" style={{ padding: "28px 32px" }}>
      <div style={{ maxWidth: 900 }}>
        <div className="flex items-center gap-3 mb-5">
          <h1 className="t22 font-bold m-0">{name}</h1>
          <span className="t13 text-muted">
            {list.length} note{list.length === 1 ? "" : "s"}
          </span>
          <span className="flex-1" />
          <button className="btn" onClick={() => createNote("drawing", { space: pKey, folder })}>
            <Pencil size={16} /> New drawing
          </button>
          <button className="btn btn-primary" onClick={() => createNote("text", { space: pKey, folder })}>
            <FilePlus size={16} /> New note
          </button>
        </div>
        <div className="bg-surface border border-line rounded-xl overflow-hidden" data-testid="note-list">
          {list.length === 0 ? (
            <Empty icon={<FileText size={28} />} title="No notes here yet" body="Notes you create while this folder is selected are filed here. Group notes live under Groups, separate from these." />
          ) : (
            list.map((n) => <NoteRow key={n.meta.id} note={n} uid={`${n.space}/${n.meta.id}`} />)
          )}
        </div>
      </div>
    </div>
  );
}

function GroupNotes({ group }: { group: Group }) {
  const notes = useApp((s) => s.notes);
  const userId = useApp((s) => s.user?.id);
  const key = groupKey(group.id);
  const { own, shared } = useMemo(() => {
    const inSpace = Object.values(notes).filter((n) => n.space === key);
    return { own: sortNotes(inSpace.filter((n) => !n.meta.sharedOwner)), shared: sortNotes(inSpace.filter((n) => n.meta.sharedOwner)) };
  }, [notes, key]);
  return (
    <div className="scroll flex-1 min-h-0" style={{ maxWidth: 900 }}>
      <div className="flex items-center gap-3 mb-3">
        <span className="t13 text-muted flex-1">Everyone in {group.name} can open and edit these. Each change is marked with who made it.</span>
        <button className="btn" onClick={() => createNote("drawing", { space: key })}>
          <Pencil size={16} /> New drawing
        </button>
        <button className="btn btn-primary" onClick={() => createNote("text", { space: key })}>
          <FilePlus size={16} /> New group note
        </button>
      </div>
      <div className="bg-surface border border-line rounded-xl overflow-hidden" data-testid="group-notes">
        {own.length === 0 ? <Empty icon={<FileText size={28} />} title="No group notes yet" body="Start one here, or link a personal note to share it at the level you choose." /> : own.map((n) => <NoteRow key={n.meta.id} note={n} uid={`${n.space}/${n.meta.id}`} />)}
      </div>
      {shared.length > 0 ? (
        <>
          <div className="caps mt-6 mb-2">Personal notes linked into this group</div>
          <div className="bg-surface border border-line rounded-xl overflow-hidden" data-testid="shared-notes">
            {shared.map((n) => (
              <NoteRow key={n.meta.id} note={n} uid={isOwnSharedCopy(n, userId) ? `u:${userId}/${n.meta.id}` : `${n.space}/${n.meta.id}`} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- members --

function inviteUrl(group: Group) {
  return `${window.location.origin}/?join=${group.inviteCode}`;
}

function InviteForm({ group }: { group: Group }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const add = async () => {
    if (!email.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await api("POST", `/api/groups/${group.id}/members`, { email: email.trim() });
      setMessage({ ok: true, text: `Added ${email.trim()}. The group now appears in their sidebar.` });
      setEmail("");
      await refreshGroups();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Could not add them" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <label className="field-label" htmlFor="invite-email">
        Add someone by their account email
      </label>
      <div className="flex gap-2">
        <input id="invite-email" className="input" type="email" placeholder="name@student.uni.ac.uk" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
        <button className="btn btn-primary" style={{ height: 40 }} onClick={() => void add()} disabled={!email.trim() || busy}>
          <UserPlus size={16} /> Add
        </button>
      </div>
      {message ? (
        <p className="t12 mt-2 mb-0" style={{ color: message.ok ? "var(--brand)" : "var(--danger)" }} role={message.ok ? "status" : "alert"}>
          {message.text}
        </p>
      ) : null}
      <label className="field-label mt-5" htmlFor="invite-link">
        Or send an invite link
      </label>
      <div className="flex gap-2">
        <input id="invite-link" className="input" readOnly value={inviteUrl(group)} onFocus={(e) => e.target.select()} />
        <button
          className="btn"
          style={{ height: 40 }}
          onClick={async () => {
            await navigator.clipboard.writeText(inviteUrl(group)).catch(() => undefined);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          }}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="t12 text-muted mt-2 mb-0">
        Anyone signed in to this server who opens the link joins the group.{" "}
        <button
          className="bg-transparent border-0 p-0 text-brand font-semibold"
          onClick={async () => {
            await api("POST", `/api/groups/${group.id}/invite-code`);
            await refreshGroups();
          }}
        >
          <RefreshCw size={11} className="inline" /> Make a new link
        </button>{" "}
        to stop the old one working.
      </p>
    </div>
  );
}

export function InviteDialog({ groupId }: { groupId: string }) {
  const group = useApp((s) => s.groups.find((g) => g.id === groupId));
  if (!group) return null;
  return (
    <Modal open onClose={() => openDialog(null)} title={`Invite to ${group.name}`} icon={<UserPlus size={18} />} width={520}>
      <InviteForm group={group} />
    </Modal>
  );
}

function Members({ group }: { group: Group }) {
  const user = useApp((s) => s.user)!;
  const isOwner = group.role === "owner";
  const remove = (memberId: string, name: string) => {
    const self = memberId === user.id;
    openDialog({
      kind: "confirm",
      title: self ? `Leave ${group.name}?` : `Remove ${name} from ${group.name}?`,
      body: self
        ? "The group’s notes and board are removed from this device. Personal notes you linked into the group stay yours."
        : "They lose access to the group’s notes and board. Notes they already downloaded stay on their device.",
      confirmLabel: self ? "Leave group" : "Remove",
      danger: true,
      onConfirm: async () => {
        try {
          await api("DELETE", `/api/groups/${group.id}/members/${memberId}`);
          await refreshGroups();
        } catch (err) {
          toast({ title: "That did not work", body: err instanceof Error ? err.message : undefined, tone: "warn" }, { urgent: true });
        }
      },
    });
  };
  return (
    <div className="scroll flex-1 min-h-0" style={{ maxWidth: 760 }}>
      <div className="bg-surface border border-line rounded-xl overflow-hidden" data-testid="members">
        {group.members.map((m) => (
          <div key={m.id} className="flex items-center gap-3 px-4 border-b border-hair" style={{ minHeight: 60 }}>
            <Avatar name={m.name} id={m.id} size={34} />
            <div className="min-w-0 flex-1">
              <div className="t14 font-medium truncate">
                {m.name}
                {m.id === user.id ? <span className="text-muted font-normal"> (you)</span> : null}
              </div>
              <div className="t12 text-muted truncate">{m.email}</div>
            </div>
            <span className="badge badge-muted">{m.role === "owner" ? "Owner" : "Member"}</span>
            {m.id === user.id ? (
              <button className="btn btn-sm" onClick={() => remove(m.id, m.name)}>
                <LogOut size={13} /> Leave
              </button>
            ) : isOwner ? (
              <button className="btn btn-sm btn-danger" onClick={() => remove(m.id, m.name)}>
                Remove
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <div className="bg-surface border border-line rounded-xl p-5 mt-5">
        <InviteForm group={group} />
      </div>
      {isOwner ? (
        <button
          className="btn btn-danger mt-5"
          onClick={() =>
            openDialog({
              kind: "confirm",
              title: `Delete ${group.name}?`,
              body: "The group, its notes, its board and its history are removed for every member. This cannot be undone.",
              confirmLabel: "Delete group",
              danger: true,
              onConfirm: async () => {
                await api("DELETE", `/api/groups/${group.id}`).catch(() => undefined);
                await refreshGroups();
              },
            })
          }
        >
          <Trash2 size={15} /> Delete group
        </button>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------- page --

function Deadline({ group }: { group: Group }) {
  const [label, setLabel] = useState(group.dueLabel ?? "");
  const [date, setDate] = useState(group.dueDate ?? "");
  const [open, setOpen] = useState(false);
  const save = async (l: string, d: string) => {
    await api("PATCH", `/api/groups/${group.id}`, { dueLabel: l || null, dueDate: d || null }).catch(() => undefined);
    await refreshGroups();
    setOpen(false);
  };
  const soon = group.dueDate ? daysUntil(group.dueDate) <= 3 : false;
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setLabel(group.dueLabel ?? "");
          setDate(group.dueDate ?? "");
        }
      }}
    >
      <PopoverTrigger asChild>
        {group.dueDate ? (
          <button className={`badge ${soon ? "badge-warn" : "badge-muted"} border-0`} style={{ height: 24 }} data-testid="deadline">
            <Calendar size={12} /> {group.dueLabel || "Due"} {shortDate(group.dueDate)}
          </button>
        ) : (
          <button className="badge badge-muted border-0" style={{ height: 24, background: "transparent", boxShadow: "inset 0 0 0 1px var(--line)" }}>
            <Calendar size={12} /> Add a deadline
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent width={300}>
        <div className="p-2">
          <label className="field-label" htmlFor="due-label">
            What is due
          </label>
          <input id="due-label" className="input" placeholder="Poster due" value={label} onChange={(e) => setLabel(e.target.value)} />
          <label className="field-label mt-3" htmlFor="due-date">
            When
          </label>
          <input id="due-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          <div className="flex gap-2 mt-3">
            {group.dueDate ? (
              <button className="btn btn-sm" onClick={() => void save("", "")}>
                Clear
              </button>
            ) : null}
            <span className="flex-1" />
            <button className="btn btn-sm btn-primary" disabled={!date} onClick={() => void save(label.trim(), date)}>
              Save
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function GroupPage({ groupId, tab }: { groupId: string; tab: GroupTab }) {
  const group = useApp((s) => s.groups.find((g) => g.id === groupId));
  const space = useApp((s) => s.spaces[groupKey(groupId)]);
  const noteCount = useApp((s) => Object.values(s.notes).filter((n) => n.space === groupKey(groupId) && !n.meta.sharedOwner).length);
  const [filter, setFilter] = useState<string | null>(null);
  if (!group) {
    return (
      <div className="flex-1 bg-canvas">
        <Empty icon={<Users size={28} />} title="This group is no longer available" body="You may have been removed from it, or it was deleted." />
      </div>
    );
  }
  const key = groupKey(groupId);
  const tabs: { id: GroupTab; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: "board", label: "Board", icon: <Kanban size={15} /> },
    { id: "notes", label: "Notes", icon: <FileText size={15} />, count: noteCount },
    { id: "members", label: "Members", icon: <Users size={15} />, count: group.members.length },
    { id: "history", label: "History", icon: <History size={15} /> },
  ];
  const filtered = group.members.find((m) => m.id === filter);

  return (
    <div className="flex flex-col flex-1 min-w-0 bg-canvas" style={{ padding: "26px 28px 0" }} data-testid="group-page">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="t22 font-bold m-0">{group.name}</h1>
        <Deadline group={group} />
        <div className="flex items-center ml-2">
          {group.members.slice(0, 6).map((m, i) => (
            <Avatar key={m.id} name={m.name} id={m.id} size={28} style={{ marginLeft: i ? -7 : 0, boxShadow: "0 0 0 2px var(--canvas)" }} />
          ))}
        </div>
        <button className="btn btn-sm" style={{ height: 32 }} onClick={() => openDialog({ kind: "invite", group: group.id })}>
          <UserPlus size={14} /> Invite
        </button>
        <span className="flex-1" />
        {tab === "board" ? (
          <Menu>
            <MenuTrigger asChild>
              <button className="btn" data-testid="people-filter">
                <ListFilter size={15} /> {filtered ? filtered.name : "Everyone"} <ChevronDown size={14} />
              </button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem on={!filter} onSelect={() => setFilter(null)}>
                Everyone
              </MenuItem>
              <MenuSep />
              {group.members.map((m) => (
                <MenuItem key={m.id} on={filter === m.id} icon={<Avatar name={m.name} id={m.id} size={18} />} onSelect={() => setFilter(m.id)}>
                  {m.name}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        ) : null}
      </div>
      <div className="flex border-b border-line mt-4 mb-5" role="tablist" aria-label={`${group.name} sections`}>
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className="tab" data-on={tab === t.id} onClick={() => openGroup(group.id, t.id)}>
            {t.icon} {t.label}
            {t.count !== undefined ? <span className="text-muted font-normal">{t.count}</span> : null}
          </button>
        ))}
      </div>
      {!space?.loaded ? (
        <div className="t13 text-muted py-10">Getting this group’s notes for the first time…</div>
      ) : tab === "board" ? (
        <Board space={key} members={group.members} filter={filter} />
      ) : tab === "notes" ? (
        <GroupNotes group={group} />
      ) : tab === "members" ? (
        <Members group={group} />
      ) : (
        <div className="scroll flex-1 min-h-0" style={{ maxWidth: 860 }}>
          <div className="bg-surface border border-line rounded-xl px-4 mb-6">
            <SpaceHistory space={key} />
          </div>
        </div>
      )}
    </div>
  );
}
