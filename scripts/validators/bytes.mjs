import { isMainModule, loadJson, requireNoProblems } from '../core/common.mjs';
import { buildByteFixtureState } from '../core/fixtures.mjs';
import { extractObjectBlocks } from '../core/objects.mjs';
import {
  bytesToHex,
  hexToBytes,
  parseFrame,
  parseObject,
  parsePayloadEnvelope,
  parseSummaryBlock,
} from '../core/parser.mjs';
import {
  encodingSpec,
  frameTypeByPayloadHeading,
  headerSectionSchemas,
  objectSchemas,
  payloadHeadingByFrameType,
  payloadSchemas,
  protocolSpec,
  registryLookups,
  resolveSchemaType,
} from '../core/schema.mjs';
import {
  serializeFrame,
  serializeHeaderSection,
  serializeObject,
  serializePayloadEnvelope,
} from '../core/serialize.mjs';

function extractFirstTypeName(blockBody) {
  const match = blockBody?.match(/^\s*([A-Za-z0-9_]+)\s*\{/m);
  return match?.[1] ?? null;
}

function normalizeValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => normalizeValue(item)).join(', ')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(
      ([key, innerValue]) => `${key}: ${normalizeValue(innerValue)}`,
    );
    return `{${entries.join(', ')}}`;
  }
  if (typeof value === 'string') {
    return /^[A-Za-z0-9_.:|/-]+$/.test(value) ? value : `"${value}"`;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return String(value);
}

function getPathValue(target, path) {
  if (path === 'flags') {
    return target.flagNames?.join('|');
  }
  return path.split('.').reduce((current, key) => current?.[key], target);
}

function normalizeExpectedValue(raw) {
  return raw.replace(/^"(.*)"$/, '$1');
}

function compareSummary(summaryBlock, parsed, label, problems) {
  if (!summaryBlock) {
    return;
  }
  const summary = parseSummaryBlock(summaryBlock);
  for (const [key, expectedRaw] of summary.entries()) {
    const actual = getPathValue(parsed, key);
    if (actual === undefined) {
      problems.push(`${label}: summary key '${key}' does not exist in parsed result`);
      continue;
    }
    const normalizedActual = normalizeValue(actual);
    const normalizedExpected = normalizeExpectedValue(expectedRaw);
    if (normalizedActual !== normalizedExpected) {
      problems.push(
        `${label}: summary mismatch for '${key}', expected '${expectedRaw}' but found '${normalizedActual}'`,
      );
    }
  }
}

