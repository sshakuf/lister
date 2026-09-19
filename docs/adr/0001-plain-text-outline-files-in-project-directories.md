---
status: accepted
---

# Store the outline as plain-text files inside project directories

Lister exists so that any agent (Claude Code, Codex, others) working in a project directory finds the bullets relevant to that project without knowing Lister exists. We therefore store each Folder Bullet's children as a plain-text `.lister` file inside the directory it points to, with metadata carried as inline `[kind:value]` Annotations and a Bullet ID on every line, instead of keeping a central database and exporting on demand. The whole tree is still one outline: the Root Outline lives under `~/.lister/` and Folder Bullets link the files together by absolute path.

## Considered Options

- **Central SQLite database with an API and an agent-facing export.** Rejected: an agent would need Lister running and reachable to see anything, and files would go stale between exports.
- **Central store with per-project symlinks or generated read-only files.** Rejected: agents must be able to write, and a generated copy makes writes ambiguous.
- **Markdown `.md` files.** Rejected in favour of a dedicated `.lister` extension because project directories are full of unrelated Markdown and discovery by extension must be unambiguous. The line syntax stays Markdown-compatible (`- ` marker, 2-space indent, note paragraphs as indented continuation lines).

## Consequences

- Rich features that fight plain text are constrained: styles are a fixed named set, there is no nesting of Annotations, and mirrors are deferred indefinitely.
- Concurrent edits from the app and from agents are real. The server watches files and merges by Bullet ID; same-Bullet conflicts are last-write-wins.
- Agents will write malformed or ID-less lines. The server heals files on load rather than rejecting them, and the CLI is the preferred write path.
- Outline Files sit inside git repositories but are personal. They are kept out of version control via git's global excludes and `.git/info/exclude`, never via a project's `.gitignore`.
- Sync across machines is not Lister's responsibility today; plain text lets git, iCloud, or Syncthing carry the files until a Lister-native sync exists.
