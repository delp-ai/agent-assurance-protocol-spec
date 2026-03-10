import {
  extractFencedBlocks,
  extractFrameBlocks,
  isMainModule,
  listMarkdownFiles,
  loadJson,
  parseColonFields,
  readText,
  requireNoProblems,
} from '../core/common.mjs';
import { extractObjectBlocks } from '../core/objects.mjs';

const protocolSpec = loadJson('specs/protocol.json');

function collectScenarioFrames(file) {
  const content = readText(file);
  return extractFrameBlocks(content).map((block) => {
    const fields = parseColonFields(block);
    return {
      block,
      frameType: fields.get('FrameType'),
      streamId: fields.get('StreamId'),
      messageId: fields.get('MessageId'),
      version: fields.get('Version'),
      peerAgentId: fields.get('peerAgentId'),
      bootstrapTranscriptDigest: fields.get('bootstrapTranscriptDigest'),
      trustPolicyDigest: fields.get('trustPolicyDigest'),
      acceptedTrustPolicyDigest: fields.get('acceptedTrustPolicyDigest'),
      degradedBootstrapMode: fields.get('degradedBootstrapMode'),
      capabilitySetDigest: fields.get('capabilitySetDigest'),
      supportedExtensions: fields.get('supportedExtensions'),
      chosenProfiles: fields.get('chosenProfiles'),
      offeredCriticalExtensions: fields.get('offeredCriticalExtensions'),
      acceptedCriticalExtensions: fields.get('acceptedCriticalExtensions'),
      chosenMajor: fields.get('chosenMajor'),
      chosenMinor: fields.get('chosenMinor'),
      finalityCandidateDigest: fields.get('finalityCandidateDigest'),
      finalityDigest: fields.get('finalityDigest'),
      closeTraceDigest: fields.get('closeTraceDigest'),
      contractId: fields.get('contractId'),
      contractRevision: fields.get('contractRevision'),
      finalSequence: fields.get('finalSequence'),
      contractPhase: fields.get('contractPhase'),
      phase: fields.get('phase'),
      closeScope: fields.get('closeScope'),
      closeReasonCode: fields.get('closeReasonCode'),
      stateCauseCode: fields.get('stateCauseCode'),
      settlementOutcome: fields.get('settlementOutcome'),
    };
  });
}

function listScenarioFiles() {
  return listMarkdownFiles().filter(
    (file) =>
      file.startsWith('conformances/')
      && file !== 'conformances/README.md'
      && file !== 'conformances/09.BYTE.CORPUS.md'
      && file !== 'conformances/10.BYTE.TRANSCRIPTS.md',
  );
}

function collectTypedObjects(file, typeName) {
  return extractObjectBlocks(readText(file), file)
    .filter((block) => block.typeName === typeName)
    .map((block) => ({
      block: block.scalarFields.map((field) => `  ${field.name}: ${field.value}`).join('\n'),
      fields: new Map(Object.entries(block.fieldMap)),
    }));
}

function collectCaseSections(file) {
  const content = readText(file);
  const headingPattern = /^##\s+(.+)$/gm;
  const matches = [...content.matchAll(headingPattern)];
  const sections = new Map();

  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index ?? 0;
    const end = matches[index + 1]?.index ?? content.length;
    const body = content.slice(start, end);
    const caseIdMatch = body.match(/Case id:\s*\n\s*\n-\s+`([^`]+)`/m);
    if (caseIdMatch) {
      sections.set(caseIdMatch[1], body);
    }
  }

  return sections;
}

function requireSingleObject(file, typeName, problems) {
  const objects = collectTypedObjects(file, typeName);
  if (objects.length !== 1) {
    problems.push(`${file}: expected exactly one '${typeName}' block but found ${objects.length}`);
    return null;
  }
  return objects[0];
}

function findObject(file, typeName, predicate, problems, label) {
  const objects = collectTypedObjects(file, typeName);
  const matches = objects.filter((object) => predicate(object.fields));
  if (matches.length !== 1) {
    problems.push(
      `${file}: expected exactly one '${label ?? typeName}' block but found ${matches.length}`,
    );
    return null;
  }
  return matches[0];
}

function handshakeFieldValue(item, fieldName) {
  if (
    fieldName === 'degradedBootstrapMode'
    && protocolSpec.workflow.handshakeProfile?.normalBootstrapModeValue
  ) {
    return item[fieldName] ?? protocolSpec.workflow.handshakeProfile.normalBootstrapModeValue;
  }
  return item[fieldName];
}

function parseListValue(rawValue) {
  if (!rawValue) {
    return [];
  }
  return rawValue
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeStateToken(value) {
  return value.replace(/[`]/g, '').replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
}

function splitStateExpression(expression) {
  return expression
    .replace(/prior resumable state/gi, 'priorResumableState')
    .split(/\s*,\s*|\s+or\s+/)
    .map((token) =>
      token
        .replace(/priorResumableState/g, 'prior resumable state')
        .replace(/^(?:or|and)\s+/i, '')
        .trim()
    )
    .filter(Boolean);
}

