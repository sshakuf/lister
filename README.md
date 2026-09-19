# Lister

A Workflowy-style outliner whose lists live as plain-text `.lister` files **inside your project directories**, so any coding agent working in a project (Claude Code, Codex, anything that can read a file) sees and edits the same bullets you do.

- One tree, rooted at `~/.lister/root.lister`.
- Any bullet can become a **Folder Bullet**: its children move into `<some-dir>/<slug>.lister`. Open that project, and the outline for it is right there.
- Bullets carry inline annotations: `[date:2027-09-15]`, `[priority:1]`, `[done:2026-09-19]`, `[link:<id>]`, `[bold:..]`, colours. Every bullet has an `[id:xxxxxxxx]`.
- A local server watches the files. Edit in the web app, from the `lister` CLI, or with `echo >> bugs.lister`; everything merges by bullet id.

Vocabulary: [CONTEXT.md](./CONTEXT.md). Why plain text in project dirs: [ADR 0001](./docs/adr/0001-plain-text-outline-files-in-project-directories.md). Full design: [spec](./docs/superpowers/specs/2026-09-19-lister-design.md).

## Quickstart

Requires Node 22 and pnpm 10.

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

There is no authentication either way, so keep it to your tailnet.

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
| `@15/9/27␣`, `!1␣` | set date / priority while typing |
| `[` | autocomplete annotation kinds; filters as you type, Enter/Tab inserts `kind:` |

## Layout

```
packages/core    .lister format: parse, serialize, merge by id, dates, OPML
packages/server  Fastify API + WebSocket, file watching, search, admin
packages/cli     `lister` command (uses the server when running, files otherwise)
packages/web     React outliner + admin
skill/           the agent Skill document `lister skill install` distributes
```

`pnpm test` runs every package's tests. `pnpm dev` runs the server with reload; `pnpm --filter @lister/web dev` runs the web client with a proxy to it.

## File format in 10 seconds

```
# Bugs [id:k3j9d0aa] [parent:m2n4p6qq]
- Login fails on Safari [id:a1b2c3d4] [date:2027-09-15] [priority:1]
  A note line belongs to the bullet above.
  - Reproduced locally [id:e5f6g7h8] [done:2026-09-19]
- Ideas [id:i9j0k1l2] [folder:~/proj/ideas]
```

Two spaces per level, `- ` marker, header on line 1, ids everywhere. Missing ids are filled in on load.
