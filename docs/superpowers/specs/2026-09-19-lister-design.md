# Lister Design Spec

Date: 2026-09-19. Vocabulary: see `/CONTEXT.md`. Storage rationale: see `/docs/adr/0001-plain-text-outline-files-in-project-directories.md`.

## 1. Purpose

Lister is a Workflowy-style outliner with one tree. Any Bullet can become a Folder Bullet whose children live in a plain-text `.lister` Outline File inside a directory the user chooses (usually a project root). Agents (Claude Code, Codex, any other) working in that directory read and write those files directly or through the `lister` CLI, so the bullets for a project are available in that project's context.

## 2. On-disk format

### 2.1 Locations

- Root Outline: `~/.lister/root.lister` by default; path configurable in `~/.lister/config.json` (`rootFile`).
- Every other Outline File: `<folder>/<slug>.lister`, where `<folder>` is the directory in the Folder Bullet's `[folder:...]` Annotation and `<slug>` is derived from the Folder Bullet text.
- Server state: `~/.lister/server.json` (`{ "port": number, "pid": number }`), written on start, removed on clean exit.
- Trash: `~/.lister/trash/<timestamp>-<slug>.lister`.
- Config: `~/.lister/config.json` with `{ "rootFile": string, "port": number, "recentFolders": string[] }`.

### 2.2 Outline File grammar

```
# <Name> [id:<bulletId>] [parent:<parentBulletId>]
- <text> [annotations...]
  - <child text> [id:...]
    continuation note line (no marker), belongs to "child text"
    second note line
  - <another child> [id:...]
```

- Line 1 is the header. The Root Outline header has no `[parent:]`.
- Bullet lines: optional indent of 2 spaces per level, then `- `, then text.
- Note lines: indented one level deeper than their Bullet, no `- ` marker. Consecutive note lines form the Bullet's multi-line note. v1 UI preserves notes untouched; no note editing UI.
- Blank lines are ignored on read and never written.
- Line endings `\n`. UTF-8.

### 2.3 Annotations

Syntax `[kind:value]` or `[kind]` (flag). No nesting. Combined styles: `[bold,red:text]`. A literal `[` in text is written `\[`; a literal `]` inside an annotation value is written `\]`.

| kind | value | notes |
|---|---|---|
| `id` | 8 chars `[0-9a-z]` | one per Bullet, canonicalised to end of line |
| `folder` | absolute directory path, `~` allowed | marks a Folder Bullet |
| `parent` | bullet id | header only |
| `date` | `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` | UI shorthand `@15/9/27` = day/month/two-digit-year |
| `priority` | `1`, `2`, `3` | UI shorthand `!1` |
| `done` | `YYYY-MM-DD` | flag form `[done]` also accepted on read; written with date |
| `link` | bullet id | rendered as target Bullet text; click navigates |
| style | `bold`, `italic`, `highlight`, `code`, `strike`, `red`, `green`, `blue`, `yellow`, `purple`, `grey` | value is the styled text; combinable with commas |
| `checkbox` / `checked` | label text | inline checkbox, unchecked / checked; the UI toggles by swapping the kind |

Metadata kinds (`id`, `folder`, `date`, `priority`, `done`) are removed from their position on parse and re-emitted at line end on serialise, in that order. Inline kinds (`link`, styles) keep their position.

Bare `http://` and `https://` URLs in text are auto-linked in the UI; they are not Annotations.

### 2.4 IDs

8 random characters from `[0-9a-z]`. The server (or CLI in direct mode) assigns IDs to any Bullet line lacking one when a file is loaded, and rewrites the file. IDs are globally unique across all files; a collision on load is resolved by reassigning the later occurrence.

### 2.5 Slugs

`slugify(text)`: lowercase, NFKD-normalised, non-`[a-z0-9]` runs replaced with `-`, trimmed of `-`, max 60 chars, `untitled` if empty. Creating a Folder Bullet whose slug already exists as a file in the target directory is refused with an error. Renaming a Folder Bullet renames its file; refusal on collision leaves the Bullet text unchanged.

## 3. Domain model (core)

