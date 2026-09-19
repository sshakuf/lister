# Lister: project outlines in `.lister` files

Lister is an outliner whose lists are stored as plain-text **Outline Files** (`*.lister`) inside the project directories they belong to. If the directory you are working in contains `*.lister` files, they hold the user's bullets for this project: tasks, notes, ideas, decisions. Read them for context. Add to them when you finish work or learn something worth recording.

## Finding outlines

- Look for `*.lister` in the current directory (not recursively). Each file is one list.
- `lister list` prints every Outline File here with bullet ids. `lister list -r` includes subdirectories. `lister list --all` prints the whole tree from the user's Root Outline.
- No files here? `lister list` names the nearest directory that has some. Create one with `lister new "<Name>"`.

## File format

```
# Bugs [id:k3j9d0aa] [parent:m2n4p6qq]
- Login fails on Safari [id:a1b2c3d4] [date:2027-09-15] [priority:1]
  Repro: open /login in Safari 18, submit twice.
  - Reproduced locally [id:e5f6g7h8] [done:2026-09-19]
- Ideas [id:i9j0k1l2] [folder:~/proj/ideas]
- Plain [bold:styled] text with a [link:a1b2c3d4] to another bullet [id:m3n4o5p6]
```

- Line 1 is the header: `# <Name> [id:..]` and optionally `[parent:..]`. Leave it alone.
- Bullets: `- ` prefix, 2 spaces of indent per level. Children are indented under their parent.
- Lines without `- ` that are indented deeper than the bullet above are that bullet's **note** (free text, may be several lines).
- Every bullet ends with `[id:xxxxxxxx]` (8 chars, `0-9a-z`). **Never remove or change an id.** Other tools link to bullets by id. If you add a line without an id, Lister assigns one on next load.

### Annotations

Inline `[kind:value]` markers. No nesting. A literal `[` is written `\[`.

| Annotation | Meaning |
|---|---|
| `[id:abc12345]` | Bullet id. Always present, always last-ish. |
| `[folder:~/path/to/dir]` | This is a **Folder Bullet**: its children live in `<dir>/<slug-of-text>.lister`, not below it. |
| `[date:2027-09-15]` or `[date:2027-09-15T10:30]` | A due/relevant date. ISO format. |
| `[priority:1]` | 1 (highest) to 3. |
| `[done:2026-09-19]` | Completed on that date. `[done]` alone is accepted. |
| `[link:abc12345]` | Reference to another bullet by id. |
| `[bold:text]`, `[italic:text]`, `[highlight:text]`, `[code:text]` | Inline style. Combine with commas: `[bold,red:text]`. |
| `[red:..]` `[green:..]` `[blue:..]` `[yellow:..]` `[purple:..]` `[grey:..]` | Colour. |

Bare `http(s)://` URLs are fine in text.

## Reading

Just read the file. It is designed to be understood raw. `lister show <id>` prints one bullet with its subtree and location.

## Writing: prefer the CLI

The CLI keeps ids, formatting, and the running UI in sync. If the user's Lister server is running, the CLI talks to it and the UI updates live; otherwise it edits the file directly.

```
lister add "Investigate flaky test [priority:2]"          # into the single .lister file here
lister add "Fix CI" --file bugs.lister                     # pick a file when several exist
lister add "Sub-step" --under a1b2c3d4                     # as a child of a bullet
lister done a1b2c3d4                                       # mark done (today)
lister edit a1b2c3d4 "New text [date:2027-01-05]"
lister rm a1b2c3d4
lister new "Decisions"                                     # new Outline File here, registered in the user's tree
lister search "safari"                                     # across every Outline File
```

Raw edits are acceptable when `lister` is not installed: append `- text` lines with correct indentation, keep existing `[id:..]` markers intact, do not touch the header. Lister will add missing ids.

## Conventions for agents

- Record outcomes under the bullet that asked for them: `lister add "Done: switched to retry with backoff" --under <id>` then `lister done <id>`.
- Keep bullet text to one line; put detail in a child bullet or the note lines.
- Do not commit `*.lister` files to git. The user keeps them out via git's global excludes; if a repo shows them as untracked, do not `git add` them.
