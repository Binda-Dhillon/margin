import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/** In-note search (Ctrl+F inside a note): highlights matches and tracks the current one. */

interface FindState {
  query: string;
  index: number;
  count: number;
  decorations: DecorationSet;
}

export const findKey = new PluginKey<FindState>("margin-find");

function matchesIn(doc: PMNode, query: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  const q = query.toLowerCase();
  if (!q) return out;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // One character per inline leaf, so string offsets map straight to positions.
    const text = node.textBetween(0, node.content.size, undefined, "￼").toLowerCase();
    let i = text.indexOf(q);
    while (i !== -1) {
      out.push({ from: pos + 1 + i, to: pos + 1 + i + q.length });
      i = text.indexOf(q, i + q.length);
    }
    return false;
  });
  return out;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    find: {
      setFind: (query: string, index: number) => ReturnType;
    };
  }
}

export const Find = Extension.create({
  name: "find",

  addCommands() {
    return {
      setFind:
        (query: string, index: number) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(findKey, { query, index }));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => ({ query: "", index: 0, count: 0, decorations: DecorationSet.empty }),
          apply(tr, prev) {
            const meta = tr.getMeta(findKey) as { query: string; index: number } | undefined;
            if (!meta && !tr.docChanged) return prev;
            const query = meta ? meta.query : prev.query;
            let index = meta ? meta.index : prev.index;
            if (!query) return { query: "", index: 0, count: 0, decorations: DecorationSet.empty };
            const matches = matchesIn(tr.doc, query);
            index = matches.length ? ((index % matches.length) + matches.length) % matches.length : 0;
            const decorations = DecorationSet.create(
              tr.doc,
              matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === index ? "find-hit-current" : "find-hit" })),
            );
            return { query, index, count: matches.length, decorations };
          },
        },
        props: {
          decorations(state) {
            return findKey.getState(state)?.decorations ?? null;
          },
        },
      }),
    ];
  },
});
