# Hive sync and offline editing

Status: proposed design for review; implementation has not started.

## Agreed behavior

Lister presents one shared Root Outline containing Outline Files owned by different computers. For example, “Mac dev projects” lives in a development directory on the MacBook, while “Mac mini projects” lives on the Mac mini. Each computer watches and writes its own files. Every joined device can see and edit every shared branch, including when the file owner is offline.

The Mac mini initially hosts a single explicitly designated hive hub. Clients keep working while it is unreachable; exchanging changes waits until it returns. There is no automatic hub election or direct peer transport in the first version. Conflicting text edits preserve both versions and display “Needs review.” Unrelated changes continue syncing.

The pre-design code checkpoint is the local annotated tag `pre-hive-sync`, pointing to `6ca5853`.

## Roles and ownership

- **Hub:** authenticates hive members, retains shared state and durable change history, reconciles submitted changes, and delivers updates to clients.
- **Computer agent:** holds a local replica, submits edits, and watches/writes registered local Outline Files. Only the owning agent materializes a shared file at its project path.
- **Browser client:** holds an editable replica and pending changes; it never needs access to project directories.

The hub and the Mac mini agent can run in the same process, but use the same logical sync boundary as other clients. A browser can connect to its local agent or directly to the hub. A local agent relays browser edits; the UI distinguishes local-agent receipt from hub receipt.

Each Outline File has one owner. Moving an ordinary bullet into another file assigns persistence of that bullet to the destination file's owner. Moving a Folder Bullet changes its position in the shared tree, not ownership of the Outline File it references. Transferring ownership of an entire Outline File is outside the first version.

## Identity and directory mappings

Persist independent identifiers for the hive, each device, each editing replica, each Outline File, each Bullet, and each operation. Device labels and branch names are editable display values. Hostnames, addresses, and paths are not identities.

Preserve existing Outline File and Bullet IDs, including the current convention that a Folder Bullet and its referenced file header share an ID. New offline bullets receive permanent IDs immediately. Joining/registering files must detect collisions; never silently rewrite existing IDs or treat a copied file as a second owner. A copied file must be explicitly linked to an existing shared file or imported with a checked ID remapping.

Shared file metadata includes file ID, owner device ID, title, and registration state. The owner maintains the authoritative local path mapping. A nonowner resolves Folder Bullets through file IDs in its replica, never by opening a received path on its own filesystem. Existing `[folder:...]` values remain compatible on their owning computer; a referenced remote file uses `[outline:<file-id>]` and shared registration metadata rather than a locally meaningful folder path. The parser must preserve this annotation and treat it as a Folder Bullet reference. Local references can retain `[folder:...]`; the shared replica resolves both forms to a file ID without altering existing IDs.

The creator's Root Outline becomes the hive root. A joining computer's existing root can be explicitly attached as another branch after collision checks; it must not replace the hive root. Only files deliberately registered under the shared tree are published. All first-version members have access to all shared branches.

## Pairing and connection

“Create hive” generates a Hive ID and establishes the hub's durable identity. It offers a short-lived, single-use pairing invitation containing the hub address and hive identity. “Join hive” exchanges the invitation for revocable device credentials and asks for a device label. Invitations do not contain reusable administrative credentials.

Use a stable HTTPS address, initially through the existing private network setup. Persist the address, expected Hive ID, and credentials. Verify the authenticated endpoint and hive identity on connection; matching a claimed Hive ID alone is insufficient. Address changes are explicit configuration updates, not new hives. Pairing a browser produces its own replica identity and scoped session credentials.

Discovery and server election are unnecessary: every member remembers its configured hub. Reconnect with backoff, then run catch-up sync. Connection notifications are hints; missed notifications must not cause missed data. Removing a member revokes future access but cannot erase data already cached by it.

## Durable local editing

Use a transactional local store for each replica: SQLite for computer agents/hub and IndexedDB for browsers. Keep the shared data model and reconciliation logic independent of either storage adapter. Cache the application shell for offline browser startup, alongside outline data. Browser offline readiness requires a completed initial load and a supported secure origin.

An edit transaction records its operation and updates the local projection together. Show “Saved on this device” only after that transaction succeeds. If storage fails, surface the unsaved state rather than displaying success. The first version downloads the complete registered outline; show download progress and do not imply uncached branches are available offline. Search uses the local replica and discloses incomplete coverage while downloading.

Each operation contains a unique ID, author replica, causal base/dependencies, target IDs, operation kind, and the information needed to reconcile the changed fields or structure. Use semantic actions for create, edit fields, delete, move, register, and resolve conflict. Ordering uses stable neighboring Bullet IDs and deterministic tie-breaking, not stale numerical indices alone. Wall-clock timestamps are informational, not conflict precedence.

Pending edits survive restarts. Undo creates a new compensating operation through the same path, subject to reconciliation; it does not rewind global history or recreate bullets with new IDs. New edits made during sync remain pending independently of older acknowledgments.

## Sync protocol and hub persistence

Bootstrap from a consistent snapshot and its sync cursor, then fetch subsequent changes. Upload operations with stable IDs and their dependencies. The hub validates membership, references, and causal prerequisites; applies accepted operations and conflict records; and commits the outcome plus its deduplication record and monotonically increasing cursor in one durable transaction before acknowledging.

Retries return the prior outcome. Dependencies must be satisfied or explicitly rejected/deferred; a create followed by an edit must not lose ordering. Clients durably apply downloaded changes and advance their cursor together, then rebase outstanding local edits. Acknowledgment of hub acceptance never implies that a project file has been written.

