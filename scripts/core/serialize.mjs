import { encodeUvarint, hexToBytes } from './parser.mjs';
import {
  encodingSpec,
  frameTypeCodeMap,
  headerSectionSchemas,
  payloadSchemas,
  protocolSpec,
  registryLookups,
  resolveSchemaType,
} from './schema.mjs';

function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function numberToBytes(valueInput, width) {
  let value = BigInt(valueInput);
  const result = new Uint8Array(width);
  for (let index = width - 1; index >= 0; index -= 1) {
    result[index] = Number(value & 0xffn);
    value >>= 8n;
  }
  if (value !== 0n) {
    throw new Error(`value ${valueInput} does not fit in ${width} bytes`);
  }
  return result;
}

function encodeHexLikeString(rawValue) {
  const compact = String(rawValue).trim().replace(/\s+/g, '');
  if (!/^[0-9A-Fa-f]+$/.test(compact) || compact.length % 2 !== 0) {
    throw new Error(`invalid hex literal '${rawValue}'`);
  }
  return hexToBytes(compact.match(/../g).join(' '));
}

function resolveNumericValue(fieldName, value) {
  if (typeof value === 'number' || typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  const text = String(value).trim();
  const registry = registryLookups.get(fieldName);
  if (registry?.forward.has(text)) {
    return registry.forward.get(text);
  }
  if (/^0x[0-9A-Fa-f]+$/.test(text)) {
    return Number.parseInt(text.slice(2), 16);
  }
  if (/^[0-9A-Fa-f]+$/.test(text) && /[A-Fa-f]/.test(text)) {
    return Number.parseInt(text, 16);
  }
  if (!/^\d+$/.test(text)) {
    throw new Error(
      `field '${fieldName}' expected integer or registry symbol but found '${value}'`,
    );
  }
  return Number(text);
}

function encodeScalar(type, fieldName, value) {
  switch (type) {
    case 'text':
      return Buffer.from(String(value), 'utf8');
    case 'bytes':
    case 'digest':
      return value instanceof Uint8Array ? value : encodeHexLikeString(value);
    case 'bool':
      if (typeof value !== 'boolean') {
        throw new Error(`field '${fieldName}' expected boolean`);
      }
      return Uint8Array.of(value ? 1 : 0);
    case 'u8':
      return numberToBytes(resolveNumericValue(fieldName, value), 1);
    case 'u16':
      return numberToBytes(resolveNumericValue(fieldName, value), 2);
    case 'u32':
      return numberToBytes(resolveNumericValue(fieldName, value), 4);
    case 'u64':
      return numberToBytes(resolveNumericValue(fieldName, value), 8);
    case 'uvarint':
      return encodeUvarint(resolveNumericValue(fieldName, value));
    default:
      return null;
  }
}

export function encodeFieldValue(type, fieldName, value) {
  if (type.startsWith('list<')) {
    if (!Array.isArray(value)) {
      throw new Error(`field '${fieldName}' expected list value`);
    }
    const innerType = type.slice(5, -1);
    return concatBytes(
      ...value.map((item) => {
        const childBytes = encodeFieldValue(innerType, fieldName, item);
        return concatBytes(encodeUvarint(1), encodeUvarint(childBytes.length), childBytes);
      }),
    );
  }

  const scalar = encodeScalar(type, fieldName, value);
  if (scalar !== null) {
    return scalar;
  }

  const nestedSchema = resolveSchemaType(type);
  if (!nestedSchema) {
    throw new Error(`unknown field type '${type}' for '${fieldName}'`);
  }
  return encodeTagBin(value, nestedSchema, fieldName);
}

export function encodeTagBin(value, schema, contextLabel = 'tagbin') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${contextLabel}: expected object value`);
  }

  const knownFields = new Set(schema.map((entry) => entry.field));
  for (const fieldName of Object.keys(value)) {
    if (!knownFields.has(fieldName)) {
      throw new Error(`${contextLabel}: unknown field '${fieldName}'`);
    }
  }

  const fieldBytes = [];
  for (const entry of schema) {
    const fieldValue = value[entry.field];
    if (fieldValue === undefined) {
      if (entry.required) {
        throw new Error(`${contextLabel}: missing required field '${entry.field}'`);
      }
      continue;
    }
    const encodedValue = encodeFieldValue(entry.type, entry.field, fieldValue);
    fieldBytes.push(
      concatBytes(encodeUvarint(entry.tag), encodeUvarint(encodedValue.length), encodedValue),
    );
  }
  return concatBytes(...fieldBytes);
}

function validateCloseScopePayload(frameType, payload, sections) {
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
    if (payload[fieldName] === undefined) {
      throw new Error(
        `CLOSE payload: missing required field '${fieldName}' for closeScope '${scope}'`,
      );
    }
  }

  for (const fieldName of profile[`${scopeKey}ForbiddenFields`] ?? []) {
    if (payload[fieldName] !== undefined) {
      throw new Error(`CLOSE payload: field '${fieldName}' is forbidden for closeScope '${scope}'`);
    }
  }

  const finalityContextTag = Object.entries(headerSectionSchemas)
    .find(([, definition]) =>
      definition.name === protocolSpec.workflow.closeBindingProfile?.closeSectionType
    )?.[0];
  const hasFinalityContext = sections.some((section) =>
    String(section.sectionTag) === finalityContextTag
  );
  const requiresFinalityContext = profile[`${scopeKey}RequiresFinalityContext`] === true;
  if (requiresFinalityContext && !hasFinalityContext) {
    throw new Error(`CLOSE payload: closeScope '${scope}' requires FinalityContext`);
  }
  if (!requiresFinalityContext && hasFinalityContext) {
    throw new Error(`CLOSE payload: closeScope '${scope}' must not carry FinalityContext`);
  }
}

export function serializePayloadEnvelope(
  frameType,
  payload,
  schemaLocalRevision = encodingSpec.payloadEnvelope.defaultSchemaLocalRevision,
) {
  const schema = payloadSchemas[frameType];
  if (!schema) {
    throw new Error(`no payload schema registered for frame type ${frameType}`);
  }
  const bodyBytes = encodeTagBin(payload, schema, `${frameType} payload`);
  return concatBytes(
    encodeUvarint(schemaLocalRevision),
    encodeUvarint(bodyBytes.length),
    bodyBytes,
  );
}

export function serializeObject(objectType, objectValue) {
  const schema = resolveSchemaType(objectType);
  if (!schema) {
    throw new Error(`no object schema registered for '${objectType}'`);
  }
  return encodeTagBin(objectValue, schema, objectType);
}

export function serializeHeaderSection(sectionTag, decodedValue, critical = false, rawHex = null) {
  const schema = headerSectionSchemas[sectionTag];
  if (!schema) {
    if (rawHex) {
      return hexToBytes(rawHex);
    }
    throw new Error(`no schema registered for header section ${sectionTag}`);
  }
  const valueBytes = encodeTagBin(
    decodedValue,
    resolveSchemaType(schema.type),
    `header section ${sectionTag}`,
  );
  const rawTag = (sectionTag << encodingSpec.sectionTagShiftBits)
    | (critical ? encodingSpec.sectionCriticalBitMask : 0);
  return concatBytes(encodeUvarint(rawTag), encodeUvarint(valueBytes.length), valueBytes);
}

export function serializeFrame(frame) {
  validateCloseScopePayload(frame.frameType, frame.payload, frame.sections ?? []);
  const optionalSectionBytes = concatBytes(
    ...frame.sections.map((section) =>
      serializeHeaderSection(section.sectionTag, section.decoded, section.critical, section.rawHex)
    ),
  );
  const payloadEnvelope = serializePayloadEnvelope(
    frame.frameType,
    frame.payload,
    frame.schemaLocalRevision,
  );
  const authTagBytes = frame.authTagHex
    ? hexToBytes(frame.authTagHex)
    : new Uint8Array(frame.authTagLength ?? 0);
  const headerBitmap = frame.sections.reduce(
    (bitmap, section) => bitmap | (1 << (section.sectionTag - 1)),
    0,
  );
  if (frame.headerBitmap !== undefined && frame.headerBitmap !== headerBitmap) {
    throw new Error(
      `frame header bitmap ${frame.headerBitmap} does not match serialized bitmap ${headerBitmap}`,
    );
  }

  const streamIdBytes = encodeUvarint(frame.streamId);
  const messageIdBytes = encodeUvarint(frame.messageId);
  const sequenceBytes = encodeUvarint(frame.sequence);
  const ackHintBytes = encodeUvarint(frame.ackHint);
  const ttlBytes = encodeUvarint(frame.ttl);
  const sessionIdBytes = hexToBytes(frame.sessionId);
  const frameTypeCode = frame.frameTypeCode ?? frameTypeCodeMap[frame.frameType];
  if (!frameTypeCode) {
    throw new Error(`unknown frame type '${frame.frameType}'`);
  }

  let headerLength = 0;
  let frameLength = 0;
  for (let attempts = 0; attempts < 8; attempts += 1) {
    const candidateHeader = concatBytes(
      hexToBytes(frame.magic ?? encodingSpec.magicHex),
      Uint8Array.of(frame.versionMajor, frame.versionMinor),
      encodeUvarint(headerLength),
      encodeUvarint(frameLength),
      numberToBytes(frameTypeCode, encodingSpec.frameTypeWidthBytes),
      numberToBytes(frame.flagsRaw, encodingSpec.flagsWidthBytes),
      sessionIdBytes,
      streamIdBytes,
      messageIdBytes,
      sequenceBytes,
      ackHintBytes,
      Uint8Array.of(frame.priority),
      ttlBytes,
      numberToBytes(headerBitmap, encodingSpec.headerBitmapWidthBytes),
      optionalSectionBytes,
    );
    const nextHeaderLength = candidateHeader.length;
    const nextFrameLength = nextHeaderLength + payloadEnvelope.length + authTagBytes.length;
    if (nextHeaderLength === headerLength && nextFrameLength === frameLength) {
      break;
    }
    headerLength = nextHeaderLength;
    frameLength = nextFrameLength;
  }

  return concatBytes(
    hexToBytes(frame.magic ?? encodingSpec.magicHex),
    Uint8Array.of(frame.versionMajor, frame.versionMinor),
    encodeUvarint(headerLength),
    encodeUvarint(frameLength),
    numberToBytes(frameTypeCode, encodingSpec.frameTypeWidthBytes),
    numberToBytes(frame.flagsRaw, encodingSpec.flagsWidthBytes),
    sessionIdBytes,
    streamIdBytes,
    messageIdBytes,
    sequenceBytes,
    ackHintBytes,
    Uint8Array.of(frame.priority),
    ttlBytes,
    numberToBytes(headerBitmap, encodingSpec.headerBitmapWidthBytes),
    optionalSectionBytes,
    payloadEnvelope,
    authTagBytes,
  );
}
