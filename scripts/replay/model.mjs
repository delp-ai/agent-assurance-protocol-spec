import { parseSummaryBlock } from '../core/parser.mjs';
import { registryLookups } from '../core/schema.mjs';

export const replayHarnessVersion = 'aap-cross-replay-v1';

function formatList(values = []) {
  return `[${values.join(', ')}]`;
}

function filterVectorIdsByPrefix(vectorIds = [], prefix) {
  return vectorIds.filter((vectorId) => vectorId.startsWith(prefix));
}

function normalizeErrorCode(errorCode) {
  if (errorCode === null || errorCode === undefined || errorCode === 'none') {
    return 'none';
  }
  const lookup = registryLookups.get('errorCode');
  const raw = String(errorCode).trim();
  if (/^\d+$/.test(raw)) {
    return raw;
  }
  if (lookup?.forward.has(raw)) {
    return String(lookup.forward.get(raw));
  }
  return raw;
}

function deriveContractState(frame) {
  if (!frame) {
    return null;
  }
  if (frame.frameType === 'STATE') {
    return frame.payload?.phase
      ? `${frame.payload.phase}`[0].toUpperCase() + `${frame.payload.phase}`.slice(1)
      : null;
  }
  const stateByFrameType = {
    PROPOSE: 'Proposed',
    COUNTER: 'Countered',
    ACCEPT: 'Accepted',
    DECLINE: 'Declined',
    DELIVER: 'Delivering',
    PROVE: 'Proved',
    CANCEL: 'Cancelled',
    SETTLE: 'Settling',
    CLOSE: 'Closed',
    CHALLENGE: 'Challenged',
    REPAIR: 'Challenged',
  };
  return stateByFrameType[frame.frameType] ?? null;
}

export function parseExpectedFrameOutcome(summaryBlock) {
  if (!summaryBlock) {
    return null;
  }
  const summary = parseSummaryBlock(summaryBlock);
  return {
    accepted: summary.get('accepted') ?? null,
    parsedSuccessfully: summary.get('parsedSuccessfully') ?? null,
    generatedWireError: summary.get('generatedWireError') ?? null,
  };
}

export function parseExpectedTranscriptOutcome(summaryBlock) {
  if (!summaryBlock) {
    return null;
  }
  return Object.fromEntries(parseSummaryBlock(summaryBlock).entries());
}

export function normalizeExpectedValue(raw) {
  return raw.replace(/^"(.*)"$/, '$1');
}

export function emittedWireErrorSet(transcriptOutcome) {
  return new Set(
    `${transcriptOutcome.emittedWireErrors ?? '[]'}`
      .replace(/^\[/, '')
      .replace(/\]$/, '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function deriveTranscriptOutcome(frameResults, transcript) {
  const acceptedFrames = frameResults
    .filter((result) => result.accepted)
    .map((result) => result.id);
  const rejectedFrames = frameResults
    .filter((result) => !result.accepted)
    .map((result) => result.id);
  const acceptedParsedFrames = frameResults
    .filter((result) => result.accepted)
    .map((result) => result.parsedFrame)
    .filter(Boolean);
  const emittedWireErrors = acceptedParsedFrames
    .filter((frame) => frame.frameType === 'WIRE_ERROR')
    .map((frame) => normalizeErrorCode(frame.payload?.errorCode));

  const acceptedNegotiationFrames = acceptedParsedFrames.filter(
    (frame) => frame.frameType === 'HELLO' || frame.frameType === 'CAPS',
  );
  let currentHandshakeState = null;
  if (acceptedNegotiationFrames.filter((frame) => frame.frameType === 'CAPS').length >= 2) {
    currentHandshakeState = 'handshakeConverged';
  } else if (acceptedNegotiationFrames.some((frame) => frame.frameType === 'CAPS')) {
    currentHandshakeState = 'capsAccepted';
  } else if (acceptedNegotiationFrames.some((frame) => frame.frameType === 'HELLO')) {
    currentHandshakeState = 'helloAccepted';
  } else if (emittedWireErrors.includes('111')) {
    currentHandshakeState = 'failed';
  }

  const semanticFrames = acceptedParsedFrames.filter((frame) => frame.frameType !== 'WIRE_ERROR');
  const lastSemanticFrame = semanticFrames.at(-1) ?? null;
  const derivedState = deriveContractState(lastSemanticFrame);
  const terminalCloseReason = lastSemanticFrame?.frameType === 'CLOSE'
    ? `${lastSemanticFrame.payload?.closeReasonCode ?? ''}`
    : null;
  const closeTraceBound = lastSemanticFrame?.frameType === 'CLOSE'
      && lastSemanticFrame.payload?.closeTraceDigest
    ? 'true'
    : null;

  let contractTrafficPermitted = null;
  if (currentHandshakeState === 'capsAccepted' || currentHandshakeState === 'handshakeConverged') {
    contractTrafficPermitted = 'true';
  } else if (currentHandshakeState === 'helloAccepted' || currentHandshakeState === 'failed') {
    contractTrafficPermitted = 'false';
  }

  const orderedAcceptedVectors = filterVectorIdsByPrefix(
    transcript.requiredAcceptedVectorIds ?? [],
    'bytes.',
  ).filter((vectorId) => !vectorId.startsWith('bytes.object.'));
  const supportingObjectVectors = filterVectorIdsByPrefix(
    transcript.requiredAcceptedVectorIds ?? [],
    'bytes.object.',
  );
  const byteReplayBundleComplete = transcript.dependencyClass === 'selfContainedByteReplay'
    ? 'true'
    : 'false';

  return {
    acceptedFrames: formatList(acceptedFrames),
    rejectedFrames: formatList(rejectedFrames),
    emittedWireErrors: formatList(emittedWireErrors.filter((code) => code !== 'none')),
    currentHandshakeState,
    contractTrafficPermitted,
    contractStateAfterFrame: derivedState,
    finalContractState: derivedState,
    terminalCloseReason,
    closeTraceBound,
    orderedAcceptedVectors: orderedAcceptedVectors.length > 0
      ? formatList(orderedAcceptedVectors)
      : null,
    supportingObjectVectors: supportingObjectVectors.length > 0
      ? formatList(supportingObjectVectors)
      : null,
    replayBundleDependencyClass: transcript.dependencyClass ?? null,
    byteReplayBundleComplete,
    observationBoundary: transcript.observationBoundary ?? null,
    orderingKey: transcript.orderingKeyFields?.length
      ? transcript.orderingKeyFields.join('|')
      : null,
    protectedArrivalOrderWinner: transcript.protectedArrivalWinnerFrameId ?? null,
    replayWindowWidened: 'false',
    reopenPermitted: derivedState === 'Closed' ? 'false' : null,
  };
}
