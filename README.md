# Unified resources capability

Optional independently packaged Canvas owner for `@amplifier/unified-host`.
`createResourcesCapability({directory,inspectSession,onChanged})` exposes a
capability manifest, `read`, `action`, a standard `resourceProvider` and `close`.
Pass the host's authenticated action context to `action`; resolve session scope
through public `host.inspectSession`, and forward `onChanged` to
`host.invalidateCapability`. No native Python or client implementation is imported.

`registerExternal({session,workingDirectory}, descriptor)` registers a bounded
MCP view descriptor and its owned `amplifier-mcp:` body URI. Detailed bindings,
documents, saved tool results and authorization stay with the MCP provider.
Registration checks the trusted execution workspace and session; subsequent
generic Canvas writes cannot modify another provider's resource. The same ID
updates its saved descriptor without opening a duplicate view.

Metadata pages default to 50 and cap at 200. An explicit `id`/`version` query reads
one descriptor. Bodies are fetched only by their advertised URI. Definitions and
app-state snapshots are immutable content-addressed files; SQLite indexes their
ownership, versions and metadata. Writes sync body and directory before committing
the index. Saved history is retained; this package does not delete native files.
File viewing resolves symlinks inside the authorized execution workspace and caps
source input at 4 MiB and saved bodies at 6 MiB (including JSON escaping). Standard resource writes require the advertised latest URI
and an exact `ifMatch` value; conflicts preserve both stored versions and the
client's unfinished input. Editing a saved artifact never writes its source file.

CanvasApps have separate definition and state revisions. Declared events and
state patches are validated against bounded JSON Schema; external references and
regular expressions are excluded. Metadata includes neither shared state bodies
nor editing buffers. Each selected body URI identifies an immutable state snapshot.
Refinements require both revisions and retain compatible current shared state;
restoring a definition never replays an event or client effect. Direct generic
resource writes cannot bypass app schema validation.

An approved local theme request uses `canvas.apps.resolve` in two phases. `claim`
persists an unknown outcome and returns `result.effect={token,action,args}` to the
authenticated calling client. The client durably records the token, applies its
own local effect and sends `complete` with `token` and `outcome: applied|failed`.
Completion is owner-bound and idempotent. A crash or lost reply never resubmits an
unknown effect. Rejection is a normal shared-state update. The sandbox itself has
no authority to claim requests. Host themes and client editing buffers are never
mirrored by this provider.

Run `npm ci && npm test`. Tests cover historical-body immutability, restart,
conditional writes, scoped authorization, symlinks, metadata paging without body
reads, shared state conflict/schema checks and client-effect admission/recovery.
Browser integration belongs to the separately packaged web client. These tests
do not qualify live MCP services, paid providers, device access or production
history migration. Old artifact import and operational disk quotas remain explicit
distribution responsibilities.

## Shared attachments

Private draft bytes stay in each client. Explicit Send creates an upload with
`attachments.create`, appends up to 256 KiB per standard `resourceWrite` (base64,
append, exact byte offset in the URI), then calls `attachments.commit`. Files cap
at 32 MiB. Inspect an exact creation request or attachment ID after uncertain
replies; identical acknowledged chunks are safe to resend, changed bytes are
refused. An interrupted unacknowledged file tail is discarded before continuing.
Commit streams the declared SHA-256 and makes the body immutable. Metadata and
conversation history contain references, never bodies or unfinished drafts.

Use all entries of `resourceProviders` when composing the host. The original
`resourceProvider` remains the Canvas provider. Attachment bodies support bounded
byte pages, defaulting to base64; UTF-8 requests reject invalid or split sequences.
Clients verify complete size and SHA-256 before displaying assembled downloads.

`resolvePromptAttachment(context, attachment, {mode})` checks the selected
conversation and revalidates the complete committed body before execution. Default
`inline` materializes at most 4 MiB as standard ACP content. Explicit `local-files`
returns a standard ACP resource link for engines configured to share the owner's
filesystem. That mode does not claim remote filesystem access or automatic
provider-specific image/PDF ingestion. Oversize inline input fails before turn
admission. Uploads cap at 16 unfinished files per conversation and 256 per owner;
concurrent writes have a bounded queue. Historical bodies remain on disk.

## Historical transfer evidence

The private portability hooks `exportTransferEvidence`, `stageTransferEvidence`
and `activateTransferEvidence` preserve immutable observations under owner
`unified.resources`. The trusted portability composition must verify the public
byte-preserving envelope, paired source and signed release before calling them.
Each transfer ID seals one export; repeating it cannot silently capture later
changes. Exports cap at 8 MiB and 500 records. Remaining versions, external bodies,
attachment bytes and effect history are declared as explicit omissions, requiring
preview acceptance rather than being represented as a complete transfer.

Imports live separately from active Canvas artifacts, app state and attachments.
They grant no rendering, editing or client-effect authority. `readTransferEvidence`
returns selected metadata pages. Bodies stay behind `readTransferBody` with an
exact record index and byte offset, base64 pages up to 256 KiB, complete size and
SHA-256. Source namespaces and unknown evidence are preserved. Source files are
never deleted, and importing history does not replay events.

## Explicit legacy document import

The separate public `@amplifier/unified-resources-capability/migration` entry point
exports `importLegacyDocuments`. Run it offline with a reviewed mapping:

```js
import {importLegacyDocuments} from '@amplifier/unified-resources-capability/migration';
const page = importLegacyDocuments({
  database: '/retained/unified/app.sqlite3',
  destination: '/owned/new-unified/resources',
  sourceSession: 'original-session-id',
  session: 'ahp-session:/reviewed-destination-id',
  workingDirectory: '/reviewed/existing/workspace',
  limit: 20, // repeat with after: page.nextCursor
});
```

The operator verifies that the destination host session belongs to this native
conversation/workspace. This function does not create, load or execute a session.
It opens the original database read-only, respects committed global overlays,
and filters one selected legacy session before returning a page. No private
client state is imported. The SQL engine may parse the old checkpoint during this
explicit offline operation; this is not an interactive catalog path. A checkpoint
above 256 MiB is refused and retained for a separate export workflow.

Ordinary document versions retain their identities, original body hashes/bytes,
timestamps and message links. The destination commits each complete artifact
atomically; interrupted immutable file copies can leave harmless orphan blobs.
An identical repeat leaves later destination edits intact. Changed mappings,
existing destination identities, missing/corrupt bodies and unsupported records
are classified as retained, never overwritten or reconstructed from a workspace
file. Pages are bound to the source revision. Each artifact is bounded to 500
versions and 32 MiB combined, with 512 KiB metadata and 6 MiB individual bodies.

Interactive CanvasApps, external MCP artifacts and browser effects require their
original owner and remain explicitly classified on the retained source. The
importer does not activate them, claim complete legacy feature migration, or
restore old effect tokens. Exact original metadata remains in the destination
import journal for successfully copied documents; private views stay client-owned.
