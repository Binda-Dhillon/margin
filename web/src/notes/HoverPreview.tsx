import { type ReactNode } from "react";
import { HoverCard } from "radix-ui";
import { Lock } from "lucide-react";
import { Dot } from "../components/ui";
import type { Note } from "../core/types";
import { ago } from "../lib/util";
import { useApp } from "../store/app";
import { resolveRef, spaceLabel } from "../store/select";
import { renderMarkdown, useDrawingImage } from "./render";

/** Who last changed the note and when, e.g. "edited 2 min ago by Sanjay". */
export function editedLine(note: Note, userId: string | undefined, now: number): string {
  const when = ago(note.meta.updated, now);
  const showWho = note.space.startsWith("g:") || !!note.meta.sharedOwner || (!!note.meta.updatedById && note.meta.updatedById !== userId);
  if (!showWho || !note.meta.updatedByName) return `edited ${when}`;
  return `edited ${when} by ${note.meta.updatedById === userId ? "you" : note.meta.updatedByName}`;
}

export function PreviewCard({ uid }: { uid: string }) {
  const note = useApp((s) => s.notes[uid]);
  const userId = useApp((s) => s.user?.id);
  const now = useApp((s) => s.now);
  const previewUid = note?.meta.preview ? resolveRef(note.space, note.meta.preview) : null;
  const previewNote = useApp((s) => (previewUid ? s.notes[previewUid] : undefined));
  // A linked sketch set as the preview wins; a drawing previews as itself.
  const sketch = previewNote?.meta.type === "drawing" ? previewNote : note?.meta.type === "drawing" ? note : null;
  const image = useDrawingImage(sketch);
  if (!note) return null;
  const locked = note.meta.sharedAccess === "private" && note.meta.sharedOwner !== userId;
  return (
    <div className="flex flex-col" style={{ width: sketch ? 340 : 320 }} data-testid="hover-preview" data-preview-kind={locked ? "private" : sketch ? "sketch" : "text"}>
      <div className="px-3.5 pt-3 pb-2">
        <div className="flex items-center gap-2 t14 font-semibold min-w-0">
          <Dot note={note} />
          <span className="truncate">{note.meta.title}</span>
        </div>
        <div className="t11 text-muted mt-1 truncate">
          {spaceLabel(note.space)}
          {note.meta.sharedOwnerName && note.meta.sharedOwner !== userId ? ` · shared by ${note.meta.sharedOwnerName}` : ""} · {editedLine(note, userId, now)}
        </div>
      </div>
      {locked ? (
        <div className="flex items-center gap-2 px-3.5 pb-3.5 t12 text-muted">
          <Lock size={14} /> Only {note.meta.sharedOwnerName ?? "its owner"} can open this note.
        </div>
      ) : sketch ? (
        <div className="mx-3 mb-3 rounded-lg grid place-items-center overflow-hidden" style={{ background: "color-mix(in srgb, #8e75cc 14%, var(--surface))", minHeight: 150, maxHeight: 240 }}>
          {image.url ? (
            <img src={image.url} alt={`Sketch: ${sketch.meta.title}`} style={{ maxWidth: "100%", maxHeight: 232, objectFit: "contain" }} />
          ) : (
            <span className="t12 text-muted py-10">{image.loading ? "Drawing preview…" : "This sketch is empty"}</span>
          )}
        </div>
      ) : (
        <div
          className="scroll prose px-3.5 pb-3.5"
          style={{ maxHeight: 190, fontSize: "calc(13px * var(--ts))" }}
          tabIndex={0}
          aria-label={`Preview of ${note.meta.title}`}
          dangerouslySetInnerHTML={{ __html: note.body.trim() ? renderMarkdown(note.body) : '<p style="color:var(--muted)">This note is empty.</p>' }}
        />
      )}
    </div>
  );
}

/**
 * Wraps anything that names a note. Hovering shows the linked sketch when one
 * is set as the preview, otherwise a small scrollable window of the note.
 */
export function Hover({ uid, children, side = "right" }: { uid: string; children: ReactNode; side?: "right" | "top" | "bottom" | "left" }) {
  const exists = useApp((s) => !!s.notes[uid]);
  if (!exists) return <>{children}</>;
  return (
    <HoverCard.Root openDelay={380} closeDelay={160}>
      <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content side={side} sideOffset={10} align="start" collisionPadding={12} className="menu" style={{ padding: 0, overflow: "hidden", zIndex: 350 }}>
          <PreviewCard uid={uid} />
          <HoverCard.Arrow width={14} height={7} style={{ fill: "var(--surface)" }} />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
