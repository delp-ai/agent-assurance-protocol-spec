# AAP Conformance Corpus

This workspace is publishing the maintained conformance corpus for the revised `AAP` base profile.

The purpose of this corpus is to give third-party agent implementers a shared set of
deterministic traces, protected-frame byte fixtures, and canonical object expectations for
unknown-peer `AAP Open Core` interoperability.

These artifacts are written from a purely agent-native standpoint:

- every participant is an autonomous agent
- every decision point is machine-checkable
- no step relies on human interpretation, approval, or repair

## Included Artifacts

- `01.BOOTSTRAP.TRANSCRIPT.md`
  - canonical unknown-peer join
  - bootstrap `Version=0.0` handshake
  - manifest and profile resolution
  - negotiated production version activation

- `02.HAPPY.PATH.md`
  - canonical contract proposal to close
  - acceptance, execution, delivery, proof, completion, settlement, and close
  - witness-backed finality path

- `03.CHALLENGE.REPAIR.md`
  - bounded dispute against a proved result
  - signed repair
  - resumable state return
  - successful close after dispute resolution

- `04.SAFE.RESUME.md`
  - safe session resumption under preserved replay continuity
  - deterministic refusal when replay lineage cannot be restored
  - deterministic refusal or degraded recovery when version-family compatibility is lost

- `05.NEGOTIATION.RACES.md`
  - `COUNTER`, `DECLINE`, `CANCEL`, and revision-supersession coverage
  - duplicate, reorder, timeout, and post-close race outcomes
  - independence and conflicting-finality negative coverage

- `06.END.TO.END.TRANSCRIPTS.md`
  - bootstrap-to-close composed success lineage
  - bootstrap-to-close fail-closed timeout lineage

- `07.VERIFIER.BRIDGE.md`
  - bridge-mediated resolution of `inconclusive` verification
  - deterministic timeout and policy-block outcomes

- `08.NEGATIVE.CASES.md`
  - malformed bootstrap and negotiation failures
  - replay-lineage divergence
  - contract identity mismatch
  - blocked close and stale trust/finality failures
  - invalid no-op repair behavior
  - contract-traffic rejection while bootstrap remains `diagnosticOnly`

- `09.BYTE.CORPUS.md`
  - byte-level corpus format
  - self-contained unknown-peer bootstrap frame vectors
  - canonical frame bytes for representative contract and wire-error paths
  - canonical object bytes for maintained signed non-frame artifacts, including bootstrap and
    finality dependencies

- `10.BYTE.TRANSCRIPTS.md`
  - transcript-level grouping of exact frame vectors
  - self-contained unknown-peer bootstrap transcript and post-bootstrap proposal admissions
  - multi-frame negative rejections with deterministic `WIRE_ERROR`
  - resume-oriented transcript groupings and terminal contract slices
  - declared dependency classes and prerequisite contexts for non-self-contained maintained replay
    units

## Mapping To The Main Specs

- `01.WIRE.FORMAT.md`
  - handshake order
  - bootstrap-version semantics
  - contract-bound header consistency
  - session-lineage replay handling

- `02.CONTRACT.MODEL.md`
  - portable contract identity
  - authority graph binding
  - explicit completion through `STATE phase=completed`
  - bounded challengeability and deterministic close

- `03.TRUST.MODEL.md`
  - portable identity and revocation artifacts
  - signed challenge and repair objects
  - verification and finality evidence
  - receipt trust assumptions

- `05.REFERENCE.STACK.md`
  - required conformance deliverables
  - end-to-end reference transcript requirement
- `04.CANONICAL.OBJECTS.md`
  - canonical field tags for signed or digested non-frame objects
  - digest-stability rules for public interoperability

## Trace Projection Rule

The semantic conformance traces in this directory are schema-aware projections, not duplicate
copies of every canonical object table.

Rules:

- any object or frame body shown under the semantic transcript files may omit fields only when the
  snippet is explicitly illustrative and the omitted fields are not required to validate the
  scenario; required artifacts, digest-bearing objects, and frame bodies that drive acceptance or
  rejection outcomes must still remain schema-faithful
- projected examples must not rename fields, change their meanings, or contradict the normative
  schemas
