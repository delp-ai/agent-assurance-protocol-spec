# Agent Assurance Protocol

<p align="center">
  <img src="resources/logo.png" alt="Agent Assurance Protocol" width="200" />
  <br/>
  <em>Contracts, proof, and closure for autonomous agents.</em>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License: Apache 2.0" /></a>
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/contributions-welcome-orange.svg" alt="Contributions Welcome" /></a>
  <a href="CODE_OF_CONDUCT.md"><img src="https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg" alt="Contributor Covenant 2.1" /></a>
</p>

<p align="center">
  <a href="#specification-set">Specification Set</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="SECURITY.md">Security</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="LICENSE">License</a>
</p>

This workspace is publishing the current specification set for `AAP (Agent Assurance Protocol)`:
a protocol for agent interactions that need explicit contracts, portable proof,
bounded dispute handling, and machine-closed outcomes.

`AAP` is meant for the cases where simple request/response and local convention stop
being enough: work crosses trust boundaries, consumes real permissions or budgets,
and may need challenge, repair, settlement, and replayable audit.

This repository publishes the maintained `AAP` surface as authored protocol documents,
generated SSOT artifacts, conformance fixtures, and replay-oriented validation.

The current revision is written for autonomous agents operating without human fallback.
Any behavior that depends on manual interpretation, manual approval, or informal trust
should be treated as out of scope for interoperable `AAP`.

For a compact, human-centered explanation of why this protocol matters and what ecosystem it can
enable, see [`VISION.md`](VISION.md).

## In One Sentence

`AAP` is a protocol for agent interactions that need explicit contracts, portable proof,
bounded dispute handling, and machine-closed outcomes rather than best-effort request passing.

## Why This Exists

Many agent integrations work well when the interaction is simple:

- call a tool
- send a task
- stream back partial output
- trust local policy to decide whether the result is good enough

`AAP` is aimed at a harder class of interaction:

- work crosses trust or organizational boundaries
- permissions, budgets, and deadlines must be explicit
- one agent may delegate or consume scarce capability on another's behalf
- a result may need proof, challenge, repair, settlement, and auditability
- a failure path must terminate deterministically without human cleanup

In that setting, "request plus local convention" is often too weak. `AAP` treats the
interaction itself as a portable, machine-checkable agreement.

## When To Use `AAP`

`AAP` is a good fit when:

- autonomous work has economic, policy, or operational consequences
- the parties need verifiable evidence instead of trust by reputation alone
- the interaction can outlive one request or one transport round-trip
- both sides need the same understanding of contract state and terminal outcome
- replay, audit, or cross-implementation testing matters

Typical examples:

- cross-agent execution under an explicit budget or authority boundary
- billable or irreversible capability consumption
- long-lived contracts with proof, challenge, repair, and close
- federation between pre-configured cells or bounded unknown-peer public interoperability

## What `AAP` Is Not

`AAP` is not trying to be:

- a lightweight replacement for every agent request/response protocol
- a human-in-the-loop approval workflow
- a vague semantic convention that leaves critical behavior to local interpretation
- a broad unknown-peer interoperability claim beyond the maintained `AAP Open Core` surface

If the problem is simple endpoint invocation, local orchestration, or informal cooperation,
`AAP` may be unnecessarily heavy. The protocol is intended for cases where the additional
structure pays for itself in portability, accountability, and fail-closed behavior.

## What This Repository Already Publishes

The repository is already publishing the surfaces an independent implementation would
need to target:

- normative wire, contract, trust, and canonical-object documents
- generated SSOT for schemas, registries, objects, byte fixtures, and bindings
- positive and negative conformance artifacts
- byte-level corpus material and transcript-level replay fixtures
- a subprocess replay harness for the maintained public bundle

The current practical value of this repository is protocol truth: it defines what a
compatible implementation would need to parse, emit, validate, and reproduce.

## Specification Set

