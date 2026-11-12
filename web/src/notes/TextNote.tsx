import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { Bold, ChevronDown, ChevronUp, CircleCheck, CloudOff, Highlighter, Image as ImageIcon, Italic, Link2, List, ListChecks, Lock, Mic, TriangleAlert, Underline as UnderlineIcon, X } from "lucide-react";
import { Menu, MenuContent, MenuItem, MenuTrigger, Popover, PopoverContent, PopoverTrigger, Tip } from "../components/ui";
import { wordCount } from "../core/notefile";
import { clock, MOD, stamp } from "../lib/util";
import { canEdit, openFind, patchNote, resolveConflict, useApp } from "../store/app";
import { folderName, spaceLabel } from "../store/select";
import { Selection } from "@tiptap/pm/state";
import { Find, findKey } from "./find";
import { editedLine } from "./HoverPreview";
import { LinkedRow } from "./Links";
import { renderMarkdown } from "./render";

const STYLES = [
  { id: "p", label: "Body text" },
  { id: "h1", label: "Title" },
  { id: "h2", label: "Heading" },
  { id: "h3", label: "Small heading" },
  { id: "quote", label: "Quote" },
] as const;

function currentStyle(editor: Editor): (typeof STYLES)[number]["id"] {
  if (editor.isActive("heading", { level: 1 })) return "h1";
  if (editor.isActive("heading", { level: 2 })) return "h2";
  if (editor.isActive("heading", { level: 3 })) return "h3";
  if (editor.isActive("blockquote")) return "quote";
  return "p";
}

function applyStyle(editor: Editor, id: string) {
  const chain = editor.chain().focus();
  if (editor.isActive("blockquote")) chain.toggleBlockquote();
  if (id === "p") chain.setParagraph().run();
  else if (id === "quote") chain.setParagraph().toggleBlockquote().run();
  else chain.setHeading({ level: Number(id[1]) as 1 | 2 | 3 }).run();
}

async function fileToDataUrl(file: File, max = 1280): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  if (file.type === "image/svg+xml" || file.type === "image/gif") return raw;
  const img = new window.Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = raw;
  });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  if (scale === 1 && raw.length < 400_000) return raw;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SpeechRecognitionCtor: any = typeof window !== "undefined" ? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition) : undefined;

/** Dictation into any text sink, where the browser supports speech recognition. */
export function useDictation(onText: (text: string) => void) {
  const [on, setOn] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rec = useRef<any>(null);
  const sink = useRef(onText);
  sink.current = onText;
  useEffect(() => () => rec.current?.stop(), []);
  const toggle = () => {
    if (!SpeechRecognitionCtor) return;
    if (on) {
      rec.current?.stop();
      return;
    }
    const r = new SpeechRecognitionCtor();
    r.continuous = true;
    r.interimResults = false;
    r.lang = navigator.language || "en-GB";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) sink.current(String(e.results[i][0].transcript).trim());
      }
    };
    r.onend = () => setOn(false);
    r.onerror = () => setOn(false);
    rec.current = r;
    r.start();
    setOn(true);
  };
  return { supported: !!SpeechRecognitionCtor, on, toggle };
}