function parseFrameOutcome(summaryBlock) {
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

function parseTranscriptOutcome(summaryBlock) {
  if (!summaryBlock) {
    return null;
  }
  return Object.fromEntries(parseSummaryBlock(summaryBlock).entries());
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

const supportedDependencyClasses = new Set([
  'selfContainedByteReplay',
  'declaredBootstrapContext',
  'semanticProjectionOnly',
]);

function filterVectorIdsByPrefix(vectorIds = [], prefix) {
  return vectorIds.filter((vectorId) => vectorId.startsWith(prefix));
}

function formatList(values = []) {
  return `[${values.join(', ')}]`;
}

function deriveTranscriptOutcome(frameResults, transcript) {
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
  const byteReplayBundleComplete = transcript.dependencyClass
    ? transcript.dependencyClass === 'selfContainedByteReplay'
      ? 'true'
      : 'false'
    : null;

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

function compareTranscriptOutcome(expectedOutcome, actualOutcome, label, problems) {
  if (!expectedOutcome) {
    return;
  }
  for (const [key, expectedRaw] of Object.entries(expectedOutcome)) {
    const actualValue = actualOutcome[key];
    if (actualValue === undefined || actualValue === null) {
      continue;
    }
    const normalizedExpected = normalizeExpectedValue(expectedRaw);
    if (actualValue !== normalizedExpected) {
      problems.push(
        `${label}: transcript outcome mismatch for '${key}', expected '${expectedRaw}' but found '${actualValue}'`,
      );
    }
  }
}

function validateSuccessfulWitnessQuorum(parsedObjectMap, problems) {
  const witnessSet = parsedObjectMap.get('bytes.object.finality_witness_set.completed_v1');
  const witnessDelta = parsedObjectMap.get('bytes.object.finality_witness.completed_delta_v1');
  const witnessGamma = parsedObjectMap.get('bytes.object.finality_witness.completed_gamma_v1');
  const independencePolicy = parsedObjectMap.get('bytes.object.verifier_independence.open_core_v1');

  if (!witnessSet || !witnessDelta || !witnessGamma || !independencePolicy) {
    return;
  }

  const expectedWitnessDigests = [
    witnessDelta.canonicalDigest,
    witnessGamma.canonicalDigest,
  ];
  const actualWitnessDigests = witnessSet.memberWitnessDigests ?? [];
  if (JSON.stringify(actualWitnessDigests) !== JSON.stringify(expectedWitnessDigests)) {
    problems.push(
      `conformances/09.BYTE.CORPUS.md: successful FinalityWitnessSet does not match the published successful witness digests`,
    );
  }

  for (const witness of [witnessDelta, witnessGamma]) {
    if (witness.finalityCandidateDigest !== witnessSet.finalityCandidateDigest) {
      problems.push(
        `conformances/09.BYTE.CORPUS.md: successful witness '${witness.witnessId}' does not bind the published finality candidate digest`,
      );
    }
    if (JSON.stringify(witness.contractRef) !== JSON.stringify(witnessSet.contractRef)) {
      problems.push(
        `conformances/09.BYTE.CORPUS.md: successful witness '${witness.witnessId}' does not bind the published witness-set contractRef`,
      );
    }
    if (witness.contractRevision !== witnessSet.contractRevision) {
      problems.push(
        `conformances/09.BYTE.CORPUS.md: successful witness '${witness.witnessId}' does not bind the published witness-set contractRevision`,
      );
    }
  }

  if (witnessSet.independencePolicyDigest !== independencePolicy.canonicalDigest) {
    problems.push(
      `conformances/09.BYTE.CORPUS.md: successful FinalityWitnessSet does not bind the published VerifierIndependencePolicy`,
    );
  }

  const distinctDomains = new Set([witnessDelta.witnessDomain, witnessGamma.witnessDomain]);
  if (distinctDomains.size < independencePolicy.minimumDistinctDomains) {
    problems.push(
      `conformances/09.BYTE.CORPUS.md: successful witness quorum does not satisfy minimumDistinctDomains from the published VerifierIndependencePolicy`,
    );
  }
}

function normalizeIdList(values = []) {
  return [...values].sort().join('|');
}

function transcriptPrerequisiteKey(transcript) {
  return `accepted:${normalizeIdList(transcript.requiredAcceptedVectorIds)};absent:${
    normalizeIdList(
      transcript.requiredAbsentVectorIds,
    )
  };dependencyClass:${transcript.dependencyClass ?? ''};contexts:${
    normalizeIdList(
      transcript.declaredPrerequisiteContextIds,
    )
  };observation:${transcript.observationBoundary ?? ''};ordering:${
    normalizeIdList(
      transcript.orderingKeyFields,
    )
  };winner:${transcript.protectedArrivalWinnerFrameId ?? ''}`;
}

function transcriptBehaviorSignature(transcript) {
  return JSON.stringify({
    frames: transcript.frames.map((frame) => ({
      expectedPerFrameResult: frame.expectedPerFrameResult ?? null,
    })),
  });
}

function hasExplicitPerFrameExpectations(transcript) {
  return transcript.frames.some((frame) => frame.expectedPerFrameResult);
}

function transcriptFrameSequenceKey(transcript, corpusVectorMap) {
  return transcript.frames
    .map((frame) => {
      if (frame.canonicalFrameBytes) {
        return bytesToHex(hexToBytes(frame.canonicalFrameBytes));
      }
      return corpusVectorMap.get(frame.sourceVectorId) ?? `missing:${frame.sourceVectorId}`;
    })
    .join('||');
}

function vectorLabel(vectorId) {
  return `conformances/09.BYTE.CORPUS.md:${vectorId}`;
}

function splitTopLevelEntries(source) {
  const entries = [];
  let current = '';
  let depthBraces = 0;
  let depthBrackets = 0;
  let inQuote = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' && source[index - 1] !== '\\') {
      inQuote = !inQuote;
      current += char;
      continue;
    }
    if (!inQuote) {
      if (char === '{') {
        depthBraces += 1;
      } else if (char === '}') {
        depthBraces -= 1;
      } else if (char === '[') {
        depthBrackets += 1;
      } else if (char === ']') {
        depthBrackets -= 1;
      } else if ((char === ',' || char === '\n') && depthBraces === 0 && depthBrackets === 0) {
        const trimmed = current.trim();
        if (trimmed) {
          entries.push(trimmed);
        }
        current = '';
        continue;
      }
    }
    current += char;
  }

  const trimmed = current.trim();
  if (trimmed) {
    entries.push(trimmed);
  }
  return entries;
}

function findTopLevelColon(source) {
  let depthBraces = 0;
  let depthBrackets = 0;
  let inQuote = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' && source[index - 1] !== '\\') {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) {
      continue;
    }
    if (char === '{') {
      depthBraces += 1;
    } else if (char === '}') {
      depthBraces -= 1;
    } else if (char === '[') {
      depthBrackets += 1;
    } else if (char === ']') {
      depthBrackets -= 1;
    } else if (char === ':' && depthBraces === 0 && depthBrackets === 0) {
      return index;
    }
  }
  return -1;
}