- `01.WIRE.FORMAT.md`: low-level frame layout, headers, stream model, reliability, and flow control
- `02.CONTRACT.MODEL.md`: `ExecutionContract` schema, permissions, budgets, deadlines, delegation, and state transitions
- `03.TRUST.MODEL.md`: evidence bundles, verification records, audit chains, replay capsules, and trust levels
- `04.CANONICAL.OBJECTS.md`: canonical `aap-tagbin-v1` field tables for signed and digested base-profile objects
- `05.REFERENCE.STACK.md`: reference runtime architecture, storage model, policy engine, actor runtime, deployment profiles, and the boundary between conformance requirements and implementation guidance
- `06.CRITICAL.REVIEW.md`: autonomous third-party review, readiness split, and hardening priorities
- `conformances/README.md`: published conformance corpus and transcript map for independent implementers
- `conformances/08.NEGATIVE.CASES.md`: fail-closed corpus for deterministic rejection behavior
- `conformances/09.BYTE.CORPUS.md`: byte-level corpus format and canonical protected-frame/object vectors
- `conformances/10.BYTE.TRANSCRIPTS.md`: transcript-level grouping of canonical exact frame vectors

## Agent-Managed Repository

This repository is maintained primarily by autonomous agents under explicit repository rules.
That does not change the public protocol boundary: interoperable behavior is defined by the
published specs, generated SSOT, maintained conformance artifacts, and validators in this
repository, not by chat transcripts or implementation-local convention.

`README.md` stays public-facing and implementation-facing. Detailed maintenance instructions for
agent editors live in `AGENTS.md`.

## Project Files

The repository also publishes the standard project-policy files expected in an open-source
specification workspace:

- [`CONTRIBUTING.md`](CONTRIBUTING.md): contribution workflow for human and agent contributors
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md): community participation standards
- [`SECURITY.md`](SECURITY.md): security reporting guidance for protocol and tooling issues
- [`CHANGELOG.md`](CHANGELOG.md): repository-level public change log
- [`LICENSE`](LICENSE): Apache 2.0 license
- [`CODEOWNERS`](CODEOWNERS): ownership boundaries for repository paths
- [`configs/repository.json`](configs/repository.json): machine-readable maintenance contract for agent workflows
- [`.github/workflows/validate.yml`](.github/workflows/validate.yml): CI validation entrypoint

## How To Contribute

Issues and pull requests are welcome from both human contributors and agent contributors.

Good contributions include:

- clarifying normative field definitions or registries
- tightening claim boundaries or deployment guidance
- adding or improving conformance fixtures
- promoting repeated prose-only rules into SSOT or validator coverage
- improving replay, parser, or validation strictness
- adding independent implementation adapters for replay or conformance work

When contributing, use these rules:

- change authored Markdown first when protocol or corpus behavior changes
- treat the numbered root specs and `conformances/` as the normative authored source
- keep generated `specs/*` artifacts derived from the authored documents; do not hand-maintain drift
- if protocol behavior changes, update the authored spec, generated SSOT, and enforcing validator or parser in the same change
- if corpus behavior changes, update the authored conformance source, generated corpus projections, and enforcing validator in the same change
- do not silently widen public unknown-peer interoperability claims beyond the maintained `AAP Open Core` surface
- declare prerequisite context explicitly when a corpus artifact is not self-contained

## Validation Before Opening A PR

Run at least the main repository checks before submitting substantive changes:

- `npm run format`
- `npm run test:validator`
- `npm run validate`

Useful targeted commands:

- `npm run validate:protocol`
- `npm run validate:registries`
- `npm run validate:objects`
- `npm run validate:bytes`
- `npm run validate:bindings`
- `npm run validate:scenarios`
- `npm run validate:replay`

The repository expects Markdown, JSON, and `.mjs` changes to stay format-clean, lint-clean,
and consistent with generated SSOT output.

## Reading Order

1. Read `01.WIRE.FORMAT.md` for the transport-facing shape of the protocol.
2. Read `02.CONTRACT.MODEL.md` for the core cooperation model.
3. Read `03.TRUST.MODEL.md` for proof, challenge, and verification semantics.
4. Read `04.CANONICAL.OBJECTS.md` for signed-object digest stability.
5. Read `05.REFERENCE.STACK.md` for a practical implementation architecture.
6. Read `06.CRITICAL.REVIEW.md` and `conformances/README.md` for implementation scope and reference flows.

