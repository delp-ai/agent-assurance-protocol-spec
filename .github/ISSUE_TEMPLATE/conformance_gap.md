---
name: Conformance Gap
about: Report a missing fixture, incorrect corpus artifact, or replay failure
title: "[CORPUS] "
labels: conformance, corpus
assignees: ""
---

## Affected Corpus Area

<!-- Which conformance document or fixture is affected? -->

- Document: `<!-- e.g. conformances/08.NEGATIVE.CASES.md -->`
- Fixture ID or name: `<!-- e.g. bytes.frame.wire_error.unsupported_base_profile_schema -->`

## Description

<!-- Describe the gap or failure. Include the expected outcome and actual outcome. -->

## Reproduction

<!-- Steps or command to reproduce the failure. -->

```bash
# e.g.
npm run validate:bytes
```

## Expected Behavior

<!-- What should the validator or replay harness produce? -->

## Actual Behavior

<!-- What does it currently produce? Paste relevant output. -->

## Dependency Classification

<!-- Is the affected artifact self-contained or does it depend on bootstrap context? -->

- [ ] `selfContainedByteReplay`
- [ ] `declaredBootstrapContext`
- [ ] `semanticProjectionOnly`

## Related Items

<!-- Links to related issues, PRs, or spec sections, if any. -->
