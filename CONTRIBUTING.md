# Contributing to Agent Assurance Protocol

Thank you for contributing to `AAP (Agent Assurance Protocol)`.
This repository accepts contributions from both human contributors and autonomous agents.
The same authored-source-first and validator-backed workflow applies to both.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).

## Good Contributions

Good contributions usually do one or more of the following:

- Clarify normative field definitions, invariants, or registries
- Tighten public claim boundaries or deployment guidance
- Add or improve conformance fixtures and transcript coverage
- Promote repeated prose-only rules into SSOT or validator coverage
- Improve parser, validator, replay, or quality tooling strictness
- Fix broken anchors, formatting, or editorial ambiguity in authored docs

## Read First

Before making non-trivial changes, read the relevant authored sources in this order:

1. [`01.WIRE.FORMAT.md`](01.WIRE.FORMAT.md)
2. [`02.CONTRACT.MODEL.md`](02.CONTRACT.MODEL.md)
3. [`03.TRUST.MODEL.md`](03.TRUST.MODEL.md)
4. [`04.CANONICAL.OBJECTS.md`](04.CANONICAL.OBJECTS.md)
5. [`conformances/README.md`](conformances/README.md)
6. [`05.REFERENCE.STACK.md`](05.REFERENCE.STACK.md)
7. [`06.CRITICAL.REVIEW.md`](06.CRITICAL.REVIEW.md)

For repository-maintenance rules and agent-editor expectations, see [`AGENTS.md`](AGENTS.md).
For the machine-readable repository workflow contract, see [`configs/repository.json`](configs/repository.json).

## Contribution Workflow

When protocol behavior changes:

1. Update the authored Markdown spec first.
2. Regenerate the affected `artifacts/*` artifact.
3. Update the enforcing parser or validator in the same change.

When corpus behavior changes:

1. Update the authored `conformances/*.md` source first.
2. Regenerate the affected derived artifact in `artifacts/`.
3. Update the enforcing validator in the same change.

In all cases:

- Treat the numbered root specs and `conformances/` as the normative authored source.
- Keep `artifacts/*` derived from authored documents. Do not hand-maintain drift.
- Do not weaken validation to make documents pass. Tighten the docs, SSOT, and checks until they agree.
- Do not silently widen unknown-peer public interoperability claims beyond the maintained `AAP Open Core` surface.
- Declare prerequisite context explicitly when a corpus artifact is not self-contained.
- Prefer Markdown tables for normative tabular data.

## Local Setup

```bash
npm install
```

Useful commands:

```bash
npm run format
npm run lint
npm run test:validator
npm run validate
```

Remote pull requests are also checked by [`.github/workflows/validate.yml`](.github/workflows/validate.yml).

Derived artifact commands:

```bash
npm run sync:protocol
npm run sync:registries
npm run sync:objects
npm run sync:bytes
npm run sync:bindings
```

Read-only staleness checks:

```bash
npm run check:protocol
npm run check:registries
npm run check:objects
npm run check:bytes
npm run check:bindings
```

## Before Opening a Pull Request

Before opening a PR for substantive changes:

1. Run `npm run format`, `npm run test:validator`, and `npm run validate`.
2. Describe which authored sources were changed and why.
3. State whether the change affects public protocol law, conformance corpus, or reference guidance.
4. Note which `artifacts/*` artifacts were regenerated, or explicitly state that none were needed.
5. If relevant, note the change class from `configs/repository.json`.
6. Link related issues, prior discussion, or affected spec sections when relevant.

## What To Avoid

- Hand-editing generated `artifacts/*` files instead of updating the authored source
- Widening `AAP Open Core` claims without matching spec, SSOT, validator, and corpus coverage
- Weakening validators to accommodate drift
- Moving parser-relevant or conformance-relevant truth into prose-only guidance
- Putting implementation-local SDK behavior into the protocol docs unless it is part of the published contract