function stateExpressionMatches(expression, state) {
  const normalizedState = normalizeStateToken(state);
  return splitStateExpression(expression).some((token) => {
    const normalizedToken = normalizeStateToken(token);
    if (normalizedToken === 'priorresumablestate') {
      return ['executing', 'delivering', 'proved'].includes(normalizedState);
    }
    return normalizedToken === normalizedState;
  });
}

function deriveTransitionEvent(frame) {
  if (frame.frameType !== 'STATE') {
    return frame.frameType;
  }
  if (
    ['ready', 'executing', 'completed', 'partiallyCompleted', 'failed', 'rollingBack']
      .includes(frame.phase)
  ) {
    return `STATE with phase=${frame.phase}`;
  }
  return 'resolving STATE';
}

function collectExpectedTransitions(file) {
  const content = readText(file);
  const transitions = [];
  const pattern =
    /```text\n(Frame \{[\s\S]*?\})\n```\n\nExpected state:\n\n- `([^`]+?) -> ([^`]+?)`/gm;

  for (const match of content.matchAll(pattern)) {
    const frameBlock = match[1];
    const fields = parseColonFields(frameBlock);
    transitions.push({
      frameType: fields.get('FrameType'),
      phase: fields.get('phase'),
      contractPhase: fields.get('contractPhase'),
      currentState: match[2].trim(),
      nextState: match[3].trim(),
    });
  }

  return transitions;
}

function validateExpectedTransitions(file, problems) {
  const expectedTransitions = collectExpectedTransitions(file);
  const rules = protocolSpec.workflow.stateTransitionTable;

  for (const transition of expectedTransitions) {
    const event = deriveTransitionEvent(transition);
    const matchingRule = rules.find(
      ([currentState, initiatingFrame, , nextState]) =>
        initiatingFrame === event
        && stateExpressionMatches(currentState, transition.currentState)
        && stateExpressionMatches(nextState, transition.nextState),
    );

    if (!matchingRule) {
      problems.push(
        `${file}: expected transition '${transition.currentState} -> ${transition.nextState}' for ${transition.frameType} does not match the normative transition table`,
      );
    }

    if (
      transition.contractPhase
      && normalizeStateToken(transition.contractPhase) !== normalizeStateToken(transition.nextState)
    ) {
      problems.push(
        `${file}: ${transition.frameType} contractPhase '${transition.contractPhase}' does not match expected next state '${transition.nextState}'`,
      );
    }
  }
}

function validateFrameTargetPhases(file, frames, problems) {
  const expectedTargets = {
    PROPOSE: 'proposed',
    COUNTER: 'countered',
    ACCEPT: 'accepted',
    DECLINE: 'declined',
    DELIVER: 'delivering',
    PROVE: 'proved',
    CHALLENGE: 'challenged',
    REPAIR: 'challenged',
    CANCEL: 'cancelled',
    SETTLE: 'settling',
    CLOSE: 'closed',
  };

  for (const frame of frames) {
    const expectedContractPhase = expectedTargets[frame.frameType];
    if (
      expectedContractPhase
      && frame.contractPhase
      && frame.contractPhase !== expectedContractPhase
    ) {
      problems.push(
        `${file}: ${frame.frameType} frame contractPhase '${frame.contractPhase}' should be '${expectedContractPhase}' after acceptance`,
      );
    }
    if (frame.frameType === 'CLOSE') {
      if (frame.closeScope !== 'contract') {
        problems.push(`${file}: contract CLOSE frame must use closeScope 'contract'`);
      }
      if (frame.streamId === '0') {
        problems.push(`${file}: contract CLOSE frame must not use session-close stream 0`);
      }
    }
  }
}

function validateRequiredTerminalFrames(file, frames, problems) {
  const requiredSequences = extractFencedBlocks(readText(file))
    .map((block) => parseColonFields(block.body))
    .map((fields) => fields.get('requiredTerminalFrames'))
    .filter(Boolean);

  for (const rawSequence of requiredSequences) {
    const sequence = rawSequence
      .replace(/^\[/, '')
      .replace(/\]$/, '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (sequence.length === 0) {
      continue;
    }

    let cursor = 0;
    for (const frame of frames) {
      if (frame.frameType === sequence[cursor]) {
        cursor += 1;
      }
      if (cursor === sequence.length) {
        break;
      }
    }

    if (cursor !== sequence.length) {
      problems.push(
        `${file}: required terminal frame sequence '${
          sequence.join(' -> ')
        }' does not appear in order`,
      );
    }
  }
}

function validateLateEvidencePolicy(file, problems) {
  const objects = extractFencedBlocks(readText(file))
    .map((block) => parseColonFields(block.body))
    .filter((fields) =>
      fields.has('lateEvidenceDisposition')
      || fields.has('blockedCloseOutcomeApplied')
      || fields.has('reopenPermitted')
    );

  for (const fields of objects) {
    if (fields.has('blockedCloseOutcomeApplied')) {
      if (fields.get('lateEvidenceDisposition') !== 'retainForAuditOnly') {
        problems.push(
          `${file}: blocked-close artifact must set lateEvidenceDisposition to 'retainForAuditOnly'`,
        );
      }
      if (!fields.get('closeReasonCode')) {
        problems.push(`${file}: blocked-close artifact is missing closeReasonCode`);
      }
    }

    if (
      fields.has('reopenPermitted')
      && fields.get('lateEvidenceDisposition') === 'retainForAuditOnly'
      && fields.get('reopenPermitted') !== 'false'
    ) {
      problems.push(
        `${file}: lateEvidenceDisposition 'retainForAuditOnly' must pair with reopenPermitted false`,
      );
    }
  }
}

function validateHandshakeConvergence(file, problems) {
  const frames = collectScenarioFrames(file);
  const profile = protocolSpec.workflow.handshakeProfile;
  const negotiationTypes = new Set(profile.negotiationFrameOrder);
  const negotiationFrames = frames.filter((frame) => negotiationTypes.has(frame.frameType))
    .slice(0, profile.negotiationFrameOrder.length);
  if (negotiationFrames.length < profile.negotiationFrameOrder.length) {
    return;
  }

  const expectedOrder = profile.negotiationFrameOrder;
  const expectedStreams = profile.negotiationFrameStreams;
  const bootstrapVersion = profile.bootstrapVersion;

  const actualOrder = negotiationFrames.map((frame) => frame.frameType);
  if (JSON.stringify(actualOrder) !== JSON.stringify(expectedOrder)) {
    problems.push(
      `${file}: handshake order mismatch, expected ${expectedOrder.join(' -> ')} but found ${
        actualOrder.join(' -> ')
      }`,
    );
  }

  for (const [index, frame] of negotiationFrames.entries()) {
    if (frame.version !== bootstrapVersion) {
      problems.push(
        `${file}: ${frame.frameType} frame ${frame.streamId}:${frame.messageId} uses Version ${frame.version} instead of ${bootstrapVersion}`,
      );
    }
    if (frame.streamId !== expectedStreams[index]) {
      problems.push(
        `${file}: ${frame.frameType} frame ${frame.streamId}:${frame.messageId} uses stream ${frame.streamId} instead of ${
          expectedStreams[index]
        }`,
      );
    }
  }

  const helloFrames = negotiationFrames.filter((frame) => frame.frameType === 'HELLO');
  const capsFrames = negotiationFrames.filter((frame) => frame.frameType === 'CAPS');

  for (const fieldName of profile.helloConvergenceFields) {
    const values = helloFrames.map((frame) => handshakeFieldValue(frame, fieldName));
    if (values.length === 0 || !values.every((value) => value === values[0])) {
      problems.push(`${file}: HELLO frames do not converge on '${fieldName}'`);
    }
  }

  for (const fieldName of profile.capsConvergenceFields) {
    const values = capsFrames.map((frame) => handshakeFieldValue(frame, fieldName));
    if (values.length === 0 || !values.every((value) => value === values[0])) {
      problems.push(`${file}: CAPS frames do not converge on '${fieldName}'`);
    }
  }

  if (
    helloFrames.length === 2
    && capsFrames.length === 2
    && helloFrames[0][profile.policyBindingSourceField]
      !== capsFrames[0][profile.policyBindingTargetField]
  ) {
    problems.push(
      `${file}: HELLO ${profile.policyBindingSourceField} does not match CAPS ${profile.policyBindingTargetField}`,
    );
  }

  if (profile.forbidContractBoundTrafficBeforeCaps) {
    const handshakeCompletionIndex = frames.findIndex((frame, index) => {
      const seen = frames.slice(0, index + 1).filter((candidate) =>
        negotiationTypes.has(candidate.frameType)
      );
      return seen.length >= profile.negotiationFrameOrder.length
        && seen.filter((candidate) => candidate.frameType === 'HELLO').length >= 2
        && seen.filter((candidate) => candidate.frameType === 'CAPS').length >= 2;
    });
    const preHandshakeFrames = handshakeCompletionIndex === -1
      ? frames
      : frames.slice(0, handshakeCompletionIndex);
    for (const frame of preHandshakeFrames) {
      if (!negotiationTypes.has(frame.frameType) && frame.block.includes('ContractRef {')) {
        problems.push(`${file}: contract-bound traffic appears before handshake completion`);
        break;
      }
    }
  }
}

function validateCriticalExtensionNegotiation(file, problems) {
  const capsFrames = collectScenarioFrames(file).filter((frame) => frame.frameType === 'CAPS');
  if (capsFrames.length === 2) {
    const leftOffered = new Set(parseListValue(capsFrames[0].offeredCriticalExtensions));
    const rightOffered = new Set(parseListValue(capsFrames[1].offeredCriticalExtensions));
    const expectedIntersection = [...leftOffered].filter((tag) => rightOffered.has(tag)).sort();
    const leftAccepted = parseListValue(capsFrames[0].acceptedCriticalExtensions).sort();
    const rightAccepted = parseListValue(capsFrames[1].acceptedCriticalExtensions).sort();
    if (JSON.stringify(leftAccepted) !== JSON.stringify(expectedIntersection)) {
      problems.push(
        `${file}: first CAPS acceptedCriticalExtensions does not match the offered critical-extension intersection`,
      );
    }
    if (JSON.stringify(rightAccepted) !== JSON.stringify(expectedIntersection)) {
      problems.push(
        `${file}: second CAPS acceptedCriticalExtensions does not match the offered critical-extension intersection`,
      );
    }
  }
  for (const frame of capsFrames) {
    const supported = new Set(parseListValue(frame.supportedExtensions));
    const offered = parseListValue(frame.offeredCriticalExtensions);
    const accepted = parseListValue(frame.acceptedCriticalExtensions);
    for (const tag of offered) {
      if (!supported.has(tag)) {
        problems.push(
          `${file}: CAPS offeredCriticalExtensions tag '${tag}' is not present in supportedExtensions`,
        );
      }
    }
    const offeredSet = new Set(offered);
    for (const tag of accepted) {
      if (!offeredSet.has(tag)) {
        problems.push(
          `${file}: CAPS acceptedCriticalExtensions tag '${tag}' is not present in offeredCriticalExtensions`,
        );
      }
    }
  }
}

function validateResumeConvergence(file, problems) {
  validateHandshakeConvergence(file, problems);
  const profile = protocolSpec.workflow.resumeProfile;
  const handshakeProfile = protocolSpec.workflow.handshakeProfile;

  const resumeAcceptance = requireSingleObject(file, profile.resumeAcceptanceType, problems);
  if (!resumeAcceptance) {
    return;
  }

  const capsFrames = collectScenarioFrames(file).filter((frame) => frame.frameType === 'CAPS');
  const expectedPolicyDigest = resumeAcceptance.fields.get(profile.resumeAcceptancePolicyField);
  if (!capsFrames.every((frame) => frame.acceptedTrustPolicyDigest === expectedPolicyDigest)) {
    problems.push(`${file}: resumed CAPS frames do not match ResumeAcceptance policy digest`);
  }
  const expectedMode = resumeAcceptance.fields.get(handshakeProfile.resumeAcceptanceModeField)
    ?? handshakeProfile.normalBootstrapModeValue;
  if (
    !capsFrames.every((frame) =>
      (frame.degradedBootstrapMode ?? handshakeProfile.normalBootstrapModeValue) === expectedMode
    )
  ) {
    problems.push(
      `${file}: resumed CAPS frames do not match ResumeAcceptance degraded bootstrap mode`,
    );
  }

  const priorLineage = resumeAcceptance.fields.get(profile.resumeAcceptanceLineageField);
  if (!priorLineage) {
    problems.push(`${file}: ResumeAcceptance is missing prior session lineage`);
  }

  const newSessionId = resumeAcceptance.fields.get(profile.resumeAcceptanceSessionField);
  if (!newSessionId) {
    problems.push(`${file}: ResumeAcceptance is missing new session id`);
  }
}

function validateResumeRefusal(file, problems) {
  const profile = protocolSpec.workflow.resumeProfile;
  const resumeRefusals = collectTypedObjects(file, profile.resumeRefusalType);
  if (resumeRefusals.length === 0) {
    return;
  }

  for (const resumeRefusal of resumeRefusals) {
    if (!resumeRefusal.fields.get(profile.resumeRefusalLineageField)) {
      problems.push(`${file}: ResumeRefusal is missing prior session lineage`);
    }
    if (!resumeRefusal.fields.get(profile.resumeRefusalActionField)) {
      problems.push(
        `${file}: ResumeRefusal is missing resulting action`,
      );
    }
  }
  const frames = collectScenarioFrames(file);
  const wireErrors = frames.filter((frame) => frame.frameType === 'WIRE_ERROR');
  if (wireErrors.length === 0) {
    problems.push(`${file}: refused resume scenario must emit a terminal WIRE_ERROR`);
  } else if (!wireErrors.every((frame) => frame.block.includes('errorCode: negotiationMismatch'))) {
    problems.push(`${file}: refused resume scenario must surface negotiationMismatch on wire`);
  }
}

function validateCloseFinalityBinding(file, problems) {
  const frames = collectScenarioFrames(file);
  const profile = protocolSpec.workflow.closeBindingProfile;
  const settleFrame = frames.find((frame) => frame.frameType === profile.settleFrameType);
  const closeFrame = frames.find((frame) => frame.frameType === profile.closeFrameType);
  if (!settleFrame || !closeFrame) {
    return;
  }

  const settleDigest = settleFrame[profile.settleFinalityField];
  const closePayloadDigest = closeFrame[profile.closePayloadFinalityField];

  const closeSectionMatch = closeFrame.block.match(
    new RegExp(
      `${profile.closeSectionType} \\{[\\s\\S]*?${profile.closeSectionDigestField}:\\s+([^\\n]+)\\n`,
    ),
  );
  const closeSectionDigest = closeSectionMatch?.[1]?.trim() ?? null;

  if (!settleDigest || !closePayloadDigest || !closeSectionDigest) {
    return;
  }

  if (!(settleDigest === closePayloadDigest && closePayloadDigest === closeSectionDigest)) {
    problems.push(`${file}: SETTLE and CLOSE do not bind to the same finality digest`);
  }

  if (!closeFrame[profile.closeTraceField]) {
    problems.push(`${file}: CLOSE frame is missing ${profile.closeTraceField}`);
  }
}

function validateCloseScopeShape(file, frames, problems) {
  const profile = protocolSpec.workflow.closeScopeValidationProfile;
  if (!profile) {
    return;
  }

  for (const frame of frames.filter((candidate) => candidate.frameType === 'CLOSE')) {
    const scope = frame.closeScope;
    if (!scope) {
      problems.push(`${file}: CLOSE frame is missing closeScope`);
      continue;
    }
    const scopeKey = scope === 'session' || scope === 'contract' || scope === 'diagnostic'
      ? scope
      : null;
    if (!scopeKey) {
      problems.push(`${file}: CLOSE frame uses unknown closeScope '${scope}'`);
      continue;
    }

    for (const fieldName of profile[`${scopeKey}RequiredFields`] ?? []) {
      if (!frame[fieldName]) {
        problems.push(
          `${file}: CLOSE frame closeScope '${scope}' is missing required field '${fieldName}'`,
        );
      }
    }
    for (const fieldName of profile[`${scopeKey}ForbiddenFields`] ?? []) {
      if (frame[fieldName]) {
        problems.push(
          `${file}: CLOSE frame closeScope '${scope}' must not carry field '${fieldName}'`,
        );
      }
    }

    const hasFinalityContext = frame.block.includes(
      `${protocolSpec.workflow.closeBindingProfile.closeSectionType} {`,
    );
    const requiresFinalityContext = profile[`${scopeKey}RequiresFinalityContext`] === true;
    if (requiresFinalityContext && !hasFinalityContext) {
      problems.push(`${file}: CLOSE frame closeScope '${scope}' requires FinalityContext`);
    }
    if (!requiresFinalityContext && hasFinalityContext) {
      problems.push(`${file}: CLOSE frame closeScope '${scope}' must not carry FinalityContext`);
    }
  }
}

function validateBridgeSubmissionBinding(file, problems) {
  const profile = protocolSpec.workflow.bridgeBindingProfile;
  const submissions = collectTypedObjects(file, profile.submissionType).map((object) =>
    object.fields
  );
  const verificationRecords = collectTypedObjects(file, profile.verificationType)
    .map((object) => object.fields)
    .filter((fields) => fields.get('verificationMethod') === profile.verificationMethod);

  if (verificationRecords.length === 0 || submissions.length === 0) {
    return;
  }

  for (const record of verificationRecords) {
    const bridgeDigest = record.get('bridgeSubmissionDigest');
    const submission = submissions.find((candidate) =>
      candidate.get('canonicalDigest') === bridgeDigest
    );
    if (!bridgeDigest || !submission) {
      problems.push(
        `${file}: bridgeReplay VerificationRecord does not bind to an accepted BridgeSubmission`,
      );
      continue;
    }

    for (const fieldName of profile.bindingFields) {
      if (record.get(fieldName) !== submission.get(fieldName)) {
        problems.push(
          `${file}: bridgeReplay VerificationRecord field '${fieldName}' does not match accepted BridgeSubmission`,
        );
      }
    }
  }
}

function validateBootstrapBundleBinding(file, problems) {
  const profile = protocolSpec.workflow.bootstrapBundleValidationProfile;
  const handshakeProfile = protocolSpec.workflow.handshakeProfile;
  if (!profile) {
    return;
  }

  const bundle = requireSingleObject(file, profile.bundleType, problems);
  const bootstrapAcceptance = requireSingleObject(file, 'BootstrapAcceptance', problems);
  const trustPolicy = requireSingleObject(file, 'TrustPolicyManifest', problems);
  if (!bundle || !bootstrapAcceptance || !trustPolicy) {
    return;
  }

  const protectionProfile = bundle.fields.get(profile.protectionProfileField);
  if (bootstrapAcceptance.fields.get('negotiatedProtectionProfile') !== protectionProfile) {
    problems.push(
      `${file}: BootstrapAcceptance negotiatedProtectionProfile does not match BootstrapTrustBundle`,
    );
  }

  const policyDigest = bundle.fields.get(profile.policyDigestField);
  if (bootstrapAcceptance.fields.get('acceptedTrustPolicyDigest') !== policyDigest) {
    problems.push(
      `${file}: BootstrapAcceptance acceptedTrustPolicyDigest does not match BootstrapTrustBundle`,
    );
  }

  const capsFrames = collectScenarioFrames(file).filter((frame) => frame.frameType === 'CAPS');
  if (capsFrames.length > 0) {
    const expectedMode =
      bootstrapAcceptance.fields.get(handshakeProfile.bootstrapAcceptanceModeField)
        ?? handshakeProfile.normalBootstrapModeValue;
    if (
      !capsFrames.every((frame) =>
        (frame.degradedBootstrapMode ?? handshakeProfile.normalBootstrapModeValue) === expectedMode
      )
    ) {
      problems.push(
        `${file}: BootstrapAcceptance degradedBootstrapMode does not match converged CAPS bootstrap mode`,
      );
    }
  }

  const manifestDigest = bundle.fields.get(profile.manifestDigestField);
  if (trustPolicy.fields.get('canonicalDigest') !== manifestDigest) {
    problems.push(
      `${file}: BootstrapTrustBundle trustPolicyManifestDigest does not match TrustPolicyManifest canonicalDigest`,
    );
  }
}

function collectDigestBearingObjects(file) {
  return extractFencedBlocks(readText(file))
    .map((block) => block.body)
    .map((body) => ({
      body,
      typeName: body.match(/^([^\s{]+(?:\([^)]+\))?)\s*\{/m)?.[1] ?? 'UnknownObject',
    }))
    .filter((entry) => entry.typeName !== 'Frame')
    .map(({ body, typeName }) => ({ body, typeName, fields: parseColonFields(body) }))
    .flatMap(({ body, typeName, fields }) =>
      ['canonicalDigest', 'attestationDigest']
        .filter((fieldName) => fields.has(fieldName))
        .map((fieldName) => ({
          file,
          digestField: fieldName,
          digest: fields.get(fieldName),
          body: body.trim(),
          typeName,
        }))
    );
}

function validateDigestUniqueness(files, problems) {
  const seen = new Map();
  for (const file of files) {
    for (const entry of collectDigestBearingObjects(file)) {
      const prior = seen.get(entry.digest);
      if (!prior) {
        seen.set(entry.digest, entry);
        continue;
      }
      if (prior.body !== entry.body) {
        problems.push(
          `${file}: digest '${entry.digest}' is reused by '${entry.typeName}' and '${prior.typeName}' with different canonical bodies (first seen in ${prior.file})`,
        );
      }
    }
  }
}

function validateTranscriptComposition(file, problems) {
  for (const transcript of collectTypedObjects(file, 'Transcript')) {
    const fields = transcript.fields;
    if (fields.has('bridgeTraceRef') && fields.has('contractTraceRef')) {
      problems.push(
        `${file}: bridge-specific end-to-end transcript must not compose both contractTraceRef and bridgeTraceRef`,
      );
    }
  }
}

function validateHappyPathSupportArtifacts(file, problems) {
  if (file !== 'conformances/02.HAPPY.PATH.md') {
    return;
  }

  const capabilityToken = requireSingleObject(file, 'CapabilityToken', problems);
  const capabilityUseReceipt = requireSingleObject(file, 'CapabilityUseReceipt', problems);
  const settlementComputation = requireSingleObject(file, 'SettlementComputation', problems);
  const netTransferSet = requireSingleObject(file, 'NetTransferSet', problems);

  if (capabilityToken && capabilityUseReceipt) {
    if (
      capabilityToken.fields.get('contractRef') !== capabilityUseReceipt.fields.get('contractRef')
    ) {
      problems.push(
        `${file}: CapabilityUseReceipt contractRef does not match the published happy-path CapabilityToken`,
      );
    }
  }

  if (settlementComputation && netTransferSet) {
    if (
      settlementComputation.fields.get('netTransferSetDigest')
        !== netTransferSet.fields.get('canonicalDigest')
    ) {
      problems.push(
        `${file}: SettlementComputation netTransferSetDigest does not resolve to the published happy-path NetTransferSet`,
      );
    }
    if (
      settlementComputation.fields.get('contractRef') !== netTransferSet.fields.get('contractRef')
    ) {
      problems.push(
        `${file}: NetTransferSet contractRef does not match the published happy-path SettlementComputation`,
      );
    }
  }
}

function validateNegotiationFinalityCases(file, problems) {
  if (file !== 'conformances/05.NEGOTIATION.RACES.md') {
    return;
  }

  const caseSections = collectCaseSections(file);

  const insufficientSection = caseSections.get('contract.close.insufficient_verifier_independence');
  if (insufficientSection) {
    const objects = extractObjectBlocks(insufficientSection, file);
    const inputWitnessSet = objects.find((object) => object.typeName === 'InputWitnessSet');
    const negativeOutcome = objects.find((object) => object.typeName === 'NegativeOutcome');
    const witnessDomains = parseListValue(inputWitnessSet?.fieldMap?.witnessDomains);
    if (witnessDomains.length < 2 || new Set(witnessDomains).size !== 1) {
      problems.push(
        `${file}: insufficient-verifier-independence case must publish a witness set with duplicate witnessDomains`,
      );
    }
    if (negativeOutcome?.fieldMap?.failureReason !== 'insufficientVerifierIndependence') {
      problems.push(
        `${file}: insufficient-verifier-independence case must fail with failureReason 'insufficientVerifierIndependence'`,
      );
    }
    if (negativeOutcome?.fieldMap?.semanticEffect !== 'closeBlocked') {
      problems.push(
        `${file}: insufficient-verifier-independence case must keep close blocked`,
      );
    }
  }

  const conflictingSection = caseSections.get('contract.close.conflicting_finality_evidence');
  if (conflictingSection) {
    const objects = extractObjectBlocks(conflictingSection, file);
    const input = objects.find((object) => object.typeName === 'Input');
    const negativeOutcome = objects.find((object) => object.typeName === 'NegativeOutcome');
    if (
      input?.fieldMap?.existingWitnessDigest
      && input?.fieldMap?.existingWitnessDigest === input?.fieldMap?.conflictingWitnessDigest
    ) {
      problems.push(
        `${file}: conflicting-finality-evidence case must publish distinct existing and conflicting witness digests`,
      );
    }
    if (negativeOutcome?.fieldMap?.failureReason !== 'conflictingFinalityEvidence') {
      problems.push(
        `${file}: conflicting-finality-evidence case must fail with failureReason 'conflictingFinalityEvidence'`,
      );
    }
    if (negativeOutcome?.fieldMap?.semanticEffect !== 'closeBlocked') {
      problems.push(`${file}: conflicting-finality-evidence case must keep close blocked`);
    }
  }
}

function validateBootstrapTrustPolicySemantics(file, problems) {
  if (file !== 'conformances/01.BOOTSTRAP.TRANSCRIPT.md') {
    return;
  }

  const bundle = requireSingleObject(file, 'BootstrapTrustBundle', problems);
  const trustPolicy = requireSingleObject(file, 'TrustPolicyManifest', problems);
  const freshnessPolicy = requireSingleObject(file, 'FreshnessPolicy', problems);

  if (bundle && !bundle.fields.get('authorizedSuccessorBundleDigests')) {
    problems.push(
      `${file}: BootstrapTrustBundle must publish authorizedSuccessorBundleDigests for the maintained unknown-peer bootstrap lineage`,
    );
  }

  if (trustPolicy) {
    for (
      const fieldName of [
        'acceptedIdentityRootDigests',
        'acceptedTrustDomainRootDigests',
        'acceptedRevocationAuthorityDigests',
        'acceptedBridgeDomainDigests',
        'acceptedSybilResistanceClasses',
        'acceptedProofProfiles',
        'acceptedPredicateRuntimeProfiles',
      ]
    ) {
      if (parseListValue(trustPolicy.fields.get(fieldName)).length === 0) {
        problems.push(`${file}: TrustPolicyManifest field '${fieldName}' must be non-empty`);
      }
    }
    const acceptedRuntimes = parseListValue(
      trustPolicy.fields.get('acceptedPredicateRuntimeProfiles'),
    );
    if (!acceptedRuntimes.includes('aap-predicate-wasm32-v1')) {
      problems.push(
        `${file}: TrustPolicyManifest must accept predicate runtime 'aap-predicate-wasm32-v1' for AAP Open Core`,
      );
    }
  }

  if (
    freshnessPolicy
    && freshnessPolicy.fields.get('requireRevocationFreshnessForResume') !== 'true'
  ) {
    problems.push(
      `${file}: FreshnessPolicy must require revocation freshness for resume in the maintained unknown-peer bootstrap profile`,
    );
  }
}

function validateKnownFrameTypes(file, frames, problems) {
  const allowed = new Set(protocolSpec.wire.frameTypes.map(([, name]) => name));
  for (const frame of frames) {
    if (!allowed.has(frame.frameType)) {
      problems.push(`${file}: unknown frame type '${frame.frameType}'`);
    }
  }
}

function validateRequiredCaseCoverage(file, problems) {
  const requiredCasesByFile = {
    'conformances/04.SAFE.RESUME.md': {
      'resume.version_family_mismatch': [
        'refusalReasonCode: versionFamilyMismatch',
        'resultingAction: allowDiagnosticsOnly',
        'degradedBootstrapMode: diagnosticOnly',
      ],
    },
    'conformances/05.NEGOTIATION.RACES.md': {
      'contract.close.insufficient_verifier_independence': [
        'failureReason: insufficientVerifierIndependence',
        'semanticEffect: closeBlocked',
      ],
      'contract.close.conflicting_finality_evidence': [
        'failureReason: conflictingFinalityEvidence',
        'semanticEffect: closeBlocked',
      ],
      'contract.state.post_close_traffic_rejected': [
        'errorCode: invalidStateTransition',
      ],
      'contract.challenge.post_close_audit_only': [
        'errorCode: invalidStateTransition',
        'semanticEffect: auditOnly',
      ],
    },
    'conformances/08.NEGATIVE.CASES.md': {
      'contract.close.blocked_by_active_challenge': [
        'errorCode: invalidStateTransition',
      ],
      'trust.close.stale_revocation_blocks_finality': [
        'finalityAccepted: false',
        'failClosedReason: staleRevocationEvidence',
        'nextRequiredAction: waitOrResolveBlockedCloseOutcome',
      ],
      'contract.close.late_witness_after_max_finality_wait': [
        'failClosedReason: finalityWaitExpired',
        'reopenAllowed: false',
        'lateEvidenceDisposition: retainForAuditOnly',
      ],
      'wire.extension.reserved_frame_code_rejected': [
        'errorCode: unsupportedBaseProfileSchema',
      ],
      'wire.bootstrap.domain_limited_bridge_rejected': [
        'degradedBootstrapMode: domainLimited',
        'failClosedReason: domainEligibilityNotRestored',
      ],
      'wire.bootstrap.finality_blocked_close_rejected': [
        'degradedBootstrapMode: finalityBlocked',
        'errorCode: invalidStateTransition',
      ],
      'wire.bootstrap.diagnostic_only_contract_rejected': [
        'degradedBootstrapMode: diagnosticOnly',
        'errorCode: invalidStateTransition',
      ],
    },
  };

  const requiredCases = requiredCasesByFile[file];
  if (!requiredCases) {
    return;
  }

  const caseSections = collectCaseSections(file);
  for (const [caseId, requiredSnippets] of Object.entries(requiredCases)) {
    const section = caseSections.get(caseId);
    if (!section) {
      problems.push(`${file}: missing required case id '${caseId}'`);
      continue;
    }
    for (const snippet of requiredSnippets) {
      if (!section.includes(snippet)) {
        problems.push(`${file}: case '${caseId}' is missing required snippet '${snippet}'`);
      }
    }
  }
}

export function validateScenarios() {
  const problems = [];
  const scenarioFiles = listScenarioFiles();
  for (const file of scenarioFiles) {
    const frames = collectScenarioFrames(file);
    validateKnownFrameTypes(file, frames, problems);
    validateRequiredCaseCoverage(file, problems);
    validateHappyPathSupportArtifacts(file, problems);
    validateNegotiationFinalityCases(file, problems);
    validateFrameTargetPhases(file, frames, problems);
    validateLateEvidencePolicy(file, problems);
    validateCriticalExtensionNegotiation(file, problems);
    if (file === 'conformances/06.END.TO.END.TRANSCRIPTS.md') {
      validateTranscriptComposition(file, problems);
    }

    const resumeProfile = protocolSpec.workflow.resumeProfile;
    const hasResumeAcceptance =
      collectTypedObjects(file, resumeProfile.resumeAcceptanceType).length > 0;
    const hasResumeRefusal = collectTypedObjects(file, resumeProfile.resumeRefusalType).length > 0;
    const negotiationTypes = new Set(protocolSpec.workflow.handshakeProfile.negotiationFrameOrder);
    const hasNegotiation = frames.filter((frame) => negotiationTypes.has(frame.frameType)).length
      >= protocolSpec.workflow.handshakeProfile.negotiationFrameOrder.length;
    const hasRejectedNegativeOutcome = collectTypedObjects(file, 'NegativeOutcome')
      .some((object) => object.fields.get('accepted') === 'false');

    if (hasResumeAcceptance) {
      validateResumeConvergence(file, problems);
    } else if (hasResumeRefusal) {
      validateResumeRefusal(file, problems);
    } else if (hasNegotiation) {
      validateHandshakeConvergence(file, problems);
    }

    if (!hasRejectedNegativeOutcome) {
      validateRequiredTerminalFrames(file, frames, problems);
    }
    if (!hasRejectedNegativeOutcome) {
      validateExpectedTransitions(file, problems);
    }

    if (frames.some((frame) => frame.frameType === 'SETTLE' || frame.frameType === 'CLOSE')) {
      validateCloseFinalityBinding(file, problems);
    }
    if (frames.some((frame) => frame.frameType === 'CLOSE')) {
      validateCloseScopeShape(file, frames, problems);
    }

    if (
      collectTypedObjects(file, protocolSpec.workflow.bridgeBindingProfile.submissionType).length
        > 0
      || collectTypedObjects(file, protocolSpec.workflow.bridgeBindingProfile.verificationType)
        .some(
          (object) =>
            object.fields.get('verificationMethod')
              === protocolSpec.workflow.bridgeBindingProfile.verificationMethod,
        )
    ) {
      validateBridgeSubmissionBinding(file, problems);
    }

    if (file === 'conformances/01.BOOTSTRAP.TRANSCRIPT.md') {
      validateBootstrapBundleBinding(file, problems);
      validateBootstrapTrustPolicySemantics(file, problems);
    }

    for (const frame of frames) {
      if (
        frame.frameType === 'STATE'
        && frame.contractPhase
        && frame.phase
        && frame.contractPhase !== frame.phase
      ) {
        problems.push(
          `${file}: STATE frame contractPhase '${frame.contractPhase}' does not match payload phase '${frame.phase}'`,
        );
      }

      if (
        frame.frameType === protocolSpec.workflow.closeBindingProfile.closeFrameType
        && frame.block?.includes(`${protocolSpec.workflow.closeBindingProfile.closeSectionType} {`)
      ) {
        for (
          const requiredField of protocolSpec.workflow.closeBindingProfile
            .closeSectionRequiredFields
        ) {
          if (!frame.block.includes(`${requiredField}:`)) {
            problems.push(
              `${file}: CLOSE frame ${protocolSpec.workflow.closeBindingProfile.closeSectionType} is missing '${requiredField}'`,
            );
          }
        }
      }
    }
  }

  validateDigestUniqueness(scenarioFiles, problems);

  return problems;
}

if (isMainModule(import.meta.url)) {
  requireNoProblems('validate.scenarios', validateScenarios());
}
