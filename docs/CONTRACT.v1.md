# Resources public contract — v1

This entry point organizes the existing owner promises and consumer obligations.
It inherits the approved direction in [Vision](VISION.md), references the existing
schemas and README, and adds no new wire format or runtime authority. Upstream AHP
resource semantics and ACP content types remain authoritative. Optional Unified
capabilities require negotiation; saved configuration is not mounted behavior.

The approved shared clauses are distribution-owned:
[HP](/Users/brkrabac/.codex/.chatgpt-projects/g-p-68d68d20c6a48191bae1ab4584d199f6/worktrees/ahp-acp-distribution-20261002/contracts/host-protocol.v1.md),
[AP](/Users/brkrabac/.codex/.chatgpt-projects/g-p-68d68d20c6a48191bae1ab4584d199f6/worktrees/ahp-acp-distribution-20261002/contracts/agent-protocol.v1.md),
[WS](/Users/brkrabac/.codex/.chatgpt-projects/g-p-68d68d20c6a48191bae1ab4584d199f6/worktrees/ahp-acp-distribution-20261002/contracts/working-set.v1.md),
[CB](/Users/brkrabac/.codex/.chatgpt-projects/g-p-68d68d20c6a48191bae1ab4584d199f6/worktrees/ahp-acp-distribution-20261002/contracts/component-boundaries.v1.md),
[CS](/Users/brkrabac/.codex/.chatgpt-projects/g-p-68d68d20c6a48191bae1ab4584d199f6/worktrees/ahp-acp-distribution-20261002/contracts/client-state.v1.md),
[CX](/Users/brkrabac/.codex/.chatgpt-projects/g-p-68d68d20c6a48191bae1ab4584d199f6/worktrees/ahp-acp-distribution-20261002/contracts/client-experience.v1.md), and
[CD](/Users/brkrabac/.codex/.chatgpt-projects/g-p-68d68d20c6a48191bae1ab4584d199f6/worktrees/ahp-acp-distribution-20261002/contracts/client-development.v1.md).
These review-source links do not claim that the distribution packet is published.

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
