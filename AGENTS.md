# AGENTS

## Purpose

This repository should be maintained as an agent-first protocol specification workspace.
Normative protocol truth should live in structured data and executable validation, not only in prose.

## Agent Working Model

- Treat this repository as an autonomous-agent protocol workspace, not a human-approval workflow.
- Prefer machine-checkable protocol truth, generated artifacts, and executable validation over prose-only guidance.
- Keep `README.md` user-facing and implementation-facing. Put repository-maintenance guidance for
  agent editors in this file.
- When a behavior matters for third-party interoperability, prefer publishing it in the numbered
  specs, `conformances/`, generated SSOT, or validators instead of leaving it as informal narrative.

## What To Read First

When starting non-trivial work, consult the relevant authored sources before editing generated files.

Primary reading order:

1. `01.WIRE.FORMAT.md`
2. `02.CONTRACT.MODEL.md`
3. `03.TRUST.MODEL.md`
4. `04.CANONICAL.OBJECTS.md`
5. `conformances/README.md`
6. `05.REFERENCE.STACK.md`
7. `06.CRITICAL.REVIEW.md`

Use these supporting references as needed:

- `README.md`: public repository overview and implementation scope
- `configs/repository.json`: machine-readable maintenance contract for repository structure, change classes, and required checks
- `conformances/09.BYTE.CORPUS.md`: maintained protected-frame and canonical-object byte vectors
- `conformances/10.BYTE.TRANSCRIPTS.md`: transcript-level byte fixtures and replay coverage
- `package.json`: canonical maintenance and validation commands

## Where Protocol Truth Lives

- Published protocol documents in the repository root are the normative authored source.
- `artifacts/protocol.json`: generated SSOT for wire schema, canonical object schema, composite types, and workflow invariants
- `artifacts/registries.json`: generated SSOT for numeric registries and symbolic mappings
- `artifacts/objects.json`: generated SSOT for canonical object representations extracted from the docs
- `artifacts/bytes.json`: generated SSOT for maintained byte vectors and transcript fixtures
- `artifacts/bindings.json`: generated SSOT for conformance and corpus bindings

Runtime parsers and validators must load executable protocol truth from generated SSOT files, not
from duplicated handwritten tables.

Generators must derive those SSOT files from the current document set dynamically. Do not hardcode
root spec file names, numbered document names, or manual section catalogs when discovery from the
document set is possible.

## Public Claim Boundary

- Controlled-federation and pre-configured deployments are implementing against the current
  published docs, SSOT, and validators.
- Unknown-peer public interoperability claims must stay limited to the exact maintained `AAP Open Core`
  surface published in this repository.
- Do not silently widen public claims through unpublished extension frames, local registries,
  operator-only conventions, or implementation-local bootstrap assumptions.
- `05.REFERENCE.STACK.md` is not a second full protocol law document. Only its explicitly marked
  deployment-boundary, infrastructure-object, conformance-artifact, and operational-invariant
  sections are normative.

## Conformance Corpus Rules

- The conformance corpus is authoritative for the maintained artifacts it publishes, not a promise
  that every semantic branch already has a standalone byte fixture.
- Byte fixtures and semantic fixtures are complementary. Do not treat one subset as the whole protocol oracle.
- Where a scenario depends on symbolic manifest refs, trust anchors, pre-pins, bootstrap-local
  context, or scenario-derived context, that dependency must be declared explicitly.
- Use the dependency classes in `conformances/README.md` consistently:
  - `selfContainedByteReplay`
  - `declaredBootstrapContext`
  - `semanticProjectionOnly`
- Do not label an artifact self-contained if any required bootstrap, trust-policy, revocation,
  witness, or scenario-local dependency still sits outside the published fixture set.

## How To Change Normative Definitions

When changing protocol behavior, update all of the following in the same change:

1. The published spec document
2. The generated SSOT output in `artifacts/`
3. The validator or parser that enforces it

Do not weaken validation to make documents pass. Tighten the document and SSOT until they match
exactly.

When the change is corpus-specific rather than wire-schema-specific, update the same classes of
surfaces at the corpus layer:

