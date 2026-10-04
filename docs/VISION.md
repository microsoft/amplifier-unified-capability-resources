# Resources capability vision

## Inherited approved direction

This repository owns shared artifacts, immutable versions, Canvas, CanvasApps and
attachments for Amplifier Unified. Work and its resource identities survive client
restart, view changes and host recovery. Viewing or editing one selected resource
must perform bounded work on that resource and its actual dependencies. Historical
existence alone must not hydrate bodies or start an agent.

This is the local application of the distribution-owned approved
[family vision](https://github.com/microsoft/amplifier-unified/blob/preview/ahp-acp-preview/docs/architecture/VISION.md)
and [component map](https://github.com/microsoft/amplifier-unified/blob/preview/ahp-acp-preview/docs/architecture/repositories.md).
Those links follow the distribution’s published preview branch. This document does
not independently ratify new scope or replace upstream AHP/ACP semantics.

## Desired outcomes and ownership

- Stable artifact IDs and immutable definition/state versions retain original bytes,
  ownership and publication links; conflicting writes preserve unfinished input.
- Catalogs and presentation metadata remain bounded and body-free. Selected bodies,
  upload chunks and historical payloads are delivered on demand with integrity checks.
- Reviewed imports preserve source data and report omissions. Unknown outcomes stay
  truthful; recovering a resource never replays past execution or client effects.
- Public host interfaces let independently installed consumers use the owner without
  importing client UI or native Amplifier runtime internals.
- Held owner fences protect accepted work and retained file references during
  maintenance, disposal and recovery.

Clients own rendering, private drafts, unsaved editors, sandbox readiness and
reversible presentation reset. The host owns admission/authentication; portability
and trusted composition own signed plan/release verification. This owner validates
its exact binding and immutable copied bytes. It does not become another canonical
conversation store, execute agent work, automatically fetch HTTP resources, delete
canonical histories, or grant a browser authority to verify its own transfer.

[Contract v1](CONTRACT.v1.md) maps these outcomes to executable checks and records
acceptance gaps without lowering the desired behavior. No novel obligations are
ratified by this packet; changes in cross-owner semantics need coordinator review.
