# Unified resources capability

Owner direction: [Vision](docs/VISION.md), [Contract v1](docs/CONTRACT.v1.md),
and [agent entry point](AGENTS.md). These organize inherited approved promises;
source and installed checks remain distinct from integrated acceptance.

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
text source input at 4 MiB and saved text bodies at 6 MiB (including JSON escaping). Images accept up to 8 MiB of original file bytes. Standard resource writes require the advertised latest URI
and an exact `ifMatch` value; conflicts preserve both stored versions and the
client's unfinished input. Editing a saved artifact never writes its source file.

`canvas.openFile` accepts an optional `expectedSha256`. It checks the complete
file bytes before saving, so generated-image delivery cannot attach a different
file if the source changed after generation. A mismatch leaves existing versions
untouched. Relative files resolve against the admitted execution directory,
including relocated chats; the original working directory remains history
identity. This action does not generate images or retry provider calls.

Immutable image resource URIs resolve to a byte size and SHA-256 ETag. Read
base64 byte pages with offset and limit (at most 256 KiB), then verify the whole
saved JSON body digest. Unpaged reads remain compatible with existing viewers;
the mutable latest URI retains its revision ETag for conditional writes. Catalog
reads and byte pages do not hydrate unrelated artifact bodies.

CanvasApps can request a bounded live status feed with a declared request whose
action is `coordination.watch` and input is exactly
`{targets:[{sessionId:"ahp-session:/...",workerId?}]}` (one to eight unique targets).
The client reviews the exact targets, validates them through the coordination
owner, and binds access to its selected app and definition revision. The Resources
owner only journals the review and claim; it does not read targets or start work.
Authored code subscribes with `canvasApp.coordination.subscribe(listener)` or reads
`canvasApp.coordination.getSnapshot()`. The version-1 snapshot contains sequence,
status (off/live/unavailable), and bounded target status/recent report excerpts.
It is ephemeral and independent of saved app state and unfinished edits.
Clients revoke it on hiding, navigation, revision change, disconnect, or reload.
Stored completion receipts never re-enable access. Use a new reviewed request.

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
history migration. Reviewed offline legacy import is available through the separate migration entry
point. Operational disk quotas remain an explicit distribution responsibility.

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
budget-exceeding attachment bytes and effect history are declared as explicit omissions, requiring
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

Interactive CanvasApps require the separate reviewed app importer described below;
external MCP artifacts and browser effects remain explicitly classified on the
retained source. The document importer does not activate them, claim complete
legacy feature migration, or restore old effect tokens. Exact original metadata remains in the destination
import journal for successfully copied documents; private views stay client-owned.

## Held owner intake fence

`createResourcesCapability` also accepts `onMayBeIdle()` and returns
`quiescenceParticipant(ownerId = 'resources')`, `inspectQuiescence()`, and
`quiescenceAccess`. A dedicated feedback upload owner can register the same real
participant using its own owner ID. The manifest marks only exact artifact/app
inspection, saved references, and upload inspection as read actions. It does not
infer safety from an action's name.

Before opening resource journals, the owner acquires a separate private SQLite
DELETE-journal lifetime `BEGIN EXCLUSIVE` lease. A second process cannot open the
same store or run its offline importer. The OS releases this lease after SIGKILL;
no PID file is deleted to reclaim ownership. The separate durable intake fence
becomes `unknown` after restart and remains closed until trusted reconciliation.

The participant atomically checks complete in-flight work and closes intake.
It counts asynchronous capability actions, conditional resource writes, queued
upload chunks and full-file commit validation, external MCP registration, and
transfer export/stage/activation. Close refuses while that work is still active.
The completion signal is advisory only; a waiting supervisor must acquire a new
held lease rather than treating a notification as proof of idleness.

Unfinished upload bytes and historical client-effect receipts remain on disk;
they are not background executors. No owner job replays them. A held gate rejects
new chunks, commits, Canvas events or changes, external registration, and transfer
mutations. Immutable selected bodies, exact upload metadata and historical evidence
remain readable. Client-local effects stay client-owned; a late acknowledgement
cannot mutate shared owner state through a held gate.