function FormatBar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      style: currentStyle(e),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      highlight: e.isActive("highlight"),
      bullet: e.isActive("bulletList"),
      task: e.isActive("taskList"),
      link: e.isActive("link"),
    }),
  });
  const [url, setUrl] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dictation = useDictation((text) => editor.chain().focus().insertContent(text + " ").run());

  return (
    <div className="format-bar" role="toolbar" aria-label="Formatting">
      <Menu>
        <MenuTrigger asChild>
          <button className="btn btn-sm" style={{ width: 132, justifyContent: "space-between", fontWeight: 500, color: "var(--ink-2)" }} aria-label="Text style">
            {STYLES.find((s) => s.id === state.style)?.label}
            <ChevronDown size={14} />
          </button>
        </MenuTrigger>
        <MenuContent>
          {STYLES.map((s) => (
            <MenuItem key={s.id} on={state.style === s.id} onSelect={() => applyStyle(editor, s.id)}>
              {s.label}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
      <span className="sep" />
      <Tip label="Bold" keys={`${MOD} B`}>
        <button className="icon-btn" data-active={state.bold || undefined} aria-pressed={state.bold} aria-label="Bold" onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold size={16} />
        </button>
      </Tip>
      <Tip label="Italic" keys={`${MOD} I`}>
        <button className="icon-btn" data-active={state.italic || undefined} aria-pressed={state.italic} aria-label="Italic" onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic size={16} />
        </button>
      </Tip>
      <Tip label="Underline" keys={`${MOD} U`}>
        <button className="icon-btn" data-active={state.underline || undefined} aria-pressed={state.underline} aria-label="Underline" onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon size={16} />
        </button>
      </Tip>
      <Tip label="Highlight" keys={`${MOD} Shift H`}>
        <button className="icon-btn" data-active={state.highlight || undefined} aria-pressed={state.highlight} aria-label="Highlight" onClick={() => editor.chain().focus().toggleHighlight().run()}>
          <Highlighter size={16} />
        </button>
      </Tip>
      <span className="sep" />
      <Tip label="Bulleted list">
        <button className="icon-btn" data-active={state.bullet || undefined} aria-pressed={state.bullet} aria-label="Bulleted list" onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List size={16} />
        </button>
      </Tip>
      <Tip label="Checklist">
        <button className="icon-btn" data-active={state.task || undefined} aria-pressed={state.task} aria-label="Checklist" onClick={() => editor.chain().focus().toggleTaskList().run()}>
          <ListChecks size={16} />
        </button>
      </Tip>
      <Popover
        open={linkOpen}
        onOpenChange={(o) => {
          setLinkOpen(o);
          if (o) setUrl((editor.getAttributes("link").href as string) ?? "");
        }}
      >
        <Tip label="Web link">
          <PopoverTrigger asChild>
            <button className="icon-btn" data-active={state.link || undefined} aria-label="Web link">
              <Link2 size={16} />
            </button>
          </PopoverTrigger>
        </Tip>
        <PopoverContent width={320}>
          <form
            className="flex gap-2 p-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const href = url.trim();
              if (!href) editor.chain().focus().extendMarkRange("link").unsetLink().run();
              else {
                const full = /^[a-z]+:/i.test(href) ? href : `https://${href}`;
                if (editor.state.selection.empty && !editor.isActive("link")) {
                  editor.chain().focus().insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href: full } }] }).run();
                } else editor.chain().focus().extendMarkRange("link").setLink({ href: full }).run();
              }
              setLinkOpen(false);
            }}
          >
            <input className="input" style={{ height: 34 }} placeholder="Paste a web address" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus aria-label="Web address" />
            <button className="btn btn-sm btn-primary" style={{ height: 34 }} type="submit">
              {url.trim() ? "Apply" : "Remove"}
            </button>
          </form>
        </PopoverContent>
      </Popover>
      <Tip label="Insert image">
        <button className="icon-btn" aria-label="Insert image" onClick={() => fileInput.current?.click()}>
          <ImageIcon size={16} />
        </button>
      </Tip>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const src = await fileToDataUrl(file);
          editor.chain().focus().setImage({ src, alt: file.name }).run();
        }}
      />
      {dictation.supported ? (
        <Tip label={dictation.on ? "Stop dictating" : "Dictate"}>
          <button className="icon-btn" data-active={dictation.on || undefined} aria-pressed={dictation.on} aria-label="Dictate" onClick={dictation.toggle} style={dictation.on ? { color: "var(--danger)" } : undefined}>
            <Mic size={16} />
          </button>
        </Tip>
      ) : null}
    </div>
  );
}

