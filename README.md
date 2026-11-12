# Margin

A self-hostable canvas for study notes, built from the CW1 Figma prototype.
Text notes, Excalidraw drawings, linked notes with hover previews, groups with
a kanban board, graph view, daily note, focus mode and accessibility settings.

Every space (your personal notes, or a group) is a git repository on the
server. Each member's browser holds its own clone, pulls when it connects and
pushes when it saves, so groups get full version history.

## Status

What has been run and passes:

- `server`: 10 API and git-access tests
- `web`: 16 sync-engine tests (two members against a real server: merge,
  clashes, offline, access levels, history)
- Browser run-throughs in headless Chrome (`web/e2e/`): 110 checks covering
  every item in the requirements list, against the production build
- TypeScript typecheck and production build of both packages
- The Dockerfile's steps, run by hand without Docker: a clean install with
  install scripts skipped, the full build, a production-only server install,
  then sign-up, groups, a git clone and the access hook on the result

Not done or not verified yet:

- The Docker image itself has not been built (no Docker daemon where this was
  made). Its steps were checked as above.
- Microsoft/Google sign-in is wired and returns the right redirect to each
  provider, but has not been completed end to end with real credentials.
- Voice notes store a transcript only (no audio), and only where the browser
  supports speech recognition. Elsewhere you type the note.
- Opening the app needs the server reachable. Once open it keeps working
  offline and syncs on reconnection.
- Left for later, as agreed: smart link suggestions, board automations,
  Tidy shapes.

### Dependency audit

`npm audit` reports one low-severity issue: KaTeX inside Mermaid, which
Excalidraw uses only for its "Mermaid to Excalidraw" import. Its fix needs a
KaTeX version Mermaid does not support yet. The other findings in Excalidraw's
dependency tree (an old nanoid and lodash-es) are fixed by the `overrides` in
the root `package.json`. That is also why `web` lists `lodash-es` directly. The
Mermaid import is checked in `web/e2e/mermaid.mjs`.

## Run it

Needs Node 22+ and git (on Windows, Git for Windows).

```bash
npm install
npm run build
npm start            # http://localhost:8787, data in server/data
```

Development with hot reload:

```bash
npm run dev          # server on :8787, web on http://localhost:5173
```

With Docker (untested, see above):

```bash
cp .env.example .env
docker compose up -d --build
```

## Configuration

Environment variables, all optional. See `.env.example`.

| Variable | Purpose |
|---|---|
| `PUBLIC_URL` | Address people use to reach Margin. Set it when not on localhost. |
| `PORT` | Port to listen on (default 8787). |
| `DATA_DIR` | Where the database and repositories live. |
| `AUTH_SECRET` | Signs session cookies. Generated and kept in `DATA_DIR` if empty. |
| `ALLOW_SIGNUP` | `false` stops new accounts. |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` | Enables "Continue with university account" through Microsoft. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The same through Google. |

OAuth redirect URIs to register: `<PUBLIC_URL>/api/auth/callback/microsoft`
and `<PUBLIC_URL>/api/auth/callback/google`.

Serve it over HTTPS (a reverse proxy such as Caddy in front) for anything
beyond your own machine.

## Backups

Everything is in `DATA_DIR`: `margin.db` (accounts, groups, memberships) and
`repos/` (one bare git repository per user and per group). Copy the folder.

## How the data is stored

```
notes/<id>.md               text note: YAML front matter + Markdown
drawings/<id>.excalidraw    standard Excalidraw file with a "margin" key
daily/<YYYY-MM-DD>.md       daily note (personal space)
board.json                  kanban board
shared/<ownerId>/<id>.*     personal notes linked into a group
.margin/                    folders, settings
```

A member can also keep a real folder: Settings > Account creates an access
token, then `git clone <PUBLIC_URL>/git/g/<groupId>.git` with any username and
the token as the password.

## Access levels

A personal note linked to a group note is published into the group at the
level its owner picks:

- **Private**: the group sees that a note is linked, not its title or content.
- **Can view**: members can read it. The server rejects their edits.
- **Can edit**: members can change it, and the changes return to the owner.

The server enforces this in a git `pre-receive` hook (`server/hooks`).

## Sync and clashes

Sync is commit, pull, push. If two people changed different notes, or
different parts of one note, the changes are merged. If they changed the same
lines, both versions are kept and the note is flagged for someone to choose.
Drawings merge shape by shape and the board merges card by card.

## Tests

```bash
npm test                         # server + sync engine
cd web && node e2e/part1.mjs     # also part2, part3, mermaid. These need the
                                 # server on :8787 and Chrome at
                                 # /usr/bin/google-chrome (or set CHROME=)
```

## Layout

```
server/   Hono + SQLite + Better Auth, git smart HTTP, access hook
web/      React + Vite app
  src/core/     file formats, merge rules, sync engine (no UI code)
  src/store/    app state and actions
  src/notes/    text editor (Tiptap), drawings (Excalidraw), links, previews
  src/group/    group page, board, members
  src/graph/ src/daily/ src/focus/ src/settings/ src/history/ src/onboarding/
```
