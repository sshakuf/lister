# Lister

A Workflowy-style outliner whose lists live as plain-text `.lister` files **inside your project directories**, so any coding agent working in a project (Claude Code, Codex, anything that can read a file) sees and edits the same bullets you do.

- One tree, rooted at `~/.lister/root.lister`.
- Any bullet can become a **Folder Bullet**: its children move into `<some-dir>/<slug>.lister`. Open that project, and the outline for it is right there.
- Bullets carry inline annotations: `[date:2027-09-15]`, `[priority:1]`, `[done:2026-09-19]`, `[link:<id>]`, `[bold:..]`, colours. Every bullet has an `[id:xxxxxxxx]`.
- A local server watches the files. Edit in the web app, from the `lister` CLI, or with `echo >> bugs.lister`; everything merges by bullet id.

Vocabulary: [CONTEXT.md](./CONTEXT.md). Why plain text in project dirs: [ADR 0001](./docs/adr/0001-plain-text-outline-files-in-project-directories.md). Full design: [spec](./docs/superpowers/specs/2026-09-19-lister-design.md).

## Quickstart

Requires Node 22.13 or newer and pnpm 10.

```bash
pnpm install
pnpm build
npm link ./packages/cli        # puts `lister` on your PATH (or: alias lister="node $PWD/packages/cli/dist/main.js")

lister setup                   # keep *.lister out of every git repo (global git excludes)
lister skill install           # teach Claude Code / Codex about .lister files (global)
lister open                    # starts the server in the background and opens the web app
```

Then in the web app: type bullets, press `Cmd+Shift+Enter` on one to turn it into a Folder Bullet and pick a project directory.

In that project directory:

```bash
lister list                    # what's here
lister add "Fix login redirect [priority:1]"
lister add "Repro steps" --under <id>
lister done <id>
lister new "Decisions"         # another .lister file here, registered in your tree
lister search "login"
lister admin folders           # every Folder Bullet, broken ones, orphan files
lister import workflowy.opml   # bring your Workflowy export in
```

## Reaching it from other devices (Tailscale)

Recommended: let Tailscale proxy to the local server with a real HTTPS certificate. The server stays bound to `127.0.0.1`.

```bash
tailscale serve --bg http://127.0.0.1:7433
# → https://<machine>.<tailnet>.ts.net/   (tailnet only; `tailscale serve reset` to undo)
```

Phones default to HTTPS, so a plain `http://100.x.y.z:7433` address typed into a mobile browser fails with `ERR_SSL_PROTOCOL_ERROR` unless you type the `http://` explicitly. If you do want the raw port instead of `tailscale serve`:

```bash
lister config set host 0.0.0.0        # or your Tailscale IP
lister serve --daemon                  # restart to apply; `lister status` shows the old pid
```

Standalone mode has no authentication, so keep it to your tailnet. Hive mode adds remote access credentials.

## Keyboard (web)

| Key | Action |
|---|---|
| Enter / Tab / Shift+Tab | new bullet / indent / outdent |
| Up / Down, Cmd+Up / Cmd+Down | move caret / move bullet |
| Cmd+. | collapse / expand |
| Cmd+Enter | toggle done |
| Cmd+Shift+Enter | convert to Folder Bullet |
| Cmd+K | search everywhere |
| Cmd+Z / Shift+Cmd+Z | undo / redo |
| click the dot | zoom in |
| touch devices | Workflowy-style rows: chevron + round dot on the left; while editing, a toolbar sits above the keyboard with outdent, indent, undo, redo, done, `@`, `[`, more actions, hide keyboard. On desktop the ← → ⋯ buttons appear at the row end on hover. |
| `@15/9/27␣`, `!1␣` | set date / priority while typing |
| `[` | autocomplete annotation kinds; filters as you type, Enter/Tab inserts `kind:` |
| ⋯ menu | strike through / remove strike, add checkbox / check / uncheck / remove, mark done, zoom, convert, delete |

Inline checkboxes: `[checkbox:label]` renders ☐ label, `[checked:label]` renders ☑ label. Tap the box to toggle. `[strike:text]` strikes text without marking the bullet done.

Text size: Admin → Display has − / + buttons; the choice is saved per device.

## Layout

```
packages/core    .lister format: parse, serialize, merge by id, dates, OPML
packages/server  Fastify API + WebSocket, file watching, search, admin
packages/cli     `lister` command (uses the server when running, files otherwise)
packages/web     React outliner + admin
skill/           the agent Skill document `lister skill install` distributes
```