- semantic transcript projections may render enum values as symbolic registry labels, render
  signatures as symbolic signer identifiers, render manifest refs as named shorthands, and render
  inline payload carriage as `embedded(...)` placeholders; exact byte layouts and canonical field
  encodings remain authoritative only in `09.BYTE.CORPUS.md`, `10.BYTE.TRANSCRIPTS.md`, and
  `04.CANONICAL.OBJECTS.md`
- when exact field completeness or byte layout matters, `01.WIRE.FORMAT.md`,
  `04.CANONICAL.OBJECTS.md`, `09.BYTE.CORPUS.md`, and `10.BYTE.TRANSCRIPTS.md` are
  authoritative
- any projected example that carries a digest must still be reducible to one schema-valid
  canonical object or frame body under the normative specs

## Corpus Promotion Rule

These files are the maintained gating corpus for the currently published unknown-peer
`AAP Open Core` protected-frame and canonical-object surface.

Required coverage provided by this corpus:

- canonical protected frame bytes under the shared conformance protection convention
- self-contained unknown-peer bootstrap companion-profile fixtures bound to canonical transcript
  digests and published bootstrap objects
- safe-resume fixtures bound to canonical resume-acceptance or refusal objects
- deterministic negotiation and revision-supersession outcomes
- deterministic degraded-bootstrap admission boundaries, including `diagnosticOnly`
- deterministic duplicate, reorder, timeout, finality, and post-close outcomes
- composed end-to-end lineages from bootstrap through terminal close
- parse expectations and transcript-level semantic outcomes
- positive and negative wire outcomes
- canonical digests derived by a shared reference encoder
- canonical object forms for signed or digested artifacts referenced by the positive and negative
  traces

Coverage boundary:

- this corpus is authoritative for the maintained artifacts published in this directory, not a claim
  that every mandatory semantic branch already has its own standalone byte vector or fully
  self-contained transcript
- where a scenario uses symbolic manifest refs, trust anchors, or scenario-local derived context,
  the artifact must still declare that dependency explicitly and independent implementations must not
  invent additional hidden prerequisites

## Dependency Classification

Maintained artifacts that claim replay or interoperability significance should declare one of the
following dependency classes whenever the artifact itself does not already make the scope obvious:

- `selfContainedByteReplay`: the published artifact contains every maintained byte-level frame and
  canonical-object dependency required for replay within the current corpus revision
- `declaredBootstrapContext`: the published artifact is byte-exact for the protected material it
  names, but still depends on explicitly declared bootstrap-local, inline, or pre-pinned context
- `semanticProjectionOnly`: the published artifact is authoritative for semantic outcomes only and is
  not, by itself, a complete byte replay unit

Classification rule:

- an artifact must not call itself self-contained when any required manifest, trust-policy,
  revocation, witness, or scenario-local dependency remains outside the published vector set
- artifacts in `09.BYTE.CORPUS.md` or `10.BYTE.TRANSCRIPTS.md` that are not self-contained should
  declare the prerequisite contexts they rely on explicitly
- declared prerequisite contexts are part of the public claim surface for that artifact; an
  implementation must not invent additional hidden bootstrap inputs to make the artifact pass
- maintained transcript metadata is projecting into `specs/bytes.json`, so downstream validators and
  replay tools are consuming the same declared scope machine-readably
- the maintained public replay target set is projecting into `specs/bindings.json`, and
  `scripts/replay/harness.mjs` is consuming that target set through an adapter-process boundary

Gating rule:

- an implementation must not claim unknown-peer public `AAP Open Core` interoperability unless it
  reproduces the required outcomes of every published maintained corpus artifact without human
  interpretation
- controlled-federation deployments may implement a narrower pinned subset, but they must surface
  that restriction as a deployment profile and must not present it as public unknown-peer coverage
- reserved extension frame codes that do not yet publish payload schemas in the main specs are out
  of the current public claim surface and must be rejected as `unsupportedBaseProfileSchema`
  unless a later repository revision standardizes them
- every digest referenced by a required validation rule in one conformance file must resolve to a
  published canonical object, vector, transcript, byte-corpus alias binding, or an explicitly
  named trust-anchor, manifest-registry, replay-window binding, or scenario-local derived context
  that the scenario declares as pre-pinned, bootstrap-local, or deterministically derived
- byte-level vectors and semantic fixtures are complementary; passing one subset is insufficient
