import { useEffect, useState } from "react";
import { Tooltip } from "radix-ui";
import { Info, TriangleAlert, X } from "lucide-react";
import { Modal, Prompt } from "./components/ui";
import { isoDate, isTypingTarget } from "./lib/util";
import { boot, createFolder, createGroup, createNote, dismissToast, focusSearch, joinGroup, openDialog, openFind, renameFolder, selectFolder, setView, startFocus, useApp } from "./store/app";
import { AuthScreen } from "./screens/AuthScreen";
import { openBoard, openLinkDialog, TopBar } from "./app/TopBar";
import { Sidebar } from "./app/Sidebar";
import { Canvas } from "./canvas/Canvas";
import { DailyView } from "./daily/DailyView";
import { FocusMode } from "./focus/FocusMode";
import { GraphView } from "./graph/GraphView";
import { CardDialog } from "./group/Board";
import { FolderView, GroupPage, InviteDialog } from "./group/GroupPage";
import { HistoryView, NoteHistoryDialog } from "./history/History";
import { LinkDialog } from "./notes/Links";
import { Tips } from "./onboarding/Onboarding";
import { SettingsDialog } from "./settings/SettingsDialog";

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useApp.getState();
      if (s.status !== "ready") return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const target = e.target as HTMLElement | null;

      if (mod && !e.altKey && key === "f" && !e.shiftKey) {
        // Excalidraw has its own canvas search on the same shortcut.
        if (target?.closest?.(".excalidraw")) return;
        e.preventDefault();
        if (s.focus) return openFind(s.focus.uid);
        if (s.dialog) return;
        const inWindow = (document.activeElement as HTMLElement | null)?.closest?.("[data-window]") as HTMLElement | null;
        const uid = inWindow?.dataset.window;
        // Cursor inside a text note: search that note. Anywhere else: search all notes.
        if (uid && s.notes[uid]?.meta.type === "text") return openFind(uid);
        return focusSearch();
      }
      if (mod && !e.altKey && key === "k") {
        e.preventDefault();
        if (!s.focus && !s.dialog) focusSearch();
        return;
      }
      if (e.key === "Escape" && s.findUid && !s.focus) {
        openFind(null);
        return;
      }
      if (mod || e.altKey || s.focus || s.dialog || isTypingTarget(target)) return;
      if (e.shiftKey && key === "f") {
        e.preventDefault();
        startFocus();
        return;
      }
      if (e.shiftKey) return;
      const actions: Record<string, () => void> = {
        n: () => createNote("text"),
        d: () => createNote("drawing"),
        l: openLinkDialog,
        b: openBoard,
        g: () => setView({ kind: "graph" }),
        t: () => setView({ kind: "daily", date: isoDate() }),
      };
      if (actions[key]) {
        e.preventDefault();
        actions[key]();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="fixed flex flex-col gap-2.5" style={{ right: 24, top: 88, zIndex: 600 }} aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast" role="status">
          <span className="flex-none mt-0.5" style={{ color: t.tone === "warn" ? "var(--warn-ink)" : "var(--brand)" }}>
            {t.tone === "warn" ? <TriangleAlert size={17} /> : <Info size={17} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="t13 font-semibold">{t.title}</div>
            {t.body ? <div className="t12 text-ink-2 mt-0.5">{t.body}</div> : null}
            {t.action ? (
              <button
                className="t12 font-semibold text-brand bg-transparent border-0 p-0 mt-1.5"
                onClick={() => {
                  t.action!.run();
                  dismissToast(t.id);
                }}
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
          <button className="icon-btn" style={{ width: 24, height: 24 }} aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

function Dialogs() {
  const dialog = useApp((s) => s.dialog);
  const folders = useApp((s) => s.folders);
  const user = useApp((s) => s.user);
  if (!dialog) return null;
  const close = () => openDialog(null);
  switch (dialog.kind) {
    case "link":
      return <LinkDialog uid={dialog.uid} />;
    case "settings":
      return <SettingsDialog section={dialog.section} />;
    case "card":
      return <CardDialog space={dialog.space} cardId={dialog.cardId} />;
    case "noteHistory":
      return <NoteHistoryDialog uid={dialog.uid} />;
    case "invite":
      return <InviteDialog groupId={dialog.group} />;
    case "newGroup":
      return (
        <Prompt
          open
          title="New group"
          label="Group name"
          placeholder="Group poster"
          confirmLabel="Create group"
          hint="A group has its own notes, kept separate from your personal notes, plus a shared board. You can invite people next."
          onClose={close}
          onSubmit={async (name) => {
            await createGroup(name);
          }}
        />
      );
    case "joinGroup":
      return (
        <Prompt
          open
          title="Join a group"
          label="Invite link or code"
          placeholder="Paste the link a group member sent you"
          confirmLabel="Join"
          onClose={close}
          onSubmit={async (value) => {
            const code = value.includes("join=") ? (value.split("join=")[1] ?? "").split("&")[0] : value;
            await joinGroup(code.trim());
          }}
        />
      );
    case "newFolder": {
      const existing = dialog.rename ? (folders[`u:${user?.id}`] ?? []).find((f) => f.id === dialog.rename) : null;
      return (
        <Prompt
          open
          title={existing ? "Rename folder" : "New folder"}
          label="Folder name"
          initial={existing?.name ?? ""}
          placeholder="Lectures"
          confirmLabel={existing ? "Rename" : "Create folder"}
          onClose={close}
          onSubmit={(name) => {
            if (existing) renameFolder(existing.id, name);
            else selectFolder(createFolder(name));
          }}
        />
      );
    }
    case "confirm":
      return (
        <Modal
          open
          onClose={close}
          title={dialog.title}
          width={460}
          footer={
            <>
              <span className="flex-1" />
              <button className="btn" onClick={close}>
                Cancel
              </button>
              <button
                className={`btn ${dialog.danger ? "" : "btn-primary"}`}
                style={dialog.danger ? { background: "var(--danger)", borderColor: "var(--danger)", color: "#fff" } : undefined}
                onClick={() => {
                  close();
                  dialog.onConfirm();
                }}
              >
                {dialog.confirmLabel}
              </button>
            </>
          }
        >
          <p className="t14 text-ink-2 m-0">{dialog.body}</p>
        </Modal>
      );
  }
}

function Main() {
  const view = useApp((s) => s.view);
  switch (view.kind) {
    case "folder":
      return <FolderView folder={view.folder} />;
    case "group":
      return <GroupPage groupId={view.group} tab={view.tab} />;
    case "graph":
      return <GraphView />;
    case "daily":
      return <DailyView date={view.date} key={view.date} />;
    case "history":
      return <HistoryView />;
    default:
      return <Canvas />;
  }
}

function Shell() {
  const focus = useApp((s) => !!s.focus);
  useShortcuts();
  return (
    <Tooltip.Provider delayDuration={350}>
      {focus ? (
        <FocusMode />
      ) : (
        <div className="flex flex-col h-full">
          <TopBar />
          <div className="flex flex-1 min-h-0">
            <Sidebar />
            <Main />
          </div>
          <Tips />
        </div>
      )}
      <Dialogs />
      <Toasts />
    </Tooltip.Provider>
  );
}

export function App() {
  const status = useApp((s) => s.status);
  const error = useApp((s) => s.bootError);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    void boot();
    const t = setTimeout(() => setSlow(true), 1500);
    return () => clearTimeout(t);
  }, []);
  if (status === "signedOut") return <AuthScreen />;
  if (status === "ready") return <Shell />;
  return (
    <div className="h-full grid place-items-center bg-canvas" role="status">
      <div className="text-center px-6">
        <span className="grid place-items-center rounded-[12px] bg-brand text-brand-ink font-bold mx-auto" style={{ width: 44, height: 44, fontSize: 22 }}>
          M
        </span>
        {status === "error" ? (
          <>
            <p className="t15 font-semibold mt-5 mb-1">Margin could not start</p>
            <p className="t13 text-muted mt-0 mb-4" style={{ maxWidth: 380 }}>
              {error}
            </p>
            <button className="btn btn-primary" onClick={() => void boot()}>
              Try again
            </button>
          </>
        ) : slow ? (
          <p className="t13 text-muted mt-5">Getting your notes ready…</p>
        ) : null}
      </div>
    </div>
  );
}