`pnpm test` runs every package's tests. `packages/web/e2e/ios-toolbar.cjs` drives the mobile toolbar with emulated touch (Chromium or WebKit) against a running server; it adds and removes two scratch bullets. `pnpm dev` runs the server with reload; `pnpm --filter @lister/web dev` runs the web client with a proxy to it.

## File format in 10 seconds

```
# Bugs [id:k3j9d0aa] [parent:m2n4p6qq]
- Login fails on Safari [id:a1b2c3d4] [date:2027-09-15] [priority:1]
  A note line belongs to the bullet above.
  - Reproduced locally [id:e5f6g7h8] [done:2026-09-19]
- Ideas [id:i9j0k1l2] [folder:~/proj/ideas]
```

Two spaces per level, `- ` marker, header on line 1, ids everywhere. Missing ids are filled in on load.

## Hive and offline editing

Hive mode joins several computers into one editable outline. Each computer owns
its registered project files; the others keep replicas in Lister's internal
storage. An owner can be offline while another device edits its branches.

Requires Node **22.13 or newer**. Start with a backup of your `.lister` files and
`~/.lister`. Enabling hive mode is explicit; standalone mode remains available
until you create or join a hive.

On the hub computer (for example, the Mac mini):

```bash
lister serve --daemon
lister hive create "My Lister" --label "Mac mini"
lister hive invite https://<mini>.<tailnet>.ts.net
```

Creating a hive registers the existing Root Outline and its reachable local
Outline Files. The invitation is single-use and expires after ten minutes.
Use HTTPS for connections between computers. Plain HTTP is accepted only for
loopback development addresses. There is no automatic hub election.

On another computer:

```bash
lister serve --daemon
lister hive join '<invitation>' --label "MacBook"
lister hive register ~/Development/projects/mac-dev-projects.lister
lister hive status
```

Joining downloads the shared outline. It does **not** automatically publish the
joining computer's existing root or directories. Register files deliberately;
registration includes their reachable local Folder Bullets. A registered file
appears as a branch under the shared Root Outline. Existing IDs stay intact;
copied files with colliding IDs must be resolved before registration.

For **Continue with Google** on iPhone and Mac browsers, see [Google login setup](docs/google-login-setup.md). Google login uses an owner allowlist and independent browser sessions; local recovery access remains available.

The web app offers hive setup and controls in Admin. For a remote browser,
obtain its access token on the computer serving that browser:

```bash
lister hive token
```

Treat this token as a password. Device pairing credentials are separate and can
be revoked on the hub with `lister hive revoke <device-id>`. Every member of this
first version has access to every shared branch. Removing a member cannot erase
copies already downloaded by it.

Edits are saved locally first and retried when connected. The browser must have
loaded the app and downloaded its outline at least once before offline use.
Offline reload requires the app shell cache and a secure origin (HTTPS or
localhost). Keep the same browser origin when reconnecting; browser storage is
specific to that origin. Clearing browser data discards its unsynchronized edits.

Saved locally, synced to the hive, and written to the owner's file are different
states. If the hub is unreachable, every replica keeps working but exchanges
wait. If only the owner is unreachable, other devices can still exchange edits;
its physical file catches up later.

Independent field edits merge. Conflicting text, deletion, and placement changes
retain both candidates for review. Concurrent ambiguous sibling reorders are
conservatively flagged rather than choosing one silently. Moves between files
write the destination before removing the source, so a temporary duplicate disk
copy may remain during an interrupted transfer. Only the owning computer writes
its registered paths; another device never recreates those directories.

Existing `[folder:...]` annotations continue to identify local files. A remote
Folder Bullet uses `[outline:<file-id>]`, resolved through the hive registry.
Filesystem operations such as converting a bullet to a Folder Bullet or moving
its physical directory require connection to the owning computer. File content
editing, adding, deleting and rearranging remain available offline.

Useful recovery commands:

```bash
lister hive sync
lister hive status
lister hive export > pending-outline-backup.json
```

The export includes outline state and pending operations, without credentials.
Agent state and retained history live in `~/.lister/hive/hive.sqlite`; recovery
copies of overwritten Outline Files live in `~/.lister/hive/recovery/`. Stop the
server before copying/restoring its database and preserve the whole hive
state directory. Clients detect regressing or divergent history checkpoints and retain their
local work instead of overwriting it. A history rollback requires coordinated
recovery from exports/backups rather than a live database replacement. Missing, malformed, duplicated-ID, and unavailable files are
reported without treating them as deleted shared content.

This first implementation uses full snapshots in its sync envelopes and retains
history for recovery. It prioritizes correctness for personal outlines over
large-team scale; payloads are bounded. Direct peer transport, automatic hub
failover, shared file ownership, and selective permissions are not included.