export function FindBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const state = useEditorState({ editor, selector: ({ editor: e }) => findKey.getState(e.state) });
  const count = state?.count ?? 0;

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    return () => {
      if (!editor.isDestroyed) editor.commands.setFind("", 0);
    };
  }, [editor]);

  const go = (q: string, i: number) => {
    setQuery(q);
    setIndex(i);
    editor.commands.setFind(q, i);
    requestAnimationFrame(() => editor.view.dom.querySelector(".find-hit-current")?.scrollIntoView({ block: "center" }));
  };

  return (
    <div className="flex items-center gap-2 px-3 border-b border-hair bg-surface-3 flex-none" style={{ height: 44 }} data-testid="find-bar" role="search">
      <input
        ref={input}
        className="input"
        style={{ height: 30, maxWidth: 280 }}
        placeholder="Find in this note"
        aria-label="Find in this note"
        value={query}
        onChange={(e) => go(e.target.value, 0)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            go(query, (state?.index ?? index) + (e.shiftKey ? -1 : 1));
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      />
      <span className="t12 text-muted" style={{ minWidth: 64 }} aria-live="polite" data-testid="find-count">
        {query ? (count ? `${(state?.index ?? 0) + 1} of ${count}` : "No matches") : ""}
      </span>
      <button className="icon-btn" aria-label="Previous match" disabled={!count} onClick={() => go(query, (state?.index ?? 0) - 1)}>
        <ChevronUp size={16} />
      </button>
      <button className="icon-btn" aria-label="Next match" disabled={!count} onClick={() => go(query, (state?.index ?? 0) + 1)}>
        <ChevronDown size={16} />
      </button>
      <span className="flex-1" />
      <button className="icon-btn" aria-label="Close find" onClick={onClose}>
        <X size={16} />
      </button>
    </div>
  );
}

export function ConflictBanner({ uid }: { uid: string }) {
  const note = useApp((s) => s.notes[uid]);
  const [show, setShow] = useState(false);
  if (!note?.conflict) return null;
  const c = note.conflict;
  return (
    <div className="border-b border-hair flex-none" style={{ background: "var(--warn-bg)", color: "var(--warn-ink)" }} data-testid="conflict-banner">
      <div className="flex items-center gap-2.5 px-4 py-2.5 t12">
        <TriangleAlert size={15} className="flex-none" />
        <span className="flex-1">
          <strong>{c.meta.updatedByName || "Someone"}</strong> changed the same lines ({stamp(c.meta.updated)}). Both versions were kept.
        </span>
        <button className="btn btn-sm" onClick={() => setShow((v) => !v)}>
          {show ? "Hide theirs" : "See theirs"}
        </button>
        <button className="btn btn-sm" onClick={() => resolveConflict(uid, "theirs")}>
          Use theirs
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => resolveConflict(uid, "mine")}>
          Keep mine
        </button>
      </div>
      {show ? (
        <div className="scroll prose mx-4 mb-3 p-3 rounded-lg bg-surface text-ink" style={{ maxHeight: 180, fontSize: "calc(13px * var(--ts))" }} dangerouslySetInnerHTML={{ __html: renderMarkdown(c.body) }} />
      ) : null}
    </div>
  );
}

export function SavedLabel({ uid }: { uid: string }) {
  const savedAt = useApp((s) => s.savedAt[uid]);
  const updated = useApp((s) => s.notes[uid]?.meta.updated);
  const pending = useApp((s) => s.spaces[uid.slice(0, uid.indexOf("/"))]?.pending);
  const offline = useApp((s) => s.offline);
  const time = savedAt ?? (updated ? Date.parse(updated) : 0);
  return (
    <span className="flex items-center gap-2 font-medium" style={{ color: "var(--brand)" }} data-testid="saved-label">
      <CircleCheck size={15} />
      Last saved {time ? clock(time) : "just now"}
      {offline && pending ? (
        <span className="flex items-center gap-1.5 text-muted font-normal">
          <CloudOff size={13} /> on this device, waiting to sync
        </span>
      ) : null}
    </span>
  );
}

const editors = new Map<string, Editor>();

/**
 * Puts the caret at the end of an open note (used after naming a new note).
 * Tiptap's own focus command waits a frame; keys typed in that gap would land
 * on the page and trigger single-letter shortcuts, so focus synchronously.
 */
export function focusEditor(uid: string) {
  const ed = editors.get(uid);
  if (!ed || ed.isDestroyed) return;
  ed.view.dispatch(ed.state.tr.setSelection(Selection.atEnd(ed.state.doc)));
  ed.view.focus();
}