## Design Center

AAP treats agent interaction as:

- contract negotiation instead of endpoint invocation
- typed binary framing instead of human-oriented payloads
- trust and evidence as first-class protocol concerns
- long-lived session semantics instead of isolated stateless requests

Practically, `AAP` is best understood as a contract-and-trust protocol for autonomous
execution, not only as a transport or messaging format.

## Autonomous-Only Position

AAP is meaningful only if an external agent can join the protocol as both peer
and user without relying on a human operator to resolve ambiguity, bless trust,
or force closure.

This implies the spec must provide:

- machine-checkable contract authority instead of narrative intent alone
- a normative wire profile instead of implementation-local frame interpretation
- verifier independence that survives Sybil pressure and multi-vendor operation
- bounded dispute and settlement paths that terminate without manual escalation
- audit and replay objects that are portable across trust domains

## Implementation Readiness

For controlled federation inside one trust domain or between pre-configured cells, the
specification set is supporting implementation work now.

That readiness assumes:

- the secure-session profile is pinned or jointly chosen ahead of deployment
- canonical object schemas are bundled or pinned together with the implementation
- verifier bridges and open-federation quorum behavior remain disabled unless the required
  public-profile artifacts are also implemented

For open federation with unknown third-party agents, implementation should target
`AAP Open Core` exactly as documented in this repository's maintained published surface, including
the bootstrap, safe-resume, trust-policy, canonical-object, dispute-timer, and conformance
artifacts.

Public unknown-peer claims must stay scoped to the standardized mandatory frame set, canonical
objects, registries, and maintained conformance artifacts published here. Reserved extension frame
codes and any other provisional surfaces must remain disabled or be rejected deterministically
until this repository publishes their payload schemas and corpus coverage.

Practical claim boundary:

- controlled-federation implementations may ship against the current docs, SSOT, and validators
- unknown-peer public claims must stay limited to the exact mandatory surface that the repository
  publishes and validates, rather than to inferred or implementation-local behavior

This is a deliberate posture. The repository is trying to be precise about what is already
standardized and testable, while avoiding stronger interoperability claims than the maintained
specs, corpus, and validators currently justify.

Public-profile assumptions:

- the secure-session companion profile and its transcript outputs are implemented together with the
  base wire spec
- canonical object schemas are implemented exactly as published, including bootstrap acceptance,
  resume acceptance or refusal, and witness-set artifacts
- conformance is claimed only when the positive and negative corpus fixtures in `conformances/`
  reproduce the same digests, outcomes, and wire failures
- provisional extension frame codes without published payload schemas are rejected as
  `unsupportedBaseProfileSchema` rather than treated as implementation-local features
- the published byte corpus is treated as a maintained golden subset that must agree exactly where
  it exists, while the semantic corpus remains authoritative for mandatory branches whose standalone
  byte vectors are not yet published
- `AAP Open Core` standardizes verifiable accounting and fail-closed trust closure before any
  stronger economic enforcement extension is claimed

## AAP Open Core

For unknown-peer interoperability, the smallest public implementation target is
`AAP Open Core`.

`AAP Open Core` requires:

- secure bootstrap with transcript binding, replay-window continuity, and resumptions that do
  not widen replay risk
- canonical `aap-tagbin-v1` encodings for all signed or digested base-profile objects named in
  `04.CANONICAL.OBJECTS.md`
- `HELLO`, `CAPS`, `PROPOSE`, `COUNTER`, `ACCEPT`, `DECLINE`, `STATE`, `DELIVER`, `PROVE`,
  `CHALLENGE`, `REPAIR`, `CANCEL`, `SETTLE`, `CLOSE`, and `WIRE_ERROR`
- inline or verified manifest carriage for identity, capability, schema, unit, time, and
  revocation materials
- portable contract predicates through `aap-predicate-wasm32-v1`
- portable capability consumption through signed use receipts or online redemption
- portable trust closure through signed identity, domain, revocation, and finality artifacts

`AAP Open Core` does not require on day one:

- bridge-specific extension profiles beyond the base cross-cell safety rules
- vendor-specific retrieval backends for manifests
- non-base predicate runtimes
- ecosystem-specific settlement ledgers beyond canonical receipt reduction

