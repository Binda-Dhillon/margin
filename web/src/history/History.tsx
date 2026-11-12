import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText, History as HistoryIcon, Kanban, RotateCcw, Settings } from "lucide-react";
import { Avatar, Empty, Modal } from "../components/ui";
import { noteFromFile } from "../core/notefile";
import type { CommitInfo } from "../core/repo";
import { PATHS, isConflictPath, isNotePath, type Note } from "../core/types";
import { stamp } from "../lib/util";
import { flush, openDialog, personalKey, repoFor, restoreFile, toast, useApp } from "../store/app";
import { spaceLabel } from "../store/select";
import { renderMarkdown, useDrawingImage } from "../notes/render";

function describePath(space: string, path: string, notes: Record<string, Note>): { label: string; kind: "note" | "board" | "other" } {
  if (path === PATHS.board) return { label: "Board", kind: "board" };
  if (path === PATHS.folders) return { label: "Folders", kind: "other" };
  if (path === PATHS.settings) return { label: "Settings", kind: "other" };
  if (isConflictPath(path)) return { label: "Second version kept after an edit clash", kind: "other" };
  if (isNotePath(path)) {
    const id = path.split("/").pop()!.replace(/\.(md|excalidraw)$/, "");
    const note = notes[`${space}/${id}`];
    return { label: note?.meta.title ?? "A note that has since been deleted", kind: "note" };
  }
  return { label: path, kind: "other" };
}

function VersionPreview({ space, path, text }: { space: string; path: string; text: string | null }) {
  const note = useMemo(() => (text !== null && isNotePath(path) ? noteFromFile(space, path, text) : null), [space, path, text]);
  const image = useDrawingImage(note?.meta.type === "drawing" ? note : null);
  if (text === null) return <div className="t13 text-muted p-4">This file did not exist in that version.</div>;
  if (!note) return <pre className="scroll t12 p-4 m-0" style={{ maxHeight: 320, whiteSpace: "pre-wrap" }}>{text.slice(0, 4000)}</pre>;
  if (note.meta.type === "drawing") {
    return (
      <div className="grid place-items-center p-4" style={{ minHeight: 200 }}>
        {image.url ? <img src={image.url} alt={`Version of ${note.meta.title}`} style={{ maxWidth: "100%", maxHeight: 320 }} /> : <span className="t13 text-muted">{image.loading ? "Drawing preview…" : "Empty drawing"}</span>}
      </div>
    );
  }
  return (
    <div className="scroll p-4" style={{ maxHeight: 340 }}>
      <div className="t16 font-semibold mb-2">{note.meta.title}</div>
      <div className="prose" style={{ fontSize: "calc(13px * var(--ts))" }} dangerouslySetInnerHTML={{ __html: note.body.trim() ? renderMarkdown(note.body) : '<p style="color:var(--muted)">Empty note</p>' }} />
    </div>
  );
}