The hub retains sufficient history, deletion records, and operation receipts to support disconnected clients. The first version favors retention over aggressive compaction. A client whose cursor cannot be served must obtain a new snapshot while preserving and reconciling its outbox. Restore/recovery must not silently interpret an old cursor against a different history; use a history generation identifier and require rebootstrap on mismatch.

## Reconciliation and conflicts

Merge based on the state the edit observed, the submitted change, and the current shared state. Existing `mergeOutlines` cannot be used unchanged: it prefers external content for same-bullet conflicts and external structure, which would discard offline intent.

| Concurrent changes | Result |
| --- | --- |
| Different bullets | Keep both |
| Different fields on one bullet | Keep both |
| Identical changes to one field | Coalesce |
| Different changes to the same text or note | Persist both candidates; Needs review |
| Different values for the same metadata field | Persist candidates; Needs review |
| Delete versus edit, or parent delete versus descendant edit/add | Preserve edited content in a recoverable conflict |
| Competing moves of the same bullet | Placement conflict |
| Independent insertions at the same position | Keep both with deterministic ordering |
| Move that would form a cycle | Preserve proposal as a conflict; maintain a valid tree |

The hub retains the current accepted value/placement while recording a conflicting proposal; neither candidate is discarded. A client may show its pending candidate before reconciliation, then clearly expose the resulting conflict. Conflict records include relevant base and candidate content, IDs, authors, and structural context. They live outside project-file text. The owner materializes the accepted projection; alternate content remains durably recoverable in the hive and author replica.

Resolution selects or edits a result and emits a new operation referencing the conflict revision. Concurrent resolutions or fresh edits must be checked again, not silently overwrite a newer version. Only related operations are blocked by an unresolved structural dependency; unrelated syncing continues.

## Filesystem bridge and crash recovery

For each owned file, persist the last observed disk snapshot, the applied shared revision, and any pending write intent. Direct CLI/agent/editor changes are diffed by IDs against that disk baseline and submitted as ordinary semantic operations. Missing IDs are assigned once and persisted. Duplicate IDs or malformed files surface a repair issue; do not overwrite unreadable content with a cached projection.

Before materializing incoming changes, reread disk and ingest fresh external edits. Serialize writes per file, retain a recovery copy and write intent, and use atomic replacement for complete file content. Recognize the exact output on watcher notification to avoid echoing it as a new edit. Recheck for intervening external changes; arbitrary external writers do not honor Lister's locks, so detected races must retain both versions and retry/reconcile rather than claim unconditional filesystem atomicity across writers.

A missing file or unavailable volume is an availability problem, not automatic shared deletion. Explicit removal distinguishes detaching a branch from deleting content. Renames with a preserved file ID update the owner mapping when discoverable; otherwise request relinking and retain cached content.

Cross-file moves are one logical shared transaction with a durable transfer ID. Disk writes on separate computers cannot be atomic. Write and acknowledge the destination before removing the source copy. Temporary duplicate disk content is acceptable while a transfer is pending; source and destination agents use the transfer journal to avoid importing those copies as new bullets. Preserve edits discovered on a stale source copy through reconciliation. On restart, resume transfer phases idempotently. The shared UI shows one placement plus pending file persistence.

Directory selection, folder conversion, and changes to physical storage locations require the relevant owner online and validating the filesystem. Renaming an existing Folder Bullet may sync offline as a title edit; its owner performs the associated file rename on return and reports collisions without overwriting another file.

## User-visible states

Distinguish “Saved on this device,” “Synced to hive,” and “Written to owner’s file.” Show connection state, pending edits, owner availability, and Needs review where relevant. A disconnected hub does not make cached branches read-only. A disconnected owner does not prevent hub synchronization.

The conflict UI presents both versions and allows choosing or composing a result. Storage errors, revoked membership, unsupported protocol versions, and file persistence errors remain explicit and retain recoverable local edits. Provide pending-edit export for recovery rather than requiring users to clear local storage.

## Boundaries and implementation organization

Keep separate modules for shared model/reconciliation, transactional replica storage, sync transport, hub admission/history, owner filesystem bridge, and UI state. Current API calls and undo callbacks must route through durable replica operations rather than direct mutation/refetch. Refetch/network failures must never evict unsynced content.

Preserve standalone use and existing Outline Files. Enabling a hive is explicit and starts with backups and registration. Upgrade protocol/storage versions explicitly; incompatible clients retain pending work and request an upgrade. Do not write sync journals into project directories or commit `.lister` files to Git.

Deferred: direct peer transport, automatic hub failover, multiple owners of one physical Outline File, selective sharing/access controls, aggressive history compaction, and automatic filesystem discovery outside registered locations.

## Required validation

- Two agents owning files at different paths expose one tree; neither opens the other's paths locally.
- Browser and computer clients reopen offline with cached data and pending edits intact.
- Remote edits reach an offline owner after return, including when that owner edited disk meanwhile.
- Retries after dropped acknowledgments do not duplicate additions or moves.
- Edits created during sync survive older acknowledgments and downloaded snapshots.
- Every reconciliation case above preserves intent or creates an explicit recoverable conflict.
- Direct file writes do not create watcher echo loops; malformed, missing, or unavailable files are preserved as issues.
- Crashes before/after hub commit, cursor advancement, file replacement, and each transfer phase recover safely.
- Pairing expiration/reuse, revoked credentials, wrong hive identity, and incompatible protocol versions are rejected without discarding pending work.
- Snapshot recovery and hub history generation changes retain pending local edits.

## Review and next step

Review this design before producing an implementation plan. Implementation should be staged around durable local edits and reconciliation first, then hub/pairing and multi-computer ownership, then browser offline startup and recovery/conflict UX. Each stage needs the relevant failure-path tests before enabling hive use on real project files.