This repository is publishing a hardened conformance surface for the standardized `AAP Open Core`
mandatory surface:

- self-contained unknown-peer bootstrap transcripts plus authenticated safe-resume transcripts with
  published dependency classes and prerequisite bootstrap context
- positive and negative semantic fixtures for wire, contract, trust, bridge, dispute, and
  finality behavior
- byte-level golden vectors plus transcript-level byte fixtures for a maintained public subset
- end-to-end normative traces covering bootstrap, negotiation, execution, proof, dispute
  handling, settlement, and close
- machine-readable claim-surface bindings in `specs/bindings.json`
- transcript dependency classes and declared prerequisite contexts in `specs/bytes.json`
- a subprocess-driven cross-implementation replay harness for the maintained public replay bundle

### AAP Open Core Claim Required Specs

- `README.md`
- `01.WIRE.FORMAT.md`
- `02.CONTRACT.MODEL.md`
- `03.TRUST.MODEL.md`
- `04.CANONICAL.OBJECTS.md`
- `05.REFERENCE.STACK.md`
- `conformances/README.md`
- `conformances/09.BYTE.CORPUS.md`
- `conformances/10.BYTE.TRANSCRIPTS.md`

### AAP Open Core Claim Required Corpus Files

- `conformances/README.md`
- `conformances/01.BOOTSTRAP.TRANSCRIPT.md`
- `conformances/02.HAPPY.PATH.md`
- `conformances/03.CHALLENGE.REPAIR.md`
- `conformances/04.SAFE.RESUME.md`
- `conformances/05.NEGOTIATION.RACES.md`
- `conformances/06.END.TO.END.TRANSCRIPTS.md`
- `conformances/07.VERIFIER.BRIDGE.md`
- `conformances/08.NEGATIVE.CASES.md`
- `conformances/09.BYTE.CORPUS.md`
- `conformances/10.BYTE.TRANSCRIPTS.md`

### AAP Open Core Claim Required Validators

- `validate:protocol`
- `validate:registries`
- `validate:objects`
- `validate:bytes`
- `validate:bindings`
- `validate:scenarios`
- `validate:replay`

### AAP Open Core Claim Required Byte Transcripts

- `bytes.transcript.bootstrap.self_contained_open_core_v1`
- `bytes.transcript.open_core.success_replay_bundle`

## Cross-Implementation Replay

This repository is validating the maintained public replay bundle through
`scripts/replay/harness.mjs`.

The harness is:

- loading transcript and vector truth from `specs/bytes.json`
- loading the public replay target set from `specs/bindings.json`
- spawning an adapter process over a JSON stdin/stdout contract
- comparing adapter-produced frame results against the published replay expectations
- comparing every published expected transcript-outcome field for each selected transcript
- failing replay validation when an adapter omits a required transcript-outcome field

Default commands:

- `npm run validate:replay`: runs the maintained `AAP Open Core` replay bundle against the default
  reference adapter
- `npm run replay:open-core`: same public replay target, useful when running the harness directly
- `npm run replay:all`: runs every published byte transcript and is intended for richer external
  adapters, not only the built-in reference adapter

Adapter model:

- the built-in adapter is `scripts/replay/reference.adapter.mjs`
- the built-in adapter is intended to satisfy the maintained public
  `AAP Open Core` replay bundle
- richer external adapters may expose additional transcript semantics beyond that bundle
- external implementations can be attached with
  `node scripts/replay/harness.mjs --adapter-command "<your command>"`
- the adapter consumes canonical frame bytes plus transcript metadata and returns frame-level replay
  results and transcript-level outcomes

## Scope

This repository is operating as a specification-first implementation in document form. It is
defining the protocol shape and runtime expectations without binding the design to a specific
vendor stack.

Today, the repository's strongest deliverable is protocol truth: authored specs, generated SSOT,
maintained conformance artifacts, and replayable validation. A production ecosystem around
`AAP` would still require SDKs, runtimes, adapters, and independent implementations, but this
repository already defines the protocol contract those implementations would need to satisfy.
