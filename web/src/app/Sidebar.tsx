import { useMemo } from "react";
import { Cloud, CloudOff, Ellipsis, Folder as FolderIcon, History, Pencil, Plus, RefreshCw, Trash2, Users, X } from "lucide-react";
import { Dot, Menu, MenuContent, MenuItem, MenuTrigger } from "../components/ui";
import { clock } from "../lib/util";
import { deleteFolder, dismissServerNote, groupKey, openDialog, openGroup, openNote, personalKey, selectFolder, setView, syncAll, useApp } from "../store/app";
import { isOwnSharedCopy } from "../store/select";
import { Hover } from "../notes/HoverPreview";

function SyncStatus() {
  const spaces = useApp((s) => s.spaces);
  const offline = useApp((s) => s.offline);
  const list = Object.values(spaces);
  const syncing = list.some((s) => s.syncing);
  const pending = list.some((s) => s.pending);
  const error = list.find((s) => s.error)?.error;
  const last = Math.max(0, ...list.map((s) => s.syncedAt ?? 0));
  let icon = <Cloud size={14} />;
  let text = last ? `Synced ${clock(last)}` : "Connecting…";
  if (offline) {
    icon = <CloudOff size={14} />;
    text = pending ? "Offline. Changes are saved on this device" : "Offline";
  } else if (syncing) {
    icon = <RefreshCw size={14} className="animate-spin" />;
    text = "Syncing…";
  } else if (error) {
    icon = <CloudOff size={14} />;
    text = "Sync problem. Trying again";
  } else if (pending) {
    text = "Saving changes…";
  }
  return (
    <button
      className="flex items-center gap-2 w-full t11 text-muted bg-transparent border-0 px-2 py-1.5 rounded-md hover:bg-surface-2 text-left"
      onClick={() => void syncAll()}
      title={error ?? "Sync now"}
      data-testid="sync-status"
    >
      {icon}
      <span className="truncate">{text}</span>
    </button>
  );
}

function NotificationCard() {
  const note = useApp((s) => s.serverNotes[0]);
  if (!note) return null;
  const added = note.kind === "added-to-group";
  return (
    <div className="rounded-[10px] bg-surface-2 p-3 mb-2 relative" role="status">
      <button className="icon-btn absolute right-1 top-1" style={{ width: 24, height: 24 }} aria-label="Dismiss" onClick={() => void dismissServerNote(note.id)}>
        <X size={13} />
      </button>
      <div className="t12 font-semibold pr-5">{added ? `${note.payload.byName} added you to a group` : `${note.payload.byName} removed you from a group`}</div>
      <div className="t11 text-muted mt-1">
        “{note.payload.groupName}” {added ? "now appears under Groups." : "no longer appears under Groups."}
      </div>
      {added ? (
        <button
          className="flex items-center gap-1.5 t12 font-semibold text-brand bg-transparent border-0 p-0 mt-2"
          onClick={() => {
            openGroup(note.payload.groupId, "board");
            void dismissServerNote(note.id);
          }}
        >
          <Users size={13} /> Open group
        </button>
      ) : null}
    </div>
  );
}

