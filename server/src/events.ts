/** In-process fan-out of live events to connected browsers (Server-Sent Events). */

export type ServerEvent =
  | { type: "repo"; space: string; head: string; by: { id: string; name: string } }
  | { type: "groups" }
  | { type: "notification"; notification: unknown }
  | { type: "ping" };

type Listener = (event: ServerEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribe(userId: string, listener: Listener): () => void {
  let set = listeners.get(userId);
  if (!set) listeners.set(userId, (set = new Set()));
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(userId);
  };
}

export function emitTo(userIds: Iterable<string>, event: ServerEvent) {
  for (const id of new Set(userIds)) {
    const set = listeners.get(id);
    if (!set) continue;
    for (const listener of set) {
      try {
        listener(event);
      } catch {
        /* a broken stream is cleaned up by its own abort handler */
      }
    }
  }
}