```ts
type BulletId = string;

interface Bullet {
  id: BulletId;
  text: string;                 // raw text with inline annotations, metadata annotations stripped
  note?: string;                // joined continuation lines
  folder?: string;              // expanded absolute path if Folder Bullet
  date?: string;                // ISO as stored
  priority?: 1 | 2 | 3;
  done?: string;                // YYYY-MM-DD
  children: Bullet[];           // empty for Folder Bullets; children live in another file
}

interface OutlineFile {
  path: string;                 // absolute path of the .lister file
  name: string;                 // header name
  id: BulletId;                 // header id == owning Folder Bullet id
  parentId?: BulletId;
  bullets: Bullet[];
}
```

`core` exposes: `parseOutline(text, path): OutlineFile`, `serializeOutline(file): string`, `parseAnnotations(text): Segment[]` (for rendering), `slugify`, `newId`, `folderFilePath(folder, text)`, `mergeOutlines(base, mine, theirs): OutlineFile` (three-way by Bullet id; same-id conflicts take `theirs`, i.e. the newer write), `parseDateShorthand("@15/9/27") => "2027-09-15"`, `formatDateShorthand`, OPML import `opmlToBullets(xml): Bullet[]`.

## 4. Server

Node 22, TypeScript, Fastify. Listens on `127.0.0.1:<port>` (default 7433). Writes `~/.lister/server.json`.

Responsibilities:
- Load Root Outline; resolve Folder Bullets lazily on request; cache loaded `OutlineFile`s keyed by path with last-known content for three-way merge.
- Watch every loaded file (chokidar). On external change: parse, `mergeOutlines(lastWritten, inMemory, onDisk)`, write back if healing changed anything, broadcast `file.changed` over WebSocket.
- Debounced (150 ms) whole-file writes after mutations.
- Search index: in-memory, rebuilt on load and on change, walks all files reachable from root.
- Admin: enumerate Folder Bullets, detect Broken Folder Bullets and Orphans (any `*.lister` in a directory referenced by some Folder Bullet, or in `~/.lister/`, not owned by a Folder Bullet), move, relink, adopt, trash.
- Directory listing for the picker.

REST (JSON):
- `GET /api/root` → `OutlineFile`
- `GET /api/files?path=` → `OutlineFile`
- `POST /api/files/:encodedPath/bullets` `{ parentId|null, index, text }` → `Bullet`
- `PATCH /api/bullets/:id` `{ text?, note?, date?, priority?, done? }` → `Bullet`
- `POST /api/bullets/:id/move` `{ filePath, parentId|null, index }`
- `DELETE /api/bullets/:id` (Folder Bullet: detach only)
- `POST /api/bullets/:id/to-folder` `{ folder }` → creates Outline File, moves children
- `POST /api/bullets/:id/inline` → reverse
- `GET /api/search?q=` → `{ hits: { id, text, filePath, fileName, path: string[] }[] }`
- `GET /api/fs/dirs?path=&prefix=` → `{ dirs: string[] }`; `GET /api/fs/recent`
- `GET /api/admin/folders` → `{ folders: { id, text, folder, filePath, status: "ok"|"broken" }[], orphans: { filePath, name, parentId? }[] }`
- `POST /api/admin/move` `{ id, folder }`
- `POST /api/admin/relink` `{ id, filePath }`
- `POST /api/admin/adopt` `{ filePath, parentId? }` (default: "Recovered" Bullet under root, created on demand)
- `POST /api/admin/trash` `{ filePath }`
- `POST /api/import/opml` body xml, query `parentId`
- `GET /api/health`

WebSocket `/ws`: server pushes `{ type: "file.changed", path }`.

The server also serves the built web client from `/`.

## 5. CLI (`lister`)

