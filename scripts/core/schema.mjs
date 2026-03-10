import { loadJson } from './common.mjs';
import { frameTypeToPayloadType } from './docs.mjs';

export const protocolSpec = loadJson('specs/protocol.json');
export const registriesSpec = loadJson('specs/registries.json');
export const generatedObjectsSpec = loadJson('specs/objects.json');

function expandFieldTable(encodedTable) {
  return encodedTable.map(([tag, field, type, required]) => ({
    tag,
    field,
    type,
    required: Boolean(required),
  }));
}

function expandTables(tableMap) {
  return Object.fromEntries(
    Object.entries(tableMap).map(([typeName, encodedTable]) => [
      typeName,
      expandFieldTable(encodedTable),
    ]),
  );
}

function toLowerCamelCase(value) {
  return value.length > 0 ? value[0].toLowerCase() + value.slice(1) : value;
}

function buildRegistryLookups() {
  const byField = new Map();
  for (const [fieldName, registryId] of Object.entries(registriesSpec.fieldRegistryMap)) {
    if (!registryId) {
      continue;
    }
    const registry = registriesSpec.registries[registryId];
    if (!registry) {
      continue;
    }
    const forward = new Map();
    const reverse = new Map();
    registry.entries.forEach(([code, symbol]) => {
      if (forward.has(symbol)) {
        throw new Error(`registry '${registryId}' reuses symbol '${symbol}'`);
      }
      if (reverse.has(code)) {
        throw new Error(`registry '${registryId}' reuses numeric code '${code}'`);
      }
      forward.set(symbol, code);
      reverse.set(code, symbol);
    });
    byField.set(fieldName, {
      registryId,
      forward,
      reverse,
      symbols: new Set(registry.entries.map(([, symbol]) => String(symbol))),
    });
  }
  return byField;
}

export const encodingSpec = protocolSpec.wire.encoding ?? {};
export const flagNames = protocolSpec.wire.flagNames ?? [];
export const registryLookups = buildRegistryLookups();
export const generatedObjectDefinitions = generatedObjectsSpec.definitions ?? {};

export const compositeSchemas = {
  ...expandTables(protocolSpec.wire.compositeTypes),
  ...expandTables(protocolSpec.canonical.commonTypes),
};

export const payloadTypeByFrameType = Object.fromEntries(
  Object.keys(protocolSpec.wire.payloads).map((frameType) => [
    frameType,
    frameTypeToPayloadType(frameType),
  ]),
);

export const payloadHeadingByFrameType = payloadTypeByFrameType;
export const frameTypeByPayloadHeading = Object.fromEntries(
  Object.entries(payloadTypeByFrameType).map(([frameType, heading]) => [heading, frameType]),
);

export const payloadSchemas = Object.fromEntries(
  Object.entries(protocolSpec.wire.payloads).map(([frameType, encodedTable]) => [
    frameType,
    expandFieldTable(encodedTable),
  ]),
);

export const objectSchemas = expandTables(protocolSpec.canonical.objects);

export const frameTypeCodeMap = Object.fromEntries(
  protocolSpec.wire.frameTypes.map(([code, name]) => [name, code]),
);
export const frameTypeNameByCode = Object.fromEntries(
  protocolSpec.wire.frameTypes.map(([code, name]) => [code, name]),
);
export const frameTypeNames = new Set(protocolSpec.wire.frameTypes.map(([, name]) => name));

export const headerSectionDefinitions = Object.fromEntries(
  protocolSpec.wire.headerSections.map(([tag, name, purpose, type]) => [
    tag,
    {
      tag,
      name,
      purpose,
      type,
      policy: protocolSpec.wire.headerSectionPolicies?.[name] ?? null,
    },
  ]),
);
export const headerSectionTagByName = Object.fromEntries(
  Object.values(headerSectionDefinitions).map((definition) => [definition.name, definition.tag]),
);
export const namedSectionViewTags = Object.fromEntries(
  Object.entries(encodingSpec.namedSectionViews ?? {}).map(([fieldName, sectionName]) => [
    fieldName,
    headerSectionTagByName[sectionName],
  ]),
);

export const headerSectionSchemas = Object.fromEntries(
  Object.entries(headerSectionDefinitions)
    .filter(([, definition]) => definition.type)
    .map(([tag, definition]) => [tag, { name: definition.name, type: definition.type }]),
);

export const typeAliases = {
  ...(protocolSpec.canonical.aliases ?? {}),
  ...Object.fromEntries(Object.keys(compositeSchemas).map((typeName) => [typeName, typeName])),
  ...Object.fromEntries(
    Object.keys(compositeSchemas).map((typeName) => [toLowerCamelCase(typeName), typeName]),
  ),
  ...Object.fromEntries(Object.keys(objectSchemas).map((typeName) => [typeName, typeName])),
  ...Object.fromEntries(
    Object.keys(objectSchemas).map((typeName) => [toLowerCamelCase(typeName), typeName]),
  ),
  ...Object.fromEntries(
    Object.entries(payloadTypeByFrameType).map(([, payloadType]) => [payloadType, payloadType]),
  ),
};

export function resolveSchemaType(type) {
  const resolvedType = typeAliases[type] ?? type;
  return compositeSchemas[resolvedType] ?? objectSchemas[resolvedType]
    ?? payloadSchemas[resolvedType] ?? null;
}
