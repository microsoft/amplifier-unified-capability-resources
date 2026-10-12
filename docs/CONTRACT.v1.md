# Resources public contract — v1

This entry point organizes the existing owner promises and consumer obligations.
It inherits the approved direction in [Vision](VISION.md), references the existing
schemas and README, and adds no new wire format or runtime authority. Upstream AHP
resource semantics and ACP content types remain authoritative. Optional Unified
capabilities require negotiation; saved configuration is not mounted behavior.

The approved shared clauses are distribution-owned:
[HP](https://github.com/microsoft/amplifier-unified/blob/preview/ahp-acp-preview/contracts/host-protocol.v1.md),
[AP](https://github.com/microsoft/amplifier-unified/blob/preview/ahp-acp-preview/contracts/agent-protocol.v1.md),
[WS](https://github.com/microsoft/amplifier-unified/blob/preview/ahp-acp-preview/contracts/working-set.v1.md),
[CB](https://github.com/microsoft/amplifier-unified/blob/preview/ahp-acp-preview/contracts/component-boundaries.v1.md),
[CS](https://github.com/microsoft/amplifier-unified/blob/preview/ahp-acp-preview/contracts/client-state.v1.md),
[CX](https://github.com/microsoft/amplifier-unified/blob/preview/ahp-acp-preview/contracts/client-experience.v1.md), and
[CD](https://github.com/microsoft/amplifier-unified/blob/preview/ahp-acp-preview/contracts/client-development.v1.md).
These links follow the distribution’s published preview branch; they do not claim release or deployment acceptance.

## Boundaries, promises and falsifiers

| Promise and shared basis | Executable check | What would falsify it |
| --- | --- | --- |
| Immutable IDs/bodies/versions; source-preserving conflicts and reviewed import (WS1, CS4/7) | [resources](../test/resources.test.mjs), [migration](../test/migration.test.mjs), [apps](../test/apps.test.mjs) | Reimport overwrites later work; restore rewrites source or replays an effect |
| Metadata/body separation; updates visit selected dependencies (WS3–5, CS2/3) | Metadata paging and unrelated-corrupt-body tests in [resources](../test/resources.test.mjs)/[apps](../test/apps.test.mjs) | A tiny edit or selection loads unrelated bodies or serializes historical global state |
| Scoped bounded attachments and explicit remote transport (HP1/2/5, AP1/3/5 public resource/content boundaries, WS3/4, CS1) | [attachments](../test/attachments.test.mjs) | Wrong-session bytes escape; oversize inline input executes; local file paths masquerade as remote delivery |
| Unknown effects and historical imports grant no execution authority (CS4/8, WS1) | [apps](../test/apps.test.mjs), [transfer](../test/transfer.test.mjs), [payloads](../test/payloads.test.mjs) | Restart replays an effect; detached copy becomes a live attachment or bypasses signed-plan binding |
| Held intake/reference inspection is truthful (CB7, CS7) | [quiescence](../test/quiescence.test.mjs), [managed files](../test/managed-files.test.mjs), [service stop](../test/service-stop.test.mjs), [retention](../test/retention.test.mjs), [release proof](../test/release-proof.test.mjs) | FIFO holds an effect forever; unknown import disappears; disposal ignores retained file references |
| Independent ownership and evidence limits (CB1–6, CD1–6, CX1/6/7, CS2/8 client ownership) | Package exports, README integration recipe, independently installed consumer/host receipts | Source tests are reported as browser/device/account or deployed acceptance |

These are preservation and bounded-work promises, not assertions of complete
product acceptance. [Action schemas](../src/actions.js), [attachment schemas](../src/attachments.js)
and [README](../README.md) retain the existing exact API definitions. This document
references them rather than duplicating schemas or upstream protocol definitions.

## Consumer obligations and current limits

Host composition authenticates scope, resolves the selected session through public
interfaces, registers every resource provider and forwards scoped invalidation.
Clients retain private drafts and effect intent journals; they verify exact body
identity, negotiate manifest-version support, bind sandbox handshakes to the exact
iframe/resource/revisions and keep reversible reset local. Renderer readiness does
not grant effect authority. Nonregular sources are refused without blocking intake.

The trusted embedding verifier authenticates actual signed capsule/plan identities,
performs complete portability page/body audit and returns the authenticated resource
mapping. Caller Booleans do not suffice. Native release verification remains its
separate duty. Pending/unknown import evidence blocks activation, including restart.
Historical copies remain inactive and do not rewrite canonical URIs.

Detached receiver bounds are 500 bodies, 64 MiB/body and 1 GiB/selection, with
resource IDs capped at **200 JavaScript string code units**. Portability permits
10000 IDs and 1024 UTF-8 bytes per ID. Consumers must negotiate compatible limits,
refuse incompatible inputs, or build a separately reviewed selection with explicit
omissions. They must never truncate IDs or silently drop records. Inline historical
evidence retains its separate 8 MiB/500-record bound.

## Evidence and unqualified acceptance

The implementation packet records exact source, archive and installed-file hashes,
source tests, independently installed public consumers and a separately installed
host resource fixture. The FIFO successor has focused source/installed regression
receipts. The earlier full suite remains evidence for its exact earlier revision;
focused successor checks do not imply a newly rerun complete-app suite.

Actual embedding signature verification/full PayloadStore composition, native
signed-transfer assembly, remote ACP transport, browser/device renderer handshake,
reversible presentation reset, minimum-runtime/platform combinations and live
adoption remain explicit integration gaps. These gaps do not retire the promises
above. No new obligations beyond the inherited direction and existing reviewed
API are ratified here; novel scope changes require coordinator approval.

## Source-selection callback v1

The registered `readTransferAttachmentMetadata` callback in the
[README](../README.md#registered-source-attachment-metadata-selection) supplies
indexed body-free scoped metadata with CAS revision refusal, 25-row/256-KiB pages,
explicit cursor/coverage/omissions and existing immutable resource identities.
[Metadata selection tests](../test/attachment-metadata.test.mjs) falsify missing
attachment descriptors when inline artifact budget is exhausted, mixed stale or
wrong-session pages, hidden truncation and revision drift across exact retries or
restart. A complete coverage label does not waive exhausting the cursor.

This is the coordinator-approved completion of the existing bounded historical
transfer promise (HP2/5, WS3–5, CS1/3/4, CB3/6). The adapter must sign the exact
selection digest/revision/descriptors/omissions with the existing evidence and plan
binding and authenticate them on the destination. Source metadata itself is not
signed-release authority. Actual adapter/native signed-transfer qualification
remains separate from this owner callback's source and installed tests.

## Authoritative startup schema admission

The existing preservation and held-intake promises also apply to missing durable
schema. [Startup admission](../README.md#authoritative-database-startup-admission)
validates the two retained owner journals before writable initialization, under
the original process lease. Missing previously enrolled tables must refuse rather
than erase visibility, an original command identity or an unknown effect barrier.
Fixed metadata inspection preserves bounded startup work; immutable bodies are
not scanned or treated as a substitute for the unique receipt/version mappings.

[Schema fault tests](../test/authoritative-schema.test.mjs) falsify silent recreation,
crash-left main/WAL modification on refusal, or incompatible historical profile
acceptance. They also retain the supported partial Store/offline-import paths and
atomic namespace enrollment. This guard adds no client operation or new recovery
authority. The documented row-deletion, whole-database-loss and constraint-validation
limits remain explicit; it is not a general integrity or automatic repair claim.


## Distribution admission abort participant

The coordinator-approved Host admission-abort callback uses this existing resource
SQLite authority, including attachment uploads; it introduces no shared gate or
backward dependency on distribution update implementation. The embedding Host
authenticates the distinct `distribution-admission-abort` proof. The callback
validates the exact original owner/command/fence/instance/data-scope and returns
only a durable `released` or `not-acquired` owner receipt.

[Admission-abort tests](../test/admission-abort.test.mjs) falsify inferred refusal
from a missing hold, legacy-unknown promotion, changed proof/identity, active-work
settlement, partial receipt/clear commits, or reacquisition/re-execution after lost
reply or restart. Durable busy refusals cannot silently turn into acquisitions.
The original proof signature and receipt survive process replacement; retries do
not clear unrelated later holds. The [README](../README.md#authenticated-distribution-admission-abort)
defines the exact private callback shape. Actual aggregate/Host authenticated proof
composition, package adoption and live deployment remain separate acceptance.

## Preserved originals and fork attachment grants — v2

This coordinator-approved amendment uses the existing Resources attachment byte
and grant authority. [The v2 port types](fork-originals.v2.d.ts) describe one trusted
occurrence per request. `verifyOriginalAttachment` authenticates the completed
original Native fork receipt, exact persisted target row/block, immediate source
lineage and Host/native/engine scopes. The callback is not caller-supplied proof.
Every occurrence is verified, including retries that share a completed grant.
Resources independently validates its original handle and committed bytes.

Canonical original references never change. `resolveOriginalAttachment` performs
an authenticated target-scope, indexed read and returns a separate `accessUri`
only for a committed grant. It does not copy, enroll a namespace, start Native,
repair a receipt or write during history viewing. Missing returns `null`;
`pending`/`unknown` remains unresolved. The existing exact-session prompt guard
still rejects an original source URI when presented directly in a target session.
A chain A→B→C copies B's qualified owner bytes, even when the original URI names A.

Grant work is keyed by original fork command, target Host session and unchanged
owner reference. Repeated row/block occurrences can share that grant; they cannot
change its original Native authority or source binding. Calls and copies are
bounded (one occurrence, 8 KiB request, 32 KiB trusted proof, 32 MiB/file, 256 KiB
chunks, 64 concurrent callers). There is no total card or session-enumeration cap.
Host owns revision-consistent Native paging and must report partial progress.
Later ordinary appends do not replace the receipt's creation revision: the trusted
verifier qualifies the exact immutable row identity, including its epoch.

Before copying, the exact deterministic target ID and immutable plan are durable
in `resources.sqlite`. Attachment registration and completed grant commit together
after verified, synced bytes. Interruption leaves pending/unknown authority, no
usable grant. Explicit same-grant retry validates retained byte prefixes and
resumes those IDs; it never reforks Native. Validation/verifier refusal before
reservation throws without a grant; it never settles an older unknown record.
Incomplete grants protect source and target from retention/disposal.

The lazily enrolled `forkOriginalsV2` schema bit/table is distinct from the retained
v1 `forkAttachments` bit/table. Existing v1 receipts are recognized and preserved
verbatim, including unknown protection; they are not converted into v2 grants.
Existing target-owned attachments keep their ordinary access guards. This change
provides no v1 grant mutation or automatic v1-to-v2 migration. A command with a
retained v1 binding cannot be reused for v2 qualification without an explicit
owner migration; new qualified fork commands remain independent. Opening a v2 database
with an older writer refuses before writable startup; preserve a pre-upgrade
snapshot for rollback. Missing enrolled v2 schema also refuses, using the existing
owner lease and read-only startup preflight. No new database, Native map or Host
projection journal is introduced.

[Focused tests](../test/fork-originals-v2.test.mjs) cover repeated occurrences and
more than 64 distinct cards, chained bytes, cold retry, interruption, untrusted or
stale occurrence refusal, namespace compatibility and held intake. These are
actual temporary byte/SQLite source tests with a controlled trusted verifier.
Actual Native/Host verification, browser materialization, account and deployed
acceptance remain separate composition gates.

## Explicit saved-file reveal

The coordinator-approved Main parity action described in
[README](../README.md#reveal-a-saved-file-on-its-app-host) binds a saved artifact
version to its named host and owner instance. [Reveal tests](../test/reveal.test.mjs)
falsify arbitrary path execution, wrong-session or stale-host admission, symlink
retargeting, source modification and repeat execution after an unknown outcome.
This bounded OS presentation action grants no conversation execution or remote
browser filesystem authority. Actual desktop acceptance remains separate.


### Live Settings canvas identity

`canvas.show` also accepts `kind: settings`, without content, surface, path or URL.
It explicitly creates or reopens one chat-scoped Settings item. Repeated opens,
including after restart or import, reuse the existing identity without adding a
version. The body is empty; credentials and preferences remain with their current
owners. The metadata catalog advertises supported `canvasKinds`. Settings items
are not editable documents: resource writes, saved-version edits/restores and
canvas events are refused. Clients render their existing live Settings controls,
keep selection and unfinished fields private, and use their normal draft guards.
A host-side agent can save/retrieve the item with `canvas.show` and select its ID
on the intended attached client with `canvas.select`; shared metadata does not
force another client's selection. Offline import accepts only empty Settings
bodies and retains any unexpected content at the original authority.

### Image result presentation metadata

`canvas.openFile` optionally accepts `imageResult: {version: 1, toolCallId,
requestId, operation}` for `kind: 'image'` with `expectedSha256`. `toolCallId`
is bounded to 1100 characters, `requestId` to 500, and operation is `generate`
or `edit`. The owner verifies the existing file digest before saving and retains
these fields plus `sha256` in the immutable definition and version descriptors.
Metadata pages expose these small fields without hydrating image bodies.

This is presentation provenance, not authorization or proof of a model/tool call.
Clients match it only to the selected chat's actual admitted tool events and
publication links. Callers cannot start/retry image work through this metadata.
Native supplies it only when composition advertises exact `imageResultMetadata: 1`
support after inspecting this owner's actual `canvas.openFile` schema. Legacy
publications without metadata remain supported. Ordinary content edits do not
inherit generation provenance into a new version.

### Saved outputs and exact copy references

The coordinator's Main parity composition advertises the `outputs` topic and
shared bounded action schemas. Resources owns saved output bodies and local
review notes; Native owns canonical message identity and copy boundaries. Host
supplies original-message verification and serializes output changes against
workspace movement. A Native-confirmed copy proof is required before Resources
copies relationships; neither client-supplied text nor tool provenance alone is
copy authority. Duplicate receipts must reconcile the original effect. See the
README's saved-output contract and executable output/migration tests.
