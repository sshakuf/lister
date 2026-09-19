# Lister

A Workflowy-style outliner whose outline is split across plain-text files that live inside the project directories they describe, so any agent working in a directory finds the relevant bullets there.

## Language

**Bullet**:
A single line of outline text, with any nested child Bullets beneath it.
_Avoid_: Node, item, line

**Root Outline**:
The single top-most list from which every other Bullet is reachable.
_Avoid_: Home, master list

**Folder Bullet**:
A Bullet whose children are not stored beneath it but in an Outline File inside the directory it points to. Its text is the name of that Outline File.
_Avoid_: Context, project bullet, directory node

**Outline File**:
A plain-text file holding the children of exactly one Folder Bullet.
_Avoid_: List file, document

**Annotation**:
An inline `[kind:value]` marker inside a Bullet's text that carries formatting or metadata, such as colour, date, link, or folder location.
_Avoid_: Tag, markup, decoration

**Bullet ID**:
The unique identifier every Bullet carries as an Annotation, used to link and reference Bullets across Outline Files.
_Avoid_: Key, ref

**Date**:
A typed calendar value attached to a Bullet as an Annotation, distinct from any date-looking text, so it can be sorted, filtered, and later used for reminders.
_Avoid_: Due, timestamp

**Done**:
The completed state of a Bullet, recorded as an Annotation together with the Date it was completed.
_Avoid_: Checked, complete, finished

**Orphan**:
An Outline File on disk that no Folder Bullet references.
_Avoid_: Dangling file, unlinked file

**Broken Folder Bullet**:
A Folder Bullet whose directory or Outline File no longer exists at the location it points to.
_Avoid_: Dead link, missing folder

**Admin**:
The management view that lists every Folder Bullet and its Outline File and supports operations across them, such as copy and move.
_Avoid_: Settings, dashboard

**Skill**:
The instructions installed globally or per project that teach an agent how to read and edit Outline Files.