`acquire({fenceId,commandId,purpose,instanceId,dataScope})` uses the host participant
contract, with purpose `recovery` or `distribution-update`. It returns a held
lease or `null` for known active work. `release(outcome,proof)` and
`reconcileRelease({...context,outcome,proof})` bind the exact owner and host fence.
An unknown outcome keeps intake closed. A still-held lease may release after a
known aggregate admission refusal with `{kind:'admission-refused'}` and outcome
`unchanged`. Other releases require trusted supervisor proof containing
`verified:true,fenceId,commandId,outcome,instanceId,dataScope,receiptId`; `unchanged`
requires the prior host instance and `ready` a verified replacement. These methods
are private composition ports, not browser actions.

### Authenticated distribution admission abort

The private participant also implements `abortAdmission({...context, proof})` for
the Host's coordinator-approved pre-retirement distribution admission abort. The
embedding Host must authenticate the supervisor's proof before this callback;
`verified:true` is its trusted result, not a caller assertion or browser action.
The proof must contain exactly:

```js
{kind: 'distribution-admission-abort', verified: true,
 purpose: 'distribution-update', commandId, fenceId, instanceId, dataScope,
 receiptId: authenticatedSupervisorReceiptId}
```

The context binds the same four IDs and purpose. The participant's originally
registered `ownerId` also binds its durable attempt. It returns exactly
`{ownerId, status: 'released' | 'not-acquired', receiptId,
commandId, fenceId, instanceId, dataScope}`. Feedback composition must forward the
same upload owner ID used for acquisition and retain this distinct subowner
receipt. Generic release proofs cannot authorize admission abort.

New distribution acquisition stores a versioned original attempt with the held
fence in one transaction. A busy `null` refusal stores a durable `not-acquired`
attempt first; retrying that exact refusal never acquires after the work finishes.
A new acquisition attempt needs a new fence identity. Abort refuses while resource
work is active, on changed identities/proof, or without the original attempt.
A missing live fence is not evidence of refusal. An acquired attempt requires its
matching held/unknown fence or an already conclusive retained release receipt.
Legacy unknown records without the original attempt marker remain unknown.

Abort commits its exact receipt and fence removal atomically. After a lost reply
or restart, exact proof retry returns the original receipt without acquisition,
resource writes or replay. Retrying a completed old abort cannot clear a newer
held fence. This only settles owner admission; it does not run an update, settle
an unknown resource effect, modify upload bytes, or grant recovery from missing
journals. Existing startup-schema admission and release ports remain in force.

Offline legacy imports now require the destination owner to be closed and its
retained intake fence released conclusively. This preserves later destination
edits while preventing an importer from bypassing recovery ownership.

Release retry proof is immutable: the owner atomically retains the canonical
outcome and entire proof with its released receipt. After acknowledgement loss
or restart, only the identical context, outcome and proof are accepted; changing
the receipt identity, authority scope or outcome is rejected. JSON object key
order is irrelevant. Older released receipts without exact proof evidence are
not inferred or rewritten into verified release evidence.

## Persistent service stop and resume

The trusted `quiescenceParticipant()` advertises `serviceStop: {version: 1}`.
For `purpose: 'service-stop'`, the host supplies the normal fence context plus
`serviceIdentity: {installationId, dataScope, ownerId, instanceId, releaseDigest}`.
The owner copies and retains the complete identity with its durable intake fence;
restarting a process does not open intake or replay work. The host authenticates
platform evidence. This participant validates its exact binding, not a PID,
caller-provided claim of idleness, or socket presence.

A conclusive release needs `kind: 'service-lifecycle'`, the retained `expected`
identity, the exact `observed` identity, and the ordinary verified fence receipt.
`outcome: 'ready'` requires a distinct instance, `serviceOutcome: 'resumed'`,
`resumeCommandId`, `exitReceiptId`, and `readyReceiptId`. `outcome: 'unchanged'`
requires the same instance, `serviceOutcome: 'stop-refused'`, and
`refusalReceiptId`. The two receipt sets cannot be mixed. A changed release
identity, proof, or outcome refuses; exact completed retries are passive.
Generic update/recovery evidence cannot release a service fence.