function parseLooseLiteral(rawValue) {
  const trimmed = rawValue.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const body = trimmed.slice(1, -1).trim();
    if (!body) {
      return [];
    }
    return splitTopLevelEntries(body).map((entry) => parseLooseLiteral(entry));
  }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const body = trimmed.slice(1, -1).trim();
    if (!body) {
      return {};
    }
    const result = {};
    for (const entry of splitTopLevelEntries(body)) {
      const colonIndex = findTopLevelColon(entry);
      if (colonIndex === -1) {
        throw new Error(`invalid object literal entry '${entry}'`);
      }
      const key = entry.slice(0, colonIndex).trim();
      const value = entry.slice(colonIndex + 1).trim();
      result[key] = parseLooseLiteral(value);
    }
    return result;
  }
  return trimmed;
}

function coerceTypedValue(rawValue, type, fieldName, contextLabel) {
  const looseValue = typeof rawValue === 'string' ? parseLooseLiteral(rawValue) : rawValue;

  if (type.startsWith('list<')) {
    const innerType = type.slice(5, -1);
    if (!Array.isArray(looseValue)) {
      throw new Error(`${contextLabel}: field '${fieldName}' must be a list literal`);
    }
    return looseValue.map((item, index) =>
      coerceTypedValue(item, innerType, fieldName, `${contextLabel}.${fieldName}[${index}]`)
    );
  }

  const nestedSchema = resolveSchemaType(type);
  if (nestedSchema) {
    if (!looseValue || typeof looseValue !== 'object' || Array.isArray(looseValue)) {
      throw new Error(`${contextLabel}: field '${fieldName}' must be an object literal`);
    }
    return coerceObjectBySchema(looseValue, nestedSchema, `${contextLabel}.${fieldName}`);
  }

  if (type === 'bool') {
    if (typeof looseValue !== 'boolean') {
      throw new Error(`${contextLabel}: field '${fieldName}' must be boolean`);
    }
    return looseValue;
  }

  return looseValue;
}

function coerceObjectBySchema(rawObject, schema, contextLabel) {
  const fieldsByName = new Map(schema.map((entry) => [entry.field, entry]));
  const result = {};

  for (const [fieldName, rawValue] of Object.entries(rawObject)) {
    const field = fieldsByName.get(fieldName);
    if (!field) {
      throw new Error(`${contextLabel}: unknown field '${fieldName}'`);
    }
    result[fieldName] = coerceTypedValue(rawValue, field.type, fieldName, contextLabel);
  }

  return result;
}