Node binary. Commands:
- `lister serve [--port]` start server in foreground; `lister serve --daemon` spawn detached.
- `lister list [--all] [--recursive]` print Outline Files in cwd as indented text. Default: cwd only.
- `lister add "<text>" [--file <path>] [--under <id>]` add Bullet. `--file` defaults to the single Outline File in cwd; errors if ambiguous.
- `lister done <id>`, `lister edit <id> "<text>"`, `lister rm <id>`
- `lister new "<Name>"` create Outline File in cwd and register its Folder Bullet (sibling of existing Folder Bullets for cwd; else under Recovered).
- `lister search "<q>"`
- `lister admin folders|orphans|adopt <file>|move <id> <dir>|relink <id> <file>|trash <file>`
- `lister import <file.opml> [--under <id>]`
- `lister skill install [--global|--local] [--agent claude|codex|generic|all]`
- `lister setup` writes `*.lister` to global git excludes (`~/.config/git/ignore`, creating it and setting `core.excludesFile` if unset).

Write commands: if `~/.lister/server.json` names a live server, call its API; otherwise operate directly through `core` and print a note. Read commands always use `core` directly. `lister` commands other than `serve` never start a server; the web app is what starts it (via `lister serve`). `lister open` starts the server if needed and opens the browser.

## 6. Skill

One Markdown document `skill/LISTER-SKILL.md` describing: what Outline Files are, how to find them (`*.lister` in cwd), the line grammar, the Annotation table, the rule "read raw, write via `lister` CLI, raw edits acceptable when the CLI is unavailable; never remove `[id:]`", and the git exclusion note. Installer targets:
- claude, global: `~/.claude/skills/lister/SKILL.md` with frontmatter `name: lister`, `description: ...`
- claude, local: `<cwd>/.claude/skills/lister/SKILL.md`
- codex, global: append section to `~/.codex/AGENTS.md`; local: `<cwd>/AGENTS.md`
- generic: `<cwd>/LISTER.md` or `~/.lister/LISTER.md`
Local install also appends `*.lister` to `<cwd>/.git/info/exclude` if a `.git` directory exists.

## 7. Web client

React 18 + TypeScript + Vite. Single page. State via a small store (zustand). Talks to REST + WebSocket.

Views:
- Outline view: breadcrumbs, the current zoomed Bullet's children rendered as an outliner. Each Bullet is a single-line `contentEditable` with rendered Annotations (styles applied, `[link:]` shown as target text, URLs clickable). Editing shows raw text.
- Keys: Enter splits/creates sibling, Shift+Enter inserts newline into the note (deferred, no-op in v1), Tab/Shift+Tab indent/outdent, Up/Down move caret between Bullets, Cmd+Up/Down move Bullet, Cmd+. collapse/expand, Cmd+Enter toggle Done, Cmd+Shift+Enter convert to Folder Bullet (opens picker), Backspace on empty Bullet deletes, Cmd+K search, Cmd+Z/Shift+Cmd+Z undo/redo (client-side stack of API ops), click bullet dot to zoom.
- Drag handle on bullet dot for reorder within the current file (dnd-kit).
- Folder Bullets: folder icon, dimmed last path segment, full path on hover, collapsed by default, children fetched on expand.
- Search palette: Cmd+K, results grouped by Outline File name, Enter zooms to hit.
- Folder picker: modal with path input (typeahead via `/api/fs/dirs`), recent folders list.
- Admin view (route `/admin`): table of Folder Bullets with status, Orphans list with Adopt, Move/Relink/Trash actions, Import OPML button.
- Zoom into a Folder Bullet loads its file; breadcrumbs span files.

Date and priority shorthand: typing `@15/9/27` or `!2` then space converts to the Annotation.

## 8. Concurrency

Client mutations → REST → server mutates in-memory model → debounced write → WebSocket `file.changed` → all clients refetch that file. External writes → chokidar → three-way merge → same broadcast. The client keeps focus and caret across refetch by Bullet id.

## 9. Out of scope for v1

Note editing UI, Annotation filtering, reminders, mirrors, mobile, remote access, auth, Lister-native sync.

## 10. Repository layout

```
package.json            pnpm workspace root, scripts: build, test, dev
pnpm-workspace.yaml
tsconfig.base.json
packages/core           parser, serializer, merge, ids, slugs, dates, opml
packages/server         Fastify app, file store, watcher, search, admin
packages/cli            commander CLI, bin "lister"
packages/web            Vite React app
skill/LISTER-SKILL.md
docs/
CONTEXT.md
```

Tests: `node --test` via `tsx` for core, server, cli. Vitest for web is optional; web is verified by build + manual smoke.