export function Sidebar() {
  const notes = useApp((s) => s.notes);
  const userId = useApp((s) => s.user?.id);
  const folders = useApp((s) => s.folders[personalKey()]);
  const groups = useApp((s) => s.groups);
  const spaces = useApp((s) => s.spaces);
  const recent = useApp((s) => s.recent);
  const view = useApp((s) => s.view);
  const context = useApp((s) => s.context);
  const pKey = personalKey();

  const counts = useMemo(() => {
    const byFolder = new Map<string, number>();
    const bySpace = new Map<string, number>();
    for (const n of Object.values(notes)) {
      if (n.meta.type === "daily" || isOwnSharedCopy(n, userId)) continue;
      bySpace.set(n.space, (bySpace.get(n.space) ?? 0) + 1);
      if (n.space === pKey && n.meta.folder) byFolder.set(n.meta.folder, (byFolder.get(n.meta.folder) ?? 0) + 1);
    }
    return { byFolder, bySpace };
  }, [notes, userId, pKey]);

  const liveFolders = (folders ?? []).filter((f) => !f.deleted);
  const folderActive = (id: string | null) => (view.kind === "folder" ? view.folder === id : view.kind === "canvas" && context.space === pKey && context.folder === id);
  const groupActive = (id: string) => (view.kind === "group" ? view.group === id : view.kind === "canvas" && context.space === groupKey(id));
  const recentNotes = recent.map((uid) => ({ uid, note: notes[uid] })).filter((r) => r.note);

  return (
    <aside className="flex flex-col bg-surface border-r border-line flex-none" style={{ width: 248 }} aria-label="Folders, groups and recent notes">
      <div className="scroll flex-1 min-h-0" style={{ padding: "24px 14px 8px" }}>
        <div className="caps px-2 mb-2">Folders</div>
        <button className="side-item" data-active={folderActive(null) || undefined} onClick={() => selectFolder(null)}>
          <FolderIcon size={18} />
          <span className="truncate">My notes</span>
          <span className="count">{counts.bySpace.get(pKey) ?? 0}</span>
        </button>
        {liveFolders.map((f) => (
          <div key={f.id} className="relative group">
            <button className="side-item" data-active={folderActive(f.id) || undefined} onClick={() => selectFolder(f.id)}>
              <FolderIcon size={18} />
              <span className="truncate">{f.name}</span>
              <span className="count group-hover:opacity-0 group-focus-within:opacity-0">{counts.byFolder.get(f.id) ?? 0}</span>
            </button>
            <Menu>
              <MenuTrigger asChild>
                <button className="icon-btn absolute right-1 top-1 opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100" style={{ width: 28, height: 28 }} aria-label={`Options for ${f.name}`}>
                  <Ellipsis size={15} />
                </button>
              </MenuTrigger>
              <MenuContent align="start">
                <MenuItem icon={<Pencil size={14} />} onSelect={() => openDialog({ kind: "newFolder", rename: f.id })}>
                  Rename
                </MenuItem>
                <MenuItem
                  icon={<Trash2 size={14} />}
                  danger
                  onSelect={() =>
                    openDialog({
                      kind: "confirm",
                      title: `Remove the folder “${f.name}”?`,
                      body: "Its notes are kept and move to My notes.",
                      confirmLabel: "Remove folder",
                      danger: true,
                      onConfirm: () => deleteFolder(f.id),
                    })
                  }
                >
                  Remove folder
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        ))}

        <div className="flex items-center px-2 mt-7 mb-2">
          <span className="caps">Groups</span>
          <button className="ml-auto flex items-center gap-1 t12 font-semibold text-brand bg-transparent border-0 p-0" onClick={() => openDialog({ kind: "newGroup" })}>
            <Plus size={13} /> New group
          </button>
        </div>
        {groups.length === 0 ? <div className="t12 text-muted px-2 py-1">Share notes and a task board with your course mates.</div> : null}
        {groups.map((g) => (
          <button key={g.id} className="side-item" data-active={groupActive(g.id) || undefined} onClick={() => openGroup(g.id, "board")}>
            <Users size={18} />
            <span className="truncate">{g.name}</span>
            <span className="count">{spaces[groupKey(g.id)]?.loaded ? (counts.bySpace.get(groupKey(g.id)) ?? 0) : "…"}</span>
          </button>
        ))}

        {recentNotes.length > 0 ? (
          <>
            <div className="caps px-2 mt-7 mb-2">Recent</div>
            {recentNotes.map(({ uid, note }) => (
              <Hover key={uid} uid={uid}>
                <button className="side-item side-note" onClick={() => openNote(uid)} data-recent={uid}>
                  <Dot note={note} />
                  <span className="truncate">{note.meta.title}</span>
                </button>
              </Hover>
            ))}
          </>
        ) : null}
      </div>
      <div style={{ padding: "8px 14px 12px" }}>
        <NotificationCard />
        <button
          className="flex items-center gap-2 w-full t11 text-muted bg-transparent border-0 px-2 py-1.5 rounded-md hover:bg-surface-2 text-left"
          onClick={() => setView({ kind: "history" })}
        >
          <History size={14} /> Version history
        </button>
        <SyncStatus />
      </div>
    </aside>
  );
}