1. The authored `conformances/*.md` source
2. The generated `artifacts/bytes.json`, `artifacts/objects.json`, or `artifacts/bindings.json` artifacts that reflect it
3. The validator logic that enforces the invariant

## Editing Workflow

Before editing:

1. Identify which authored document is the normative source for the behavior.
2. Check whether the same behavior is also represented in `artifacts/` or `scripts/validators/`.
3. Decide whether the change belongs in public protocol law, conformance corpus, or reference guidance.

While editing:

- Prefer changing authored Markdown first, then regenerating SSOT.
- Keep generated artifacts derived from the documents; do not hand-maintain drift.
- If a behavior is important enough to mention repeatedly, promote it into SSOT or validation.
- If you tighten a public claim boundary, also tighten the conformance wording that advertises it.

After editing:

1. Regenerate affected `artifacts/*` artifacts.
2. Run the relevant validators.
3. Ensure the final repository state is formatted and lint-clean.

## Spec Authoring Rules

- Prefer Markdown tables for normative field definitions, registries, and other machine-checkable content.
- Do not use fenced ASCII tables for real tabular content.
- Keep `` ```text `` blocks for structure declarations only, not for tables.
- If a structure is normative enough to drive parsing or conformance, promote it into SSOT and validator coverage.
- Prefer exact field tables over prose summaries whenever a parser or independent implementer would need the information.

## Repository Conventions

- Preserve uppercase document names.
- Keep numbered reading-order prefixes for ordered documents such as `01.*`, `02.*`, `03.*`.
- Keep corpus entry documents as `README.md` when they are the root document of a directory.
- Prefer plural structural directory names such as `artifacts/`, `configs/`, and `conformances/`.
- Prefer short file names without dashes; if a multi-part name is needed, prefer `.` over `-`.
- When renaming or moving files or directories, use filesystem moves such as `mv`, not rewrite-and-delete flows.

## Machine-Readable Maintenance Contract

- `configs/repository.json` is the repository-maintenance contract for agents.
- Use it to identify change classes, expected co-update surfaces, and required validation commands.
- Keep it aligned with `AGENTS.md`, `CONTRIBUTING.md`, and the active CI workflow when repository operations change.
- Do not move protocol-law truth into `configs/repository.json`; it is for repository operations, not protocol semantics.

## Current Hardening Baseline

- Optional header sections are fully promoted into field tables.
- Header-section structural rules are living in `artifacts/protocol.json` under
  `wire.headerSectionPolicies`.
- Handshake, negotiation, session-resumption, bridge, finality, and cross-document transition
  invariants are living in `artifacts/protocol.json` under `workflow`.
- `artifacts/*` artifacts are being regenerated from scanned protocol documents rather than maintained
  by hand.
- `artifacts/bindings.json` is projecting the maintained `AAP Open Core` claim surface and required
  artifact set from authored documentation.
- `artifacts/bytes.json` is carrying transcript dependency classes and declared prerequisite contexts
  for maintained byte transcripts.
- `scripts/replay/harness.mjs` is driving subprocess-based replay checks against the maintained
  public transcript set declared in `artifacts/bindings.json`.
- `scripts/core/protocol.mjs` is resolving protocol sections through generic document queries and
  projection plans rather than fixed document-location maps.
- `scripts/core/objects.mjs` and `scripts/artifacts/objects.mjs` are deriving canonical object truth
  from the published document set.
- `scripts/core/fixtures.mjs` and `scripts/artifacts/bytes.mjs` are deriving byte-vector and transcript
  truth from the maintained corpus docs.
- Header-section parsing and policy enforcement are living in `scripts/core/parser.mjs`.
- `scripts/validators/protocol.mjs` is regenerating protocol state from the documents and comparing that
  regenerated state against `artifacts/protocol.json`.
- `scripts/validators/objects.mjs` is validating canonical object vectors and object-schema usage,
  including list-ordering semantics derived from normative field-table notes.
- `scripts/validators/bytes.mjs` is validating maintained frame/object bytes, transcript fixtures,
  dependency classes, and machine-readable transcript prerequisites.
- Scenario-level enforcement for handshake, resume, transition-sequence, bridge-binding, and
  close/finality invariants is living in `scripts/validators/scenarios.mjs`.
- `scripts/tests/validator.mjs` is running mutation-based strictness checks to ensure protocol and
  corpus edits are rejected when they drift from schema or registry truth.
- Parsers and validators should continue to consume SSOT, not drift back to local hardcoded truth.

## Formatting And Validation

Primary commands:

- `npm run format`
- `npm run lint`
- `npm run test:validator`
- `npm run validate`

Useful targeted commands:

- `npm run validate:ssot`
- `npm run validate:anchors`
- `npm run validate:protocol`
- `npm run validate:registries`
- `npm run validate:objects`
- `npm run validate:bytes`
- `npm run validate:bindings`
- `npm run validate:scenarios`
- `npm run validate:replay`
- `npm run replay:open-core`
- `npm run replay:all`
- `npm run sync:protocol`
- `npm run sync:registries`
- `npm run sync:objects`
- `npm run sync:bytes`
- `npm run sync:bindings`
- `npm run check:protocol` (read-only variant of `sync:protocol`; exits non-zero if SSOT is stale)
- `npm run check:registries`
- `npm run check:objects`
- `npm run check:bytes`
- `npm run check:bindings`

Important quality files:

- `dprint.json`
- `configs/.markdownlint.json`
- `scripts/quality/format.mjs`
- `scripts/quality/lint.mjs`

Current tooling expectations:

- `dprint` formats Markdown, JSON, and `.mjs`
- `markdownlint-cli2` enforces Markdown policy
- `.mjs` is already covered by the main format and lint flow; do not split it into separate quality commands unless there is a real gap
- Save-time editor behavior should follow the same repository quality path: use `dprint` as the formatter and
  apply Markdown lint fixes against `configs/.markdownlint.json`

After substantive spec, SSOT, parser, or validator changes, run at least:

1. `npm run format`
2. `npm run test:validator`
3. `npm run validate`

When changing formatting or linting behavior:

1. Update the repository config such as `dprint.json` or `configs/.markdownlint.json`
2. Keep `scripts/quality/format.mjs` and `scripts/quality/lint.mjs` aligned with that config
3. Do not introduce side paths where editor save behavior, `npm run format`, and `npm run lint` disagree

## Key Validator Surfaces

- `scripts/validators/protocol.mjs`: regenerate protocol state from docs and compare it against `artifacts/protocol.json`
- `scripts/validators/registries.mjs`: exact-match published registries against `artifacts/registries.json`
- `scripts/validators/objects.mjs`: validate canonical object vectors and object-schema consistency
- `scripts/validators/bindings.mjs`: validate corpus and binding references
- `scripts/validators/scenarios.mjs`: scenario-level expectations
- `scripts/validators/bytes.mjs`: byte corpus and transcript validation
- `scripts/validators/anchors.mjs`: validate that all cross-document Markdown anchor references resolve
- `scripts/replay/harness.mjs`: subprocess replay harness for claim-surface transcript bundles
- `scripts/tests/validator.mjs`: mutation regression for validator strictness against spec and corpus drift
- `scripts/core/parser.mjs`: runtime parsing and structural rule enforcement

## High-Value References For Agents

- `01.WIRE.FORMAT.md`: handshake order, frame schemas, optional section rules, and wire errors
- `02.CONTRACT.MODEL.md`: contract states, race rules, budgets, dispute and settlement semantics
- `03.TRUST.MODEL.md`: trust-domain, revocation, bridge, witness, and finality semantics
- `04.CANONICAL.OBJECTS.md`: canonical field tables for signed and digested non-frame objects
- `conformances/README.md`: corpus scope, dependency classification, and public conformance boundary
- `conformances/09.BYTE.CORPUS.md`: exact vector definitions and replay-bundle coverage
- `conformances/10.BYTE.TRANSCRIPTS.md`: transcript-level byte fixtures, prerequisites, and outcome expectations
- `06.CRITICAL.REVIEW.md`: current readiness posture, claim boundary, and remaining implementation risks