function extractTypedBodyBlock(blockBody, label) {
  const blocks = extractObjectBlocks(`\`\`\`text\n${blockBody.trim()}\n\`\`\``, label);
  if (blocks.length === 0) {
    throw new Error(`${label}: missing typed body block`);
  }
  return blocks[0];
}

function parseTypedBodyBlock(blockBody, schemaType, schema, label) {
  const block = extractTypedBodyBlock(blockBody, label);
  if (block.typeName !== schemaType) {
    throw new Error(`${label}: expected body type '${schemaType}' but found '${block.typeName}'`);
  }
  return coerceObjectBySchema(block.fieldMap, schema, `${label}:${schemaType}`);
}

export function validateByteSets() {
  const problems = [];
  const bytesSpec = loadJson('specs/bytes.json');
  const regeneratedState = buildByteFixtureState();
  if (JSON.stringify(bytesSpec) !== JSON.stringify(regeneratedState)) {
    problems.push(
      'specs/bytes.json: byte fixture metadata is stale; run `node scripts/specs/bytes.mjs --write`',
    );
    return problems;
  }
  const corpusVectorMap = new Map();
  const parsedObjectMap = new Map();

  for (const vector of bytesSpec.vectors) {
    const vectorId = vector.id;
    if (!vectorId) {
      problems.push(`${bytesSpec.docs.byteCorpusFile}: vector entry missing id`);
      continue;
    }

    const frameBytesBlock = vector.canonicalFrameBytes;
    const payloadBytesBlock = vector.canonicalPayloadBytes;
    const sectionBytesBlock = vector.canonicalSectionBytes;
    const objectBytesBlock = vector.canonicalObjectBytes;
    const parseSummaryBlock = vector.expectedParseSummary;
    const payloadBodyBlock = vector.canonicalPayloadBody;
    const objectBodyBlock = vector.canonicalObjectBody;
    const sectionBodyBlock = vector.canonicalHeaderSection;

    let parsedFrame = null;

    if (frameBytesBlock) {
      const frameBytes = hexToBytes(frameBytesBlock);
      parsedFrame = parseFrame(frameBytes);
      corpusVectorMap.set(vectorId, bytesToHex(frameBytes));

      const reserializedFrame = bytesToHex(serializeFrame(parsedFrame));
      if (reserializedFrame !== bytesToHex(frameBytes)) {
        problems.push(
          `${vectorLabel(vectorId)}: parsed frame does not serialize back to canonical frame bytes`,
        );
      }

      if (payloadBytesBlock) {
        const payloadBytes = hexToBytes(payloadBytesBlock);
        const parsedEnvelope = parsePayloadEnvelope(parsedFrame.frameType, payloadBytes);
        if (parsedEnvelope.schemaLocalRevision !== parsedFrame.schemaLocalRevision) {
          problems.push(`${vectorLabel(vectorId)}: payload envelope schema revision mismatch`);
        }
        if (parsedEnvelope.bodyHex !== parsedFrame.bodyHex) {
          problems.push(
            `${vectorLabel(vectorId)}: payload bytes do not match payload embedded in frame`,
          );
        }
        const reserializedPayload = bytesToHex(
          serializePayloadEnvelope(
            parsedFrame.frameType,
            parsedEnvelope.payload,
            parsedEnvelope.schemaLocalRevision,
          ),
        );
        if (reserializedPayload !== bytesToHex(payloadBytes)) {
          problems.push(
            `${
              vectorLabel(vectorId)
            }: parsed payload does not serialize back to canonical payload bytes`,
          );
        }
      }

      if (sectionBytesBlock) {
        const expectedSectionHex = bytesToHex(hexToBytes(sectionBytesBlock));
        const expectedSectionType = extractFirstTypeName(sectionBodyBlock);
        if (expectedSectionType === 'ContractRefSection') {
          const contractRefSection = parsedFrame.sections.find((item) => item.sectionTag === 2);
          if (!contractRefSection) {
            problems.push(`${vectorLabel(vectorId)}: missing ContractRef section`);
          } else if (contractRefSection.rawHex !== expectedSectionHex) {
            problems.push(
              `${vectorLabel(vectorId)}: canonical section bytes do not match parsed frame section`,
            );
          } else {
            const reserializedSection = bytesToHex(
              serializeHeaderSection(
                contractRefSection.sectionTag,
                contractRefSection.decoded,
                contractRefSection.critical,
              ),
            );
            if (reserializedSection !== expectedSectionHex) {
              problems.push(
                `${
                  vectorLabel(vectorId)
                }: parsed header section does not serialize back to canonical section bytes`,
              );
            }
          }
        }
      }

      compareSummary(parseSummaryBlock, parsedFrame, vectorLabel(vectorId), problems);
    }

    if (payloadBodyBlock && payloadBytesBlock) {
      try {
        const bodyType = extractFirstTypeName(payloadBodyBlock);
        const frameType = parsedFrame?.frameType ?? frameTypeByPayloadHeading[bodyType];
        const schema = payloadSchemas[frameType];
        if (!bodyType || !frameType || !schema) {
          problems.push(`${vectorLabel(vectorId)}: could not resolve payload body schema`);
        } else if (bodyType !== payloadHeadingByFrameType[frameType]) {
          problems.push(
            `${
              vectorLabel(vectorId)
            }: payload body type '${bodyType}' does not match frame type '${frameType}'`,
          );
        } else {
          const payloadValue = parseTypedBodyBlock(
            payloadBodyBlock,
            bodyType,
            schema,
            vectorLabel(vectorId),
          );
          const schemaLocalRevision = parsedFrame?.schemaLocalRevision
            ?? encodingSpec.payloadEnvelope.defaultSchemaLocalRevision;
          const serializedPayload = bytesToHex(
            serializePayloadEnvelope(frameType, payloadValue, schemaLocalRevision),
          );
          const expectedPayload = bytesToHex(hexToBytes(payloadBytesBlock));
          if (serializedPayload !== expectedPayload) {
            problems.push(
              `${
                vectorLabel(vectorId)
              }: canonical payload body does not serialize to published payload bytes`,
            );
          }
        }
      } catch (error) {
        problems.push(`${vectorLabel(vectorId)}: ${error.message}`);
      }
    }

    if (sectionBodyBlock && sectionBytesBlock && parsedFrame) {
      try {
        const bodyType = extractFirstTypeName(sectionBodyBlock);
        const parsedSection = parsedFrame.sections.find(
          (section) => headerSectionSchemas[section.sectionTag]?.type === bodyType,
        );
        if (!parsedSection) {
          problems.push(
            `${vectorLabel(vectorId)}: could not resolve section body schema '${bodyType}'`,
          );
        } else {
          const sectionValue = parseTypedBodyBlock(
            sectionBodyBlock,
            bodyType,
            resolveSchemaType(bodyType),
            vectorLabel(vectorId),
          );
          const serializedSection = bytesToHex(
            serializeHeaderSection(parsedSection.sectionTag, sectionValue, parsedSection.critical),
          );
          const expectedSection = bytesToHex(hexToBytes(sectionBytesBlock));
          if (serializedSection !== expectedSection) {
            problems.push(
              `${
                vectorLabel(vectorId)
              }: canonical header section body does not serialize to published section bytes`,
            );
          }
        }
      } catch (error) {
        problems.push(`${vectorLabel(vectorId)}: ${error.message}`);
      }
    }

    if (objectBytesBlock) {
      const objectType = extractFirstTypeName(objectBodyBlock);
      if (!objectType) {
        problems.push(`${vectorLabel(vectorId)}: object vector missing object type declaration`);
      } else {
        const objectBytes = hexToBytes(objectBytesBlock);
        const parsedObject = parseObject(objectType, objectBytes);
        corpusVectorMap.set(vectorId, bytesToHex(objectBytes));
        parsedObjectMap.set(vectorId, { objectType, ...parsedObject });
        const reserializedObject = bytesToHex(serializeObject(objectType, parsedObject));
        if (reserializedObject !== bytesToHex(objectBytes)) {
          problems.push(
            `${
              vectorLabel(vectorId)
            }: parsed object does not serialize back to canonical object bytes`,
          );
        }
        compareSummary(
          parseSummaryBlock,
          { objectType, ...parsedObject },
          vectorLabel(vectorId),
          problems,
        );
      }
    }

    if (objectBodyBlock && objectBytesBlock) {
      try {
        const objectType = extractFirstTypeName(objectBodyBlock);
        const schema = objectSchemas[objectType];
        if (!schema) {
          problems.push(
            `${vectorLabel(vectorId)}: object body type '${objectType}' has no registered schema`,
          );
        } else {
          const objectValue = parseTypedBodyBlock(
            objectBodyBlock,
            objectType,
            schema,
            vectorLabel(vectorId),
          );
          const serializedObject = bytesToHex(serializeObject(objectType, objectValue));
          const expectedObject = bytesToHex(hexToBytes(objectBytesBlock));
          if (serializedObject !== expectedObject) {
            problems.push(
              `${
                vectorLabel(vectorId)
              }: canonical object body does not serialize to published object bytes`,
            );
          }
        }
      } catch (error) {
        problems.push(`${vectorLabel(vectorId)}: ${error.message}`);
      }
    }
  }

  validateSuccessfulWitnessQuorum(parsedObjectMap, problems);

  for (const transcript of bytesSpec.transcripts) {
    const acceptedIds = new Set(transcript.requiredAcceptedVectorIds ?? []);
    const absentIds = new Set(transcript.requiredAbsentVectorIds ?? []);
    const expectedFrameVectorIds = filterVectorIdsByPrefix(
      transcript.requiredAcceptedVectorIds ?? [],
      'bytes.',
    ).filter((vectorId) => !vectorId.startsWith('bytes.object.'));
    if (!transcript.dependencyClass) {
      problems.push(
        `${bytesSpec.docs.byteTranscriptsFile}:${transcript.id}: every maintained transcript must declare a dependency class`,
      );
    }
    if (
      transcript.dependencyClass
      && !supportedDependencyClasses.has(transcript.dependencyClass)
    ) {
      problems.push(
        `${bytesSpec.docs.byteTranscriptsFile}:${transcript.id}: declared dependency class '${transcript.dependencyClass}' is not supported`,
      );
    }
    if (
      transcript.dependencyClass === 'selfContainedByteReplay'
      && (transcript.declaredPrerequisiteContextIds?.length ?? 0) > 0
    ) {
      problems.push(
        `${bytesSpec.docs.byteTranscriptsFile}:${transcript.id}: self-contained transcripts must not declare prerequisite bootstrap contexts`,
      );
    }
    if (transcript.dependencyClass === 'selfContainedByteReplay') {
      if ((transcript.frames?.length ?? 0) === 0) {
        problems.push(
          `${bytesSpec.docs.byteTranscriptsFile}:${transcript.id}: self-contained replay transcripts must publish at least one replayed frame`,
        );
      }
      if (expectedFrameVectorIds.length > 0) {
        if (transcript.frames.some((frame) => !frame.sourceVectorId)) {
          problems.push(
            `${bytesSpec.docs.byteTranscriptsFile}:${transcript.id}: self-contained replay frames must bind every replayed frame to a published source vector`,
          );
        }
        const actualFrameVectorIds = transcript.frames.map((frame) => frame.sourceVectorId);
        if (JSON.stringify(actualFrameVectorIds) !== JSON.stringify(expectedFrameVectorIds)) {
          problems.push(
            `${bytesSpec.docs.byteTranscriptsFile}:${transcript.id}: self-contained replay frames must list the published required frame vectors in exact replay order`,
          );
        }
      }
    }
    if (
      transcript.dependencyClass
      && transcript.dependencyClass !== 'selfContainedByteReplay'
      && (transcript.declaredPrerequisiteContextIds?.length ?? 0) === 0
    ) {
      problems.push(
        `${bytesSpec.docs.byteTranscriptsFile}:${transcript.id}: non-self-contained transcripts must declare prerequisite contexts explicitly`,
      );
    }
    if (transcript.protectedArrivalWinnerFrameId) {
      if (transcript.observationBoundary !== 'protectedArrivalOrder') {
        problems.push(
          `${bytesSpec.docs.byteTranscriptsFile}:${transcript.id}: protected-arrival winner requires observation boundary 'protectedArrivalOrder'`,
        );
      }
      const expectedOrderingKey = protocolSpec.workflow.raceResolutionAdmissionProfile
        ?.protectedArrivalOrderFields ?? [];
      if (
        JSON.stringify(transcript.orderingKeyFields ?? []) !== JSON.stringify(expectedOrderingKey)
      ) {
        problems.push(
          `${bytesSpec.docs.byteTranscriptsFile}:${transcript.id}: ordering key fields must match protocol protected-arrival-order fields`,
        );
      }
      if (
        !transcript.frames.some((frame) => frame.id === transcript.protectedArrivalWinnerFrameId)
      ) {
        problems.push(
          `${bytesSpec.docs.byteTranscriptsFile}:${transcript.id}: protected-arrival winner '${transcript.protectedArrivalWinnerFrameId}' does not name a frame in the transcript`,
        );
      }
      if (transcript.frames[0]?.id !== transcript.protectedArrivalWinnerFrameId) {
        problems.push(
          `${bytesSpec.docs.byteTranscriptsFile}:${transcript.id}: protected-arrival winner must be the first listed frame in observed arrival order`,
        );
      }
    }
    for (const vectorId of acceptedIds) {
      if (!corpusVectorMap.has(vectorId)) {
        problems.push(
          `${bytesSpec.docs.byteTranscriptsFile}:${transcript.id}: required accepted vector '${vectorId}' does not exist in byte corpus`,
        );
      }
      if (absentIds.has(vectorId)) {
        problems.push(
          `${bytesSpec.docs.byteTranscriptsFile}:${transcript.id}: vector '${vectorId}' cannot be both required accepted and required absent`,
        );
      }
    }
    for (const vectorId of absentIds) {
      if (!corpusVectorMap.has(vectorId)) {
        problems.push(
          `${bytesSpec.docs.byteTranscriptsFile}:${transcript.id}: required absent vector '${vectorId}' does not exist in byte corpus`,
        );
      }
    }

    const frameResults = [];
    for (const frame of transcript.frames) {
      const frameHex = frame.canonicalFrameBytes
        ? bytesToHex(hexToBytes(frame.canonicalFrameBytes))
        : corpusVectorMap.get(frame.sourceVectorId);
      if (!frameHex) {
        continue;
      }

      const frameBytes = hexToBytes(frameHex);
      const expectedFrameOutcome = parseFrameOutcome(frame.expectedPerFrameResult);
      let parsedSuccessfully = false;
      let parsedFrame = null;
      try {
        parsedFrame = parseFrame(frameBytes);
        parsedSuccessfully = true;
        const reserializedFrame = bytesToHex(serializeFrame(parsedFrame));
        if (reserializedFrame !== bytesToHex(frameBytes)) {
          problems.push(
            `${bytesSpec.docs.byteTranscriptsFile}:${frame.id}: parsed transcript frame does not serialize back to canonical bytes`,
          );
        }
        const expectsParseSuccess = expectedFrameOutcome?.parsedSuccessfully === 'true'
          || expectedFrameOutcome?.accepted === 'true';
        const expectsParseFailure = expectedFrameOutcome?.parsedSuccessfully === 'false';
        if (expectsParseFailure) {
          problems.push(
            `${bytesSpec.docs.byteTranscriptsFile}:${frame.id}: expected rejected frame but parser accepted it`,
          );
        }
      } catch (error) {
        if (!frame.expectedPerFrameResult) {
          problems.push(`${bytesSpec.docs.byteTranscriptsFile}:${frame.id}: ${error.message}`);
        } else if (
          expectedFrameOutcome?.accepted === 'true'
          || expectedFrameOutcome?.parsedSuccessfully === 'true'
        ) {
          problems.push(
            `${bytesSpec.docs.byteTranscriptsFile}:${frame.id}: expected accepted frame but parser rejected it: ${error.message}`,
          );
        }
      }
      const accepted = expectedFrameOutcome?.accepted === 'false'
        ? false
        : parsedSuccessfully;
      frameResults.push({
        id: frame.id,
        accepted,
        parsedFrame,
        expectedFrameOutcome,
      });
      if (
        (
          expectedFrameOutcome?.accepted === 'true'
          || expectedFrameOutcome?.parsedSuccessfully === 'true'
        )
        && !parsedSuccessfully
      ) {
        problems.push(
          `${bytesSpec.docs.byteTranscriptsFile}:${frame.id}: expected accepted frame did not parse successfully`,
        );
      }
      const explicitHex = bytesToHex(frameBytes);
      if (frame.sourceVectorId) {
        const sourceHex = corpusVectorMap.get(frame.sourceVectorId);
        if (!sourceHex) {
          problems.push(
            `${bytesSpec.docs.byteTranscriptsFile}:${frame.id}: source vector '${frame.sourceVectorId}' was not parsed from byte corpus`,
          );
        } else if (sourceHex !== explicitHex) {
          problems.push(
            `${bytesSpec.docs.byteTranscriptsFile}:${frame.id}: explicit transcript bytes do not match source vector '${frame.sourceVectorId}'`,
          );
        }
      }
    }

    const actualTranscriptOutcome = deriveTranscriptOutcome(frameResults, transcript);
    compareTranscriptOutcome(
      parseTranscriptOutcome(transcript.expectedTranscriptOutcome),
      actualTranscriptOutcome,
      `${bytesSpec.docs.byteTranscriptsFile}:${transcript.id}`,
      problems,
    );

    const emittedWireErrors = new Set(
      actualTranscriptOutcome.emittedWireErrors
        .replace(/^\[/, '')
        .replace(/\]$/, '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    );
    for (const result of frameResults) {
      const expectedWireError = normalizeErrorCode(result.expectedFrameOutcome?.generatedWireError);
      if (expectedWireError !== 'none' && !emittedWireErrors.has(expectedWireError)) {
        problems.push(
          `${bytesSpec.docs.byteTranscriptsFile}:${transcript.id}:${result.id}: expected generated wire error '${expectedWireError}' is not emitted by the transcript`,
        );
      }
    }
  }

  const transcriptsByFrameSequence = new Map();
  for (const transcript of bytesSpec.transcripts) {
    const frameSequenceKey = transcriptFrameSequenceKey(transcript, corpusVectorMap);
    const existing = transcriptsByFrameSequence.get(frameSequenceKey) ?? [];
    existing.push(transcript);
    transcriptsByFrameSequence.set(frameSequenceKey, existing);
  }

  for (const transcripts of transcriptsByFrameSequence.values()) {
    for (let index = 0; index < transcripts.length; index += 1) {
      for (let innerIndex = index + 1; innerIndex < transcripts.length; innerIndex += 1) {
        const left = transcripts[index];
        const right = transcripts[innerIndex];
        if (!hasExplicitPerFrameExpectations(left) || !hasExplicitPerFrameExpectations(right)) {
          continue;
        }
        if (transcriptBehaviorSignature(left) === transcriptBehaviorSignature(right)) {
          continue;
        }
        if (transcriptPrerequisiteKey(left) === transcriptPrerequisiteKey(right)) {
          problems.push(
            `${bytesSpec.docs.byteTranscriptsFile}: transcripts '${left.id}' and '${right.id}' reuse the same frame bytes for different outcomes without distinct machine-readable prerequisites`,
          );
        }
      }
    }
  }

  return problems;
}

if (isMainModule(import.meta.url)) {
  requireNoProblems('validate.bytes', validateByteSets());
}