function CommitRow({ space, commit }: { space: string; commit: CommitInfo }) {
  const notes = useApp((s) => s.notes);
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<{ path: string; kind: string }[] | null>(null);
  const [viewing, setViewing] = useState<{ path: string; text: string | null } | null>(null);
  const repo = repoFor(space);

  useEffect(() => {
    if (!open || files || !repo) return;
    void repo.changedIn(commit).then((list) => setFiles(list.filter((f) => !f.path.startsWith(".margin/space"))));
  }, [open, files, repo, commit]);

  const view = async (path: string) => {
    if (!repo) return;
    if (viewing?.path === path) return setViewing(null);
    setViewing({ path, text: await repo.readAt(commit.oid, path) });
  };
  const restore = async (path: string) => {
    if (!repo) return;
    const text = await repo.readAt(commit.oid, path);
    if (text === null) return;
    await restoreFile(space, path, text);
    toast({ title: "Version restored", body: "It was saved as a new version, so nothing is lost." }, { urgent: true });
  };
  const merge = commit.parents.length > 1;

  return (
    <li className="border-b border-hair" data-commit={commit.oid}>
      <button className="flex items-center gap-3 w-full bg-transparent border-0 text-left py-3 px-1" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? <ChevronDown size={16} className="text-muted flex-none" /> : <ChevronRight size={16} className="text-muted flex-none" />}
        <Avatar name={commit.authorName} id={commit.authorEmail} size={28} />
        <span className="min-w-0 flex-1">
          <span className="block t14 font-medium truncate">{merge ? "Combined changes from two devices" : commit.message.split("\n")[0]}</span>
          <span className="block t12 text-muted">
            {commit.authorName} · {stamp(commit.time)}
          </span>
        </span>
      </button>
      {open ? (
        <div className="pl-12 pb-3">
          {!files ? <div className="t12 text-muted">Loading…</div> : null}
          {files && files.length === 0 ? <div className="t12 text-muted">No file changes.</div> : null}
          {files?.map((f) => {
            const d = describePath(space, f.path, notes);
            const Icon = d.kind === "board" ? Kanban : d.kind === "note" ? FileText : Settings;
            return (
              <div key={f.path}>
                <div className="flex items-center gap-2.5 py-1.5">
                  <Icon size={14} className="text-muted flex-none" />
                  <span className="t13 truncate flex-1">{d.label}</span>
                  <span className="t11 text-muted">{f.kind}</span>
                  {f.kind !== "removed" ? (
                    <>
                      <button className="btn btn-sm" onClick={() => void view(f.path)}>
                        {viewing?.path === f.path ? "Hide" : "View"}
                      </button>
                      <button className="btn btn-sm" onClick={() => void restore(f.path)} title="Bring this version back as the current one">
                        <RotateCcw size={13} /> Restore
                      </button>
                    </>
                  ) : null}
                </div>
                {viewing?.path === f.path ? (
                  <div className="rounded-lg border border-line my-2 bg-surface">
                    <VersionPreview space={space} path={f.path} text={viewing.text} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </li>
  );
}

/** Who changed what and when in a space, with restore per file. */
export function SpaceHistory({ space }: { space: string }) {
  const syncedAt = useApp((s) => s.spaces[space]?.syncedAt);
  const [commits, setCommits] = useState<CommitInfo[] | null>(null);
  useEffect(() => {
    let live = true;
    const repo = repoFor(space);
    if (!repo) return;
    void flush()
      .then(() => repo.log(80))
      .then((list) => live && setCommits(list))
      .catch(() => live && setCommits([]));
    return () => {
      live = false;
    };
  }, [space, syncedAt]);
  if (!commits) return <div className="t13 text-muted py-6">Loading history…</div>;
  if (commits.length <= 1) return <Empty icon={<HistoryIcon size={28} />} title="No history yet" body="Every sync is recorded here with who made it, so earlier versions can be brought back." />;
  return (
    <ul className="list-none p-0 m-0" data-testid="history">
      {commits.map((c) => (
        <CommitRow key={c.oid} space={space} commit={c} />
      ))}
    </ul>
  );
}

export function HistoryView() {
  const groups = useApp((s) => s.groups);
  const [space, setSpace] = useState(personalKey());
  return (
    <div className="scroll flex-1 min-w-0 bg-canvas" style={{ padding: "28px 32px" }}>
      <div style={{ maxWidth: 860 }}>
        <h1 className="t22 font-bold m-0">Version history</h1>
        <p className="t13 text-muted mt-1.5 mb-5">Each entry is one sync from one person. Open it to see the notes it changed and restore any of them.</p>
        <div className="seg mb-4" role="tablist">
          <button data-on={space === personalKey()} onClick={() => setSpace(personalKey())}>
            My notes
          </button>
          {groups.map((g) => (
            <button key={g.id} data-on={space === `g:${g.id}`} onClick={() => setSpace(`g:${g.id}`)}>
              {g.name}
            </button>
          ))}
        </div>
        <div className="bg-surface border border-line rounded-xl px-4">
          <SpaceHistory space={space} key={space} />
        </div>
      </div>
    </div>
  );
}

/** Versions of a single note. */
export function NoteHistoryDialog({ uid }: { uid: string }) {
  const note = useApp((s) => s.notes[uid]);
  const [versions, setVersions] = useState<CommitInfo[] | null>(null);
  const [selected, setSelected] = useState<{ oid: string; text: string | null } | null>(null);
  const space = uid.slice(0, uid.indexOf("/"));
  const path = note?.path ?? "";

  useEffect(() => {
    const repo = repoFor(space);
    if (!repo || !path) return;
    let live = true;
    void flush()
      .then(() => repo.fileHistory(path, 40))
      .then(async (list) => {
        if (!live) return;
        setVersions(list);
        if (list[0]) setSelected({ oid: list[0].oid, text: await repo.readAt(list[0].oid, path) });
      })
      .catch(() => live && setVersions([]));
    return () => {
      live = false;
    };
  }, [space, path]);

  if (!note) return null;
  const pick = async (oid: string) => {
    const repo = repoFor(space);
    if (repo) setSelected({ oid, text: await repo.readAt(oid, path) });
  };
  const isCurrent = versions?.[0]?.oid === selected?.oid;

  return (
    <Modal
      open
      onClose={() => openDialog(null)}
      title={`Versions of “${note.meta.title}”`}
      icon={<HistoryIcon size={18} />}
      width={860}
      padded={false}
      footer={
        <>
          <span className="t12 text-muted flex-1">{spaceLabel(space)} · restoring saves the old content as a new version.</span>
          <button className="btn" onClick={() => openDialog(null)}>
            Close
          </button>
          <button
            className="btn btn-primary"
            disabled={!selected || selected.text === null || isCurrent}
            onClick={async () => {
              if (!selected || selected.text === null) return;
              await restoreFile(space, path, selected.text);
              openDialog(null);
              toast({ title: "Version restored" }, { urgent: true });
            }}
          >
            <RotateCcw size={15} /> Restore this version
          </button>
        </>
      }
    >
      <div className="flex border-t border-hair" style={{ minHeight: 380 }}>
        <ul className="scroll list-none m-0 p-2 border-r border-hair flex-none" style={{ width: 280, maxHeight: 460 }} data-testid="note-versions">
          {!versions ? <li className="t13 text-muted p-3">Loading…</li> : null}
          {versions && versions.length === 0 ? <li className="t13 text-muted p-3">This note has not been synced yet, so it has no earlier versions.</li> : null}
          {versions?.map((v, i) => (
            <li key={v.oid}>
              <button className="menu-item" data-on={selected?.oid === v.oid || undefined} style={{ alignItems: "flex-start" }} onClick={() => void pick(v.oid)}>
                <Avatar name={v.authorName} id={v.authorEmail} size={24} />
                <span className="min-w-0">
                  <span className="block t13 font-medium">
                    {stamp(v.time)}
                    {i === 0 ? " · current" : ""}
                  </span>
                  <span className="block t11 text-muted font-normal truncate">{v.authorName}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex-1 min-w-0">{selected ? <VersionPreview space={space} path={path} text={selected.text} /> : null}</div>
      </div>
    </Modal>
  );
}