`{kind: 'admission-refused'}` is restricted to the original live lease's partial
acquisition rollback. It is not a restart reconciliation mechanism. An unknown
outcome keeps intake closed, and passive inspection/receipt routes stay usable.
No service stop, platform process signaling, authenticated supervisor, or remote
provider safety is implemented by this participant itself.

The resource owner uses its existing exclusive SQLite process lease and atomically records release proof with fence removal. Uploads, migrations, native events, and retained asynchronous writes remain covered by its existing intake accounting.


## Held retention inspection

The actual quiescence participant advertises `retentionHide: {version: 1}`.
Acquire it with purpose `retention-hide` and the exact coordinator fence context.
The returned live lease exposes
`inspectRetentionReferences({sessions: ["ahp-session:/..."], limit: 101})`.
The family must contain 1–101 distinct explicit session URIs. The result is
`{coverage: "complete" | "partial", protected: [{session, reasons}], omissions}`.
Only the original held lease can inspect; release, uncertainty or replacement
invalidates that authority. Release reconciliation requires the same authenticated
coordinator proof and never retries effects. A pre-effect admission rollback is
allowed only on the original live lease. The purpose grants no mutation rights.

Inspection reads bounded indexed owner metadata while intake remains closed.
It never starts a native worker, scans canonical histories, deletes product records,
or interprets absence of a runtime as absence of deferred work. `complete` describes
this owner's reference coverage, not permission to hide or delete a conversation.
The coordinator must hold every configured owner, check all results, and use the
native history owner's separate preservation-first hide boundary.

Incomplete attachment uploads and pending/unknown CanvasApp requests protect their conversations. Immutable artifact bodies are not hydrated.

## Managed-file disposal protection

`quiescenceParticipant.managedFiles = {version: 1, preservesCanonical: true}` is a separate contract from `retentionHide`. It holds the real owner intake with purpose `managed-files-disposal`, preserving every owner record. The acquired lease exposes:

```ts
inspectManagedFilesReferences({
  sessions: [rootSession, ...descendants], // explicit AHP URIs, at most 101
  limit: 101,
  allocation: {allocationId, executionDirectory, allocationHash, treeHash, entryCount, bytes}
}) // {coverage: 'complete' | 'partial', protected: [{session, reasons}], omissions: [...] }
```

The allocation comes from the trusted host's native-reviewed managed allocation, never a browser path. It is bound with the exact selected family on the first inspection of the live lease; a different review is refused. This read does not grant file deletion. The coordinator must bind release to its exact durable managed-files effect receipt, keep unknown fences held, and refuse partial/protected coverage. Lease inspectors expire before release begins, including unknown release; admission-refused rollback is available only on the original live lease. Restart reconciliation requires the existing exact verified release proof.

Pending attachment uploads and CanvasApp requests protect selected conversations. Indexed file sources across all retained artifact versions protect an overlapping allocation, including cross-conversation sources and versions superseded by a detached current version. Imported artifact evidence is conservatively protected. Bodies are not loaded during inspection; self-contained copied inline content does not become an external file reference merely because its text mentions a path.

Inspection uses bounded selected metadata or indexed overlap probes, not native transcripts, a global history projection, or worker/model startup. Existing retention-hide and service-stop lifecycles are unchanged. The package tests cover the independently installed owner transport and held/unknown/exact-release behavior; full host/native/browser disposal acceptance remains a composition responsibility.

## Reviewed legacy interactive import

