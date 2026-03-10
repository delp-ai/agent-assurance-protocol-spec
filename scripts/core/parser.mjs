import {
  encodingSpec,
  flagNames,
  frameTypeNameByCode,
  headerSectionDefinitions,
  headerSectionSchemas,
  namedSectionViewTags,
  payloadSchemas,
  protocolSpec,
  registryLookups,
  resolveSchemaType,
} from './schema.mjs';

export function hexToBytes(input) {
  const hex = input
    .replace(/#[^\n]*$/gm, '')
    .replace(/\/\/[^\n]*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  return Uint8Array.from(hex.map((token) => Number.parseInt(token, 16)));
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

function bytesToAscii(bytes) {
  return Buffer.from(bytes).toString('utf8');
}

function bytesToNumber(bytes) {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
}

function formatDigest(bytes) {
  return bytesToHex(bytes);
}

class Reader {
  constructor(bytes) {
    this.bytes = bytes;
    this.offset = 0;
  }

  remaining() {
    return this.bytes.length - this.offset;
  }

  readBytes(length) {
    if (this.remaining() < length) {
      throw new Error(`truncated read: need ${length} bytes but only ${this.remaining()} remain`);
    }
    const slice = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  readUvarint() {
    let result = 0n;
    let shift = 0n;
    let count = 0;
    while (true) {
      const byte = this.readBytes(1)[0];
      count += 1;
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        const canonical = encodeUvarint(result);
        if (canonical.length !== count) {
          throw new Error(`non-canonical uvarint encoding at offset ${this.offset - count}`);
        }
        return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : result;
      }
      shift += 7n;
      if (count > 10) {
        throw new Error('uvarint exceeds 10 bytes');
      }
    }
  }
}

export function encodeUvarint(valueInput) {
  let value = BigInt(valueInput);
  const bytes = [];
  do {
    let byte = Number(value & 0x7fn);
    value >>= 7n;
    if (value !== 0n) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (value !== 0n);
  return Uint8Array.from(bytes);
}

function lookupRegistry(fieldName, numericValue) {
  const registry = registryLookups.get(fieldName);
  if (!registry) {
    return numericValue;
  }
  return registry.reverse.get(Number(numericValue)) ?? numericValue;
}

function decodeScalar(type, fieldName, valueBytes) {
  switch (type) {
    case 'text':
      return bytesToAscii(valueBytes);
    case 'bytes':
      return bytesToHex(valueBytes);
    case 'digest':
      return formatDigest(valueBytes);
    case 'bool':
      if (valueBytes.length !== 1 || (valueBytes[0] !== 0 && valueBytes[0] !== 1)) {
        throw new Error(`invalid bool encoding for field '${fieldName}'`);
      }
      return valueBytes[0] === 1;
    case 'u8':
      if (valueBytes.length !== 1) {
        throw new Error(`invalid u8 width for field '${fieldName}'`);
      }
      return valueBytes[0];
    case 'u16':
      if (valueBytes.length !== 2) {
        throw new Error(`invalid u16 width for field '${fieldName}'`);
      }
      return lookupRegistry(fieldName, bytesToNumber(valueBytes));
    case 'u32':
      if (valueBytes.length !== 4) {
        throw new Error(`invalid u32 width for field '${fieldName}'`);
      }
      return bytesToNumber(valueBytes);
    case 'u64':
      if (valueBytes.length !== 8) {
        throw new Error(`invalid u64 width for field '${fieldName}'`);
      }
      return lookupRegistry(fieldName, bytesToNumber(valueBytes));
    case 'uvarint': {
      const reader = new Reader(valueBytes);
      const value = reader.readUvarint();
      if (reader.remaining() !== 0) {
        throw new Error(`uvarint field '${fieldName}' has trailing bytes`);
      }
      return value;
    }
    default:
      return null;
  }
}

function hasAllFlags(flagNames, requiredFlags = []) {
  return requiredFlags.every((flag) => flagNames.includes(flag));
}

function ensureNonEmptyField(sectionName, decoded, fieldName) {
  const value = decoded?.[fieldName];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${sectionName} section requires non-empty field '${fieldName}'`);
  }
}

function validateFragmentBounds(decoded) {
  const fragmentIndex = decoded.fragmentIndex;
  const fragmentCount = decoded.fragmentCount;
  if (fragmentCount <= 0) {
    throw new Error('FragmentInfo section has invalid fragmentCount 0');
  }
  if (fragmentIndex < 0 || fragmentIndex >= fragmentCount) {
    throw new Error(
      `FragmentInfo section has fragmentIndex ${fragmentIndex} outside fragmentCount ${fragmentCount}`,
    );
  }
}

function validateGapRanges(decoded) {
  const ackBaseSequence = decoded.ackBaseSequence;
  let lastMax = ackBaseSequence;
  for (const range of decoded.missingRanges) {
    if (range.minInclusive > range.maxInclusive) {
      throw new Error('GapRanges section has descending range bounds');
    }
    if (range.minInclusive <= ackBaseSequence) {
      throw new Error('GapRanges section includes range at or below ackBaseSequence');
    }
    if (range.minInclusive <= lastMax) {
      throw new Error('GapRanges section ranges overlap or are not strictly ascending');
    }
    lastMax = range.maxInclusive;
  }
}

function validatePayloadMirror(sectionName, decoded, payload) {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const sharedFields = Object.keys(decoded).filter((fieldName) =>
    Object.prototype.hasOwnProperty.call(payload, fieldName)
  );
  for (const fieldName of sharedFields) {
    if (payload[fieldName] !== decoded[fieldName]) {
      throw new Error(
        `${sectionName} section field '${fieldName}' does not match payload field '${fieldName}'`,
      );
    }
  }
}

function validateHeaderSectionPolicies(sections, flagNames, payload) {
  const sectionsByTag = new Map(sections.map((section) => [section.sectionTag, section]));

  for (const [tagText, definition] of Object.entries(headerSectionDefinitions)) {
    const tag = Number(tagText);
    const section = sectionsByTag.get(tag);
    const policy = definition.policy;
    if (!policy) {
      continue;
    }

    if (!section) {
      if (
        (policy.requiredWhenFlags?.length ?? 0) > 0
        && hasAllFlags(flagNames, policy.requiredWhenFlags)
      ) {
        throw new Error(
          `missing ${definition.name} section required by flags ${
            policy.requiredWhenFlags.join(', ')
          }`,
        );
      }
      continue;
    }

    if (
      (policy.allowedWhenFlags?.length ?? 0) > 0
      && !hasAllFlags(flagNames, policy.allowedWhenFlags)
    ) {
      throw new Error(
        `${definition.name} section is only allowed with flags ${
          policy.allowedWhenFlags.join(', ')
        }`,
      );
    }

    for (const fieldName of policy.nonEmptyFields ?? []) {
      ensureNonEmptyField(definition.name, section.decoded, fieldName);
    }

    for (const check of policy.checks ?? []) {
      if (check === 'payload.contractMirror') {
        validatePayloadMirror(definition.name, section.decoded ?? {}, payload);
      } else if (check === 'fragment.bounds') {
        validateFragmentBounds(section.decoded);
      } else if (check === 'gapRanges.normalized') {
        validateGapRanges(section.decoded);
      } else {
        throw new Error(`unknown header section structural check '${check}'`);
      }
    }
  }
}

function validateFlagPolicies(frameType, flagNames, sections, payload) {
  if (flagNames.includes('isFinalFragment') && !flagNames.includes('isFragment')) {
    throw new Error('isFinalFragment requires isFragment');
  }

  const hasCriticalSection = sections.some((section) => section.critical);
  if (flagNames.includes('criticalExtensionsPresent') && !hasCriticalSection) {
    throw new Error('criticalExtensionsPresent requires at least one critical header section');
  }
  if (!flagNames.includes('criticalExtensionsPresent') && hasCriticalSection) {
    throw new Error('critical header section requires criticalExtensionsPresent');
  }

  if (flagNames.includes('latestOnly')) {
    if (frameType !== 'STATE') {
      throw new Error('latestOnly is only valid on STATE frames');
    }
    if (!payload?.semanticKey) {
      throw new Error('latestOnly STATE requires semanticKey');
    }
    if (payload?.stateTransitionDigest) {
      throw new Error('latestOnly STATE must not carry stateTransitionDigest');
    }
  }
}

function validateCloseScopePayload(frameType, payload, finalityContext, flagNamesForFrame) {
  if (frameType !== 'CLOSE') {
    return;
  }

  const profile = protocolSpec.workflow.closeScopeValidationProfile;
  if (!profile) {
    return;
  }

  const scope = payload?.closeScope;
  if (!scope) {
    throw new Error('CLOSE payload: missing closeScope');
  }

  const scopeKey = scope === 'session' || scope === 'contract' || scope === 'diagnostic'
    ? scope
    : null;
  if (!scopeKey) {
    throw new Error(`CLOSE payload: unknown closeScope '${scope}'`);
  }

  for (const fieldName of profile[`${scopeKey}RequiredFields`] ?? []) {
    if (!(fieldName in payload)) {
      throw new Error(
        `CLOSE payload: missing required field '${fieldName}' for closeScope '${scope}'`,
      );
    }
  }

  for (const fieldName of profile[`${scopeKey}ForbiddenFields`] ?? []) {
    if (fieldName in payload) {
      throw new Error(
        `CLOSE payload: field '${fieldName}' is forbidden for closeScope '${scope}'`,
      );
    }
  }

  const requiresFinalityContext = profile[`${scopeKey}RequiresFinalityContext`] === true;
  if (requiresFinalityContext && !finalityContext) {
    throw new Error(`CLOSE payload: closeScope '${scope}' requires FinalityContext`);
  }
  if (!requiresFinalityContext && finalityContext) {
    throw new Error(`CLOSE payload: closeScope '${scope}' must not carry FinalityContext`);
  }

  const contractBound = flagNamesForFrame.includes('contractBound');
  if (scope === 'contract' && !contractBound) {
    throw new Error("CLOSE payload: closeScope 'contract' requires contractBound flag");
  }
  if ((scope === 'session' || scope === 'diagnostic') && contractBound) {
    throw new Error(
      `CLOSE payload: closeScope '${scope}' must not carry contractBound flag`,
    );
  }
}

export function decodeTagBin(bytes, schema, contextLabel) {
  const reader = new Reader(bytes);
  const fieldsByTag = new Map(schema.map((entry) => [entry.tag, entry]));
  const seenTags = new Set();
  let lastTag = 0;
  const result = {};

  while (reader.remaining() > 0) {
    const tag = reader.readUvarint();
    const length = reader.readUvarint();
    if (tag <= lastTag) {
      throw new Error(`${contextLabel}: non-ascending field tag ${tag}`);
    }
    lastTag = Number(tag);
    const fieldBytes = reader.readBytes(Number(length));
    const fieldDef = fieldsByTag.get(Number(tag));
    if (!fieldDef) {
      throw new Error(`${contextLabel}: unknown field tag ${tag}`);
    }
    if (seenTags.has(Number(tag))) {
      throw new Error(`${contextLabel}: duplicate field tag ${tag}`);
    }
    seenTags.add(Number(tag));
    result[fieldDef.field] = decodeFieldValue(fieldDef.type, fieldDef.field, fieldBytes);
  }

  for (const fieldDef of schema) {
    if (fieldDef.required && !(fieldDef.field in result)) {
      throw new Error(`${contextLabel}: missing required field '${fieldDef.field}'`);
    }
  }

  return result;
}

export function decodeFieldValue(type, fieldName, valueBytes) {
  if (type.startsWith('list<')) {
    const innerType = type.slice(5, -1);
    const reader = new Reader(valueBytes);
    const values = [];
    while (reader.remaining() > 0) {
      const tag = reader.readUvarint();
      const length = reader.readUvarint();
      if (Number(tag) !== 1) {
        throw new Error(`list field '${fieldName}' uses child tag ${tag} instead of 1`);
      }
      const childBytes = reader.readBytes(Number(length));
      values.push(decodeFieldValue(innerType, fieldName, childBytes));
    }
    return values;
  }

  const scalar = decodeScalar(type, fieldName, valueBytes);
  if (scalar !== null) {
    return scalar;
  }

  const nestedSchema = resolveSchemaType(type);
  if (!nestedSchema) {
    throw new Error(`unknown field type '${type}' for '${fieldName}'`);
  }
  return decodeTagBin(valueBytes, nestedSchema, fieldName);
}

export function parseFrame(frameBytes) {
  const reader = new Reader(frameBytes);
  const magic = bytesToHex(reader.readBytes(encodingSpec.magicHex.split(' ').length));
  const expectedMagic = bytesToHex(hexToBytes(encodingSpec.magicHex));
  if (magic !== expectedMagic) {
    throw new Error(`invalid magic '${magic}', expected '${expectedMagic}'`);
  }
  const versionMajor = reader.readBytes(encodingSpec.versionFieldWidthBytes)[0];
  const versionMinor = reader.readBytes(encodingSpec.versionFieldWidthBytes)[0];
  const headerLength = reader.readUvarint();
  const frameLength = reader.readUvarint();
  const frameTypeCode = Number(bytesToNumber(reader.readBytes(encodingSpec.frameTypeWidthBytes)));
  const flagsRaw = Number(bytesToNumber(reader.readBytes(encodingSpec.flagsWidthBytes)));
  const sessionId = bytesToHex(reader.readBytes(encodingSpec.sessionIdWidthBytes));
  const streamId = reader.readUvarint();
  const messageId = reader.readUvarint();
  const sequence = reader.readUvarint();
  const ackHint = reader.readUvarint();
  const priority = reader.readBytes(1)[0];
  const ttl = reader.readUvarint();
  const headerBitmap = Number(bytesToNumber(reader.readBytes(encodingSpec.headerBitmapWidthBytes)));

  const headerConsumed = reader.offset;
  const declaredHeaderLength = Number(headerLength);
  if (declaredHeaderLength < headerConsumed) {
    throw new Error(
      `headerLength ${declaredHeaderLength} shorter than fixed header ${headerConsumed}`,
    );
  }

  const optionalBytesLength = declaredHeaderLength - headerConsumed;
  const optionalReader = new Reader(reader.readBytes(optionalBytesLength));
  const sections = [];
  let lastSectionTag = 0;
  while (optionalReader.remaining() > 0) {
    const sectionStart = optionalReader.offset;
    const rawTag = optionalReader.readUvarint();
    const sectionLength = optionalReader.readUvarint();
    const sectionValue = optionalReader.readBytes(Number(sectionLength));
    const critical = (Number(rawTag) & encodingSpec.sectionCriticalBitMask) === 1;
    const sectionTag = Number(rawTag) >> encodingSpec.sectionTagShiftBits;
    if (sectionTag <= lastSectionTag) {
      throw new Error(`optional sections out of order or duplicate at tag ${sectionTag}`);
    }
    lastSectionTag = sectionTag;
    const schema = headerSectionSchemas[sectionTag];
    if (!schema && critical) {
      throw new Error(`unknown critical header section ${sectionTag}`);
    }
    const decoded = schema
      ? decodeTagBin(
        sectionValue,
        resolveSchemaType(schema.type),
        `header section ${sectionTag}`,
      )
      : null;
    sections.push({
      sectionTag,
      critical,
      length: Number(sectionLength),
      rawHex: bytesToHex(optionalReader.bytes.slice(sectionStart, optionalReader.offset)),
      valueHex: bytesToHex(sectionValue),
      decoded,
    });
  }

  for (let bit = 0; bit < encodingSpec.headerBitmapWidthBits; bit += 1) {
    const tag = bit + 1;
    const presentByBitmap = (headerBitmap & (1 << bit)) !== 0;
    const presentBySection = sections.some((section) => section.sectionTag === tag);
    if (presentByBitmap !== presentBySection) {
      throw new Error(`header bitmap mismatch for section tag ${tag}`);
    }
  }

  const payloadEnvelopeStart = reader.offset;
  const schemaLocalRevision = reader.readUvarint();
  const bodyLength = reader.readUvarint();
  const bodyBytes = reader.readBytes(Number(bodyLength));
  const authTag = reader.readBytes(reader.remaining());

  if (frameBytes.length !== Number(frameLength)) {
    throw new Error(
      `frameLength ${frameLength} does not match actual byte length ${frameBytes.length}`,
    );
  }

  const frameType = frameTypeNameByCode[frameTypeCode];
  if (!frameType) {
    throw new Error(`unknown frame type code 0x${frameTypeCode.toString(16)}`);
  }

  const schema = payloadSchemas[frameType];
  if (!schema) {
    throw new Error(
      `unsupported base-profile frame type ${frameType}: no payload schema registered`,
    );
  }

  const payload = decodeTagBin(bodyBytes, schema, `${frameType} payload`);
  const activeFlagNames = flagNames.filter((_, bit) => (flagsRaw & (1 << bit)) !== 0);
  validateHeaderSectionPolicies(sections, activeFlagNames, payload);
  validateFlagPolicies(frameType, activeFlagNames, sections, payload);

  const namedSectionViews = Object.fromEntries(
    Object.entries(namedSectionViewTags).map(([fieldName, sectionTag]) => [
      fieldName,
      sections.find((section) => section.sectionTag === sectionTag)?.decoded ?? null,
    ]),
  );

  validateCloseScopePayload(frameType, payload, namedSectionViews.finalityContext, activeFlagNames);

  return {
    magic,
    version: `${versionMajor}.${versionMinor}`,
    versionMajor,
    versionMinor,
    headerLength: Number(headerLength),
    frameLength: Number(frameLength),
    frameTypeCode,
    frameType,
    flagsRaw,
    flagNames: activeFlagNames,
    sessionId,
    streamId,
    messageId,
    sequence,
    ackHint,
    priority,
    ttl,
    headerBitmap,
    sections,
    ...namedSectionViews,
    payloadEnvelopeStart,
    schemaLocalRevision,
    bodyLength: Number(bodyLength),
    bodyHex: bytesToHex(bodyBytes),
    payload,
    authTagHex: bytesToHex(authTag),
    authTagLength: authTag.length,
  };
}

export function parsePayloadEnvelope(frameType, payloadBytes) {
  const reader = new Reader(payloadBytes);
  const schemaLocalRevision = reader.readUvarint();
  const bodyLength = reader.readUvarint();
  const bodyBytes = reader.readBytes(Number(bodyLength));
  if (reader.remaining() !== 0) {
    throw new Error(`${frameType} payload envelope has trailing bytes`);
  }
  const schema = payloadSchemas[frameType];
  if (!schema) {
    throw new Error(
      `unsupported base-profile frame type ${frameType}: no payload schema registered`,
    );
  }
  return {
    schemaLocalRevision,
    bodyLength: Number(bodyLength),
    bodyHex: bytesToHex(bodyBytes),
    payload: decodeTagBin(bodyBytes, schema, `${frameType} payload`),
  };
}

export function parseObject(objectType, objectBytes) {
  const schema = resolveSchemaType(objectType);
  if (!schema) {
    throw new Error(`no object schema registered for '${objectType}'`);
  }
  return decodeTagBin(objectBytes, schema, objectType);
}

export function parseSummaryBlock(summaryBody) {
  const result = new Map();
  for (const line of summaryBody.split('\n')) {
    const match = line.trim().match(/^([A-Za-z0-9.[\]_]+):\s+(.+?)\s*$/);
    if (!match) {
      continue;
    }
    result.set(match[1], match[2]);
  }
  return result;
}