/** Tiptap escapes every ampersand; a lone "&" reads better in the saved file and means the same. */
function tidy(markdown: string): string {
  return markdown.replace(/&amp;(?![a-zA-Z#][a-zA-Z0-9]*;)/g, "&").replace(/\s+$/, "");
}

/** The editing surface of a text note: used in windows and in focus mode. */
export function useNoteEditor(uid: string, opts: { editable: boolean; placeholder?: string }) {
  const rev = useApp((s) => s.revs[uid] ?? 0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // True only between a real edit by this person and the moment it is handed to the store.
  const dirty = useRef(false);

  const extensions = useMemo(
    () => [
      StarterKit.configure({ link: { openOnClick: false, autolink: true }, heading: { levels: [1, 2, 3] } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight,
      Image.configure({ allowBase64: true }),
      Placeholder.configure({ placeholder: opts.placeholder ?? "Start writing…" }),
      Markdown,
      Find,
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const commit = (e: Editor) => {
    clearTimeout(timer.current);
    if (!dirty.current || e.isDestroyed) return;
    dirty.current = false;
    const md = tidy(e.getMarkdown());
    if (md !== (useApp.getState().notes[uid]?.body ?? "").replace(/\s+$/, "")) patchNote(uid, { body: md });
  };

  const editor = useEditor({
    extensions,
    content: useApp.getState().notes[uid]?.body ?? "",
    contentType: "markdown",
    editable: opts.editable,
    editorProps: { attributes: { class: "prose", spellcheck: "true", "aria-label": "Note content" } },
    onUpdate: ({ editor: e, transaction }) => {
      // Only a change to the document made in an editable note counts as an edit.
      if (!transaction.docChanged || !e.isEditable) return;
      dirty.current = true;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => commit(e), 200);
    },
    onBlur: ({ editor: e }) => commit(e),
  });

  useEffect(() => {
    if (!editor) return;
    editors.set(uid, editor);
    return () => {
      if (editors.get(uid) === editor) editors.delete(uid);
    };
  }, [editor, uid]);

  useEffect(() => {
    if (editor && editor.isEditable !== opts.editable) editor.setEditable(opts.editable, false);
  }, [editor, opts.editable]);

  // Content replaced from outside (another member, another device, a restore).
  useEffect(() => {
    if (!editor || rev === 0) return;
    const body = useApp.getState().notes[uid]?.body ?? "";
    if (body.replace(/\s+$/, "") === tidy(editor.getMarkdown())) return;
    const { from, to } = editor.state.selection;
    editor.commands.setContent(body, { contentType: "markdown", emitUpdate: false });
    const size = editor.state.doc.content.size;
    if (editor.isFocused) editor.commands.setTextSelection({ from: Math.min(from, size), to: Math.min(to, size) });
  }, [editor, rev, uid]);

  // Leaving the note (closing its window, entering focus mode) must not drop the last keystrokes.
  useEffect(
    () => () => {
      if (editor) commit(editor);
      clearTimeout(timer.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor],
  );

  return editor;
}

export function TextNote({ uid }: { uid: string }) {
  const note = useApp((s) => s.notes[uid]);
  const userId = useApp((s) => s.user?.id);
  const now = useApp((s) => s.now);
  const findOpen = useApp((s) => s.findUid === uid);
  const editable = note ? canEdit(note) : false;
  const editor = useNoteEditor(uid, { editable });
  if (!note) return null;
  const words = wordCount(note.body);
  const where = note.meta.sharedOwner && note.meta.sharedOwner !== userId ? `Shared by ${note.meta.sharedOwnerName}` : (folderName(note) ?? spaceLabel(note.space));

  return (
    <>
      {editor && editable ? <FormatBar editor={editor} /> : null}
      {!editable ? (
        <div className="flex items-center gap-2 px-4 border-b border-hair bg-surface-3 t12 text-ink-2 flex-none" style={{ height: 40 }}>
          <Lock size={14} /> {note.meta.sharedOwnerName} shared this note as view only.
        </div>
      ) : null}
      {editor && findOpen ? (
        <FindBar
          editor={editor}
          onClose={() => {
            openFind(null);
            editor.commands.focus();
          }}
        />
      ) : null}
      <ConflictBanner uid={uid} />
      <div className="scroll flex-1 min-h-0" style={{ padding: "22px 36px 20px" }} onMouseDown={(e) => e.target === e.currentTarget && editor?.commands.focus("end")}>
        <div className="t12 text-muted mb-3" data-testid="edited-line">
          {where} · {editedLine(note, userId, now).replace(/^e/, "E")}
        </div>
        <EditorContent editor={editor} />
        <div className="mt-8">
          <LinkedRow uid={uid} />
        </div>
      </div>
      <div className="status-bar">
        <SavedLabel uid={uid} />
        <span className="flex-1" />
        <span>
          {words} {words === 1 ? "word" : "words"}
        </span>
      </div>
    </>
  );
}
