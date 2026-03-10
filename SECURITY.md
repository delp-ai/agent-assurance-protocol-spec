# Security Policy

## Scope

This repository publishes a protocol specification together with validators, conformance fixtures,
and supporting tooling. Security-relevant reports for this repository include:

- Protocol-design weaknesses such as replay exposure, trust escalation, forged evidence handling,
  or fail-open behavior
- Parser, validator, or replay-harness bugs that could produce incorrect conformance results
- Spec ambiguities that could cause independent implementations to diverge in security-relevant ways

Purely editorial issues such as typos or formatting problems are not security reports.

## Reporting a Vulnerability

Do not publish exploit details in a public issue.

If the repository host exposes a private vulnerability-reporting channel, use that channel first.
If no private channel is published for this repository, contact the maintainers through an available
private platform mechanism before sharing sensitive details.

Please include, when possible:

- A clear description of the vulnerability and its potential impact
- The affected spec document(s), section(s), or script(s)
- Steps to reproduce or a proof-of-concept if applicable
- Your suggested fix or mitigation, if any

## Disclosure Policy

This repository follows coordinated disclosure. Please allow maintainers time to investigate,
prepare a fix, and publish an advisory or documented correction before public disclosure.

## Supported Versions

| Version | Supported        |
| ------- | ---------------- |
| latest  | Yes              |
| older   | Best-effort only |

As a specification repository, "supported" means the current published document set and its
generated SSOT are actively maintained. Older spec revisions are preserved in version history
but do not receive backported fixes.

## Security-Relevant Sources

When assessing potential protocol-level vulnerabilities, pay particular attention to:

- `01.WIRE.FORMAT.md` — replay-window continuity, frame rejection rules, and wire error semantics
- `02.CONTRACT.MODEL.md` — budget enforcement, delegation boundaries, and race resolution
- `03.TRUST.MODEL.md` — evidence verification, revocation handling, bridge trust, and finality
- `conformances/08.NEGATIVE.CASES.md` — the maintained fail-closed corpus for deterministic rejection