`importLegacyApps` from the `/migration` entry point imports only selected legacy
CanvasApps with reviewed exact metadata hashes. First call `importLegacyDocuments`
as above: retained interactive records now include `metadataSha256`. Review the
original definitions, state and session mapping, then supply
`reviewed: {"original-artifact-id": "<metadataSha256>"}` to `importLegacyApps` with
the same database/destination/session/workspace parameters. Its source-bound page
cursor is separate from the document cursor. Changed review hashes or mappings
refuse; identical repeats preserve subsequent destination edits.

The importer checks every retained version-1 manifest and state schema. Original
artifact IDs, definition revisions, state revisions, timestamps, publication links,
definition bytes and saved state bytes remain retained. Compatible current state
is copied into immutable owner snapshots. Historical events and completed requests
remain in the exact source metadata journal, rather than becoming active requests
or restored tokens. Any unresolved/unknown request, malformed version chain,
missing/corrupt state, unsupported schema or conflicting identity stays on source.
No HTML runs during import; no session starts or client effect replays. The source
and destination remain separate and the destination must have no live owner.

## Bounded attachment evidence and remote delivery

Historical transfer now copies committed attachment bodies that fit the existing
8 MiB envelope and 500-record limits, as verified binary evidence. The original
size and SHA-256 accompany each body. Selected metadata pages omit body data;
`readTransferBody` returns byte-exact base64 pages up to 256 KiB. Unfinished and
budget-exceeding bodies remain explicit omissions. Imports remain inactive historical
evidence and do not create executable attachments or remap old attachment URIs.

For a remote ACP engine, trusted composition may explicitly choose
`resolvePromptAttachment(context, attachment, {mode: 'remote-resource', resolveRemote})`.
The callback receives immutable `{uri,name,mimeType,size,sha256,chunkBytes}` metadata
and `read({offset,maxBytes})`, a session-scoped base64 reader capped at 256 KiB.
The complete source is streamed and verified before invoking the callback. Transport
must confirm `{uri,size,sha256}` for the exact resource; only HTTPS or explicitly
supported `amplifier-attachment:` remote URIs are accepted, with no embedded user
credentials. The returned standard ACP `resource_link` contains no local path or
body. The host owns authentication, expiry, engine support and admission; this
owner performs no implicit HTTP fetch. Lost transport results do not imply a turn
was accepted and must not cause automatic model/tool replay.

## Renderer acceptance boundary

CanvasApp clients must negotiate support for manifest version 1 before executing
HTML. Fetch the exact immutable `bodyUri` and bind the client-owned sandbox handshake
to artifact ID, definition revision, state revision, iframe identity and a fresh
client-local channel. Stale or unsupported renderers show an inspectable unavailable
view; they must not mutate/rewrite the resource to reset presentation. Readiness,
errors, editing buffers and reversible view reset remain client-owned. Requests
from an old iframe must never target a newer selected resource. Existing body
revisions and the owning capability's two-revision checks remain authoritative;
renderer readiness alone grants no effect-claim authority.

This owner qualifies preservation, bounds and installed public consumers. Actual
sandbox handshake, browser/device rendering, reversible presentation reset and real
remote engine transport require the web/TUI/host owners' acceptance receipts.

## Detached historical payload composition ports

The optional `verifyTransferPayloadPlan` constructor callback is a **trusted
embedding verifier**. It must authenticate the actual signed capsule, source and
destination pairing, transfer identity, exact resource-owner revision/evidence hash,
and plan SHA-256; audit all content-addressed plan pages/chunks; and return the
complete authenticated resource-ID → `{size,sha256}` mapping. A caller-provided
Boolean is refused. This callback is not a client action or a signature verifier
implemented by this resource library. A test fixture callback does not qualify
real signed product composition.

`stageTransferPayloads({transferId,sourceHost,destinationHost,ownerRevision,
evidenceHash,planHash,capsule,plan,bodies:[{id,path}]})` requires previously staged
resource evidence. The verifier returns the same exact identity fields plus
`owner:'unified.resources'` and `bodies:[{id,size,sha256}]`. The owner independently
streams and hashes each selected regular non-symlink file into its inactive
historical namespace. Bounds are 64 MiB/body, 1 GiB/selection and 500 selected
bodies; chunks cap at 256 KiB. This is an immutable transfer copy, never a second
mutable attachment authority. Source files are preserved.

The import retains a durable pending binding before awaiting authentication/copy;
interruption or verifier failure blocks activation, including after restart.
Only an explicit identical-plan retry can finish that copy; there is no automatic
retry. Changed plans refuse. Complete staging seals the exact mapping. Temporary
or orphan copied files after interruption grant no authority.

Trusted composition separately verifies the native signed release and calls
`activateTransferEvidence` with the exact `payloadPlanHash`. Missing/mismatched plan
binding refuses, and a pending/unknown import cannot activate. Only then may
`readTransferPayloadMetadata({session,transferId,evidenceHash,planHash,offset,limit})`
return up to 25 historical descriptors and
`readTransferPayloadBody({...sameIdentity,resourceId,offset,maxBytes})` return up
to 256 KiB of verified historical bytes. Reads validate exact ownership and saved
chunk digests. No live resource URI is rewritten, app rendered, prompt submitted,
attachment recreated or effect replayed. Availability does not imply execution
compatibility. Detached composition with the actual portability library, signed
capsules, native hosts and client renderers remains a distribution qualification.

## Registered source attachment metadata selection

Trusted composition registers `readTransferAttachmentMetadata` as a source callback;
it is not a global client endpoint or another transfer authority. Call
`readTransferAttachmentMetadata({session,expectedRevision?,cursor?,limit:25,maxBytes:262144})`.
The version-1 result is `{owner:'unified.resources',version:1,session,revision,
items,nextCursor,coverage,omissions}`. Each committed item contains exactly
`{id,name,contentType,size,sha256,etag,resourceUri,status:'committed'}`. No body bytes,
filesystem paths, drafts, native scans or worker initialization are part of this
callback. Reads use indexed authorized session metadata independently of the inline
evidence body's budget. Pages cap at 25 rows and 256 KiB of encoded response;
`maxBytes` may be lowered to at least 1024 bytes.

The opaque revision binds the explicit session and durable attachment metadata
epoch. Creation and actual commit advance it atomically with the metadata write;
chunk progress and exact retries do not. Echo `expectedRevision` and `nextCursor`
until the cursor is exhausted. A changed revision or scope-mismatched cursor
refuses instead of returning a mixed selection. Ordinary pagination leaves rows
for the next cursor. A descriptor too large even alone at the requested byte
budget is omitted explicitly by ID/reason and never truncated.

`coverage` describes omissions for the scoped revision; `complete` does not mean
that `nextCursor` has been exhausted. Unfinished attachment omissions repeat the
same count across pages at that revision; coalesce those identical entries rather
than summing them. Preserve per-ID byte-budget omissions from every page. A budget
too small for the cursor/coverage itself refuses. After copying selected bodies,
recheck the same `expectedRevision` before sealing the transfer.

The portability adapter signs the exact source selection revision, scope,
descriptors, coverage/omissions and their digest alongside the original
`evidenceHash`/`ownerRevision` and detached plan. Its target verifier must authenticate
that selection and require a one-to-one ID/size/hash mapping from audited plan
rows. Absence from inline evidence is permitted only through that signed selection,
never through a caller claim. Existing 500-body, 200-JavaScript-code-unit identifier,
64-MiB/body and 1-GiB selection limits still require negotiation/refusal or separately
reviewed omissions. The resources callback grants no release/activation permission.

## Authoritative database startup admission

Resource metadata is authoritative, even where it is called an index: artifact
ownership and versions, app state/effect receipts, upload identities, transfer
bindings, import journals and revision counters cannot be recovered from immutable
body files. A missing authority table is not an empty healthy store.

After acquiring the existing process OS lease, startup validates both
`resources.sqlite` and `resources-quiescence.sqlite` through read-only connections
before either writable open or restart fence normalization. A main database is
new only when it and its `-wal`, `-shm` and `-journal` entries are all absent;
empty or dangling sidecar entries also refuse. Existing empty, unsupported,
incomplete or incompatible schemas fail closed with originals retained. SQLite
may create empty WAL/SHM coordination files during a read-only WAL connection;
retained main and existing WAL bytes are preserved on schema refusal.

The guard checks a fixed, bounded set of schema metadata, not resource rows or
body files. Completed historical Store/factory/import profiles are recognized
explicitly. New namespace enrollment and table creation share a SQLite savepoint,
including inside the offline importer's transaction. A versioned namespace cannot
be silently recreated if its tables disappear. Independent process-lock state and
SQL lookup indexes remain rebuildable. Selected body integrity checks are unchanged.

This does not detect valid row deletion, coherent database replacement, deletion
of the main plus all sidecars, or legacy damage indistinguishable from a complete
supported historical profile. Column names/types and table identity are checked;
this is not comprehensive PK/UNIQUE/NOT NULL/trigger or general SQLite integrity
validation. It does not repair, copy or reconstruct authority. Recovery remains
an explicit owner/operator task, and unknown effects are never replayed.

[Fault and migration tests](test/authoritative-schema.test.mjs) cover every retained
authority table, cross-file admission ordering, actual interrupted-owner WALs,
orphan sidecars, nested enrollment rollback and historical profile upgrades.
The [historical DDL fixtures](test/fixtures/legacy-schemas.json) record their exact
source revisions. Source and installed-package qualification remain distinct from
product/browser or live deployment acceptance.

## Original attachment references after a Native fork

Trusted composition may register `verifyOriginalAttachment` and call
`retainForkAttachments({version:2, commandId, target:{row,blockIndex}})` for each
preserved original card. The verifier must read the original completed Native
fork receipt and exact persisted source/target occurrence; browser fields cannot
supply that authority. The canonical owner URI stays unchanged. A separate passive
`resolveOriginalAttachment(targetHostSession, reference)` returns its scoped
access URI after Resources commits verified target-owned bytes. Ordinary history
reads never create missing grants or replay a fork.

See the [v2 contract and limits](docs/CONTRACT.v1.md#preserved-originals-and-fork-attachment-grants--v2)
and [trusted port types](docs/fork-originals.v2.d.ts). The new mutation namespace is
incompatible with older writers, preserves v1 records verbatim and enrolls only
on an explicit verified copy, not during an ordinary lookup. Keep the pre-upgrade
owner snapshot for rollback. The strict existing prompt attachment scope remains.

## PDF originals

Workspace PDFs up to 20,000,000 bytes use the existing immutable body store and
version index. PDF descriptors omit conditional editing. Opening a changed source
creates a new version; older versions retain their original bytes. Text limits
remain 4 MiB per source and 6 MiB per saved body.

PDF bodies require standard resourceResolve followed by base64 resourceRead pages:
add offset and limit (at most 262144 bytes) to the immutable body URI. Resolve
returns the encoded JSON body's size and a SHA-256 etag. Consumers must verify the
complete size and digest before decoding the original PDF data URI. Metadata reads
never hydrate the PDF. includeSource inspection returns a paged source reference
instead of a large inline body. Existing transfer budgets still apply and report
explicit omissions; preview support does not imply automatic model ingestion.

The PDF source and preservation checks are in test/pdf.test.mjs; browser renderer
and downloaded-byte verification belong to the separately packaged web client.

## Reveal a saved file on its app host

A file-backed artifact advertises `fileReveal` with its named host, current owner
instance and desktop availability. `canvas.reveal` requires the exact artifact ID,
session, saved version, host ID and instance ID. The owner resolves the saved
source again and refuses changed links, missing files or a different host.
This opens the host file manager; it does not open a folder on a remote browser's
computer. Headless hosts advertise unavailability and clients offer download.

The existing event journal records intent before the operating-system request.
An acknowledged request can return its saved receipt. A timeout, lost outcome or
restart never repeats an uncertain request. The file, artifact body and version
history are unchanged. Platform argument tests and installed consumer tests do
not establish a physical desktop/file-manager acceptance.
