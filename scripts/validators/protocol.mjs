import { isMainModule, requireNoProblems } from '../core/common.mjs';
import { extractSchemaAliasReferences, loadPrimarySpecSources } from '../core/docs.mjs';
import { extractTypedDefinitionsFromDocs } from '../core/objects.mjs';
import { buildProtocolState } from '../core/protocol.mjs';
import { payloadHeadingByFrameType, protocolSpec } from '../core/schema.mjs';

function encodeExtractedTable(entries) {
  return entries?.map((entry) => [
    entry.tag,
    entry.field,
    entry.type,
    entry.required ? 1 : 0,
  ]);
}

const scalarTypes = new Set([
  'text',
  'bytes',
  'digest',
  'bool',
  'u8',
  'u16',
  'u32',
  'u64',
  'uvarint',
]);

function toLowerCamelCase(value) {
  return value.length > 0 ? value[0].toLowerCase() + value.slice(1) : value;
}

function validateTypeReference(typeName, knownTypes) {
  if (scalarTypes.has(typeName)) {
    return true;
  }
  if (typeName.startsWith('list<') && typeName.endsWith('>')) {
    return validateTypeReference(typeName.slice(5, -1), knownTypes);
  }
  return knownTypes.has(typeName) || Boolean(protocolSpec.canonical.aliases?.[typeName]);
}

function validateTypedEntries(problems, label, entries, knownTypes) {
  if (!entries || entries.length === 0) {
    problems.push(`${label}: missing typed field table`);
    return;
  }

  const seenTags = new Set();
  const seenFields = new Set();
  for (const entry of entries) {
    if (seenTags.has(entry.tag)) {
      problems.push(`${label}: duplicate tag '${entry.tag}'`);
    }
    seenTags.add(entry.tag);

    if (seenFields.has(entry.field)) {
      problems.push(`${label}: duplicate field '${entry.field}'`);
    }
    seenFields.add(entry.field);

    if (!validateTypeReference(entry.type, knownTypes)) {
      problems.push(`${label}: unknown field type '${entry.type}' for '${entry.field}'`);
    }
  }
}

function compareAliasMap(problems, actual, expected) {
  const normalizedActual = Object.fromEntries(
    Object.entries(actual).sort(([left], [right]) => left.localeCompare(right)),
  );
  const normalizedExpected = Object.fromEntries(
    Object.entries(expected).sort(([left], [right]) => left.localeCompare(right)),
  );
  if (JSON.stringify(normalizedActual) !== JSON.stringify(normalizedExpected)) {
    problems.push('specs/protocol.json:canonical aliases do not match documented alias rules');
  }
}

function compareTable(problems, label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    problems.push(`${label}: regenerated state does not exactly match SSOT`);
  }
}

function compareObject(problems, label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    problems.push(`${label}: regenerated state does not exactly match SSOT`);
  }
}

export function validateProtocolSsot() {
  const problems = [];
  const sources = loadPrimarySpecSources();
  const wireSource = sources.wire;
  const canonicalSource = sources.canonical;
  const canonicalLabel = (detail) => `${canonicalSource.file}:${detail}`;
  const typedDocs = extractTypedDefinitionsFromDocs();
  const regeneratedProtocol = buildProtocolState();
  const knownTypes = new Set([
    ...Object.keys(typedDocs.compositeTypes),
    ...Object.keys(typedDocs.commonTypes),
    ...Object.keys(typedDocs.objects),
    ...Object.keys(typedDocs.payloads).map((frameType) => payloadHeadingByFrameType[frameType]),
    ...Object.keys(typedDocs.compositeTypes).map((typeName) => toLowerCamelCase(typeName)),
    ...Object.keys(typedDocs.commonTypes).map((typeName) => toLowerCamelCase(typeName)),
    ...Object.keys(typedDocs.objects).map((typeName) => toLowerCamelCase(typeName)),
  ]);

  compareObject(problems, 'specs/protocol.json', protocolSpec, regeneratedProtocol);

  for (const [tag, name, , type] of protocolSpec.wire.headerSections) {
    if (!type) {
      problems.push(
        `specs/protocol.json: header section '${name}' (tag ${tag}) missing schema link`,
      );
      continue;
    }
    if (!protocolSpec.wire.compositeTypes[type]) {
      problems.push(
        `specs/protocol.json: header section '${name}' (tag ${tag}) references unknown composite type '${type}'`,
      );
    }
    if (!protocolSpec.wire.headerSectionPolicies?.[name]) {
      problems.push(`specs/protocol.json: header section '${name}' (tag ${tag}) missing policy`);
    }
  }

  const documentedAliases = Object.fromEntries(
    extractSchemaAliasReferences(canonicalSource.content, canonicalSource.file)
      .filter(
        (reference) =>
          typedDocs.commonTypes[reference.target] || typedDocs.compositeTypes[reference.target]
          || typedDocs.objects[reference.target],
      )
      .map((reference) => [reference.alias, reference.target]),
  );
  for (const typeName of Object.keys(typedDocs.commonTypes)) {
    documentedAliases[typeName[0].toLowerCase() + typeName.slice(1)] = typeName;
  }
  compareAliasMap(problems, protocolSpec.canonical.aliases ?? {}, documentedAliases);

  compareTable(
    problems,
    'specs/protocol.json:wire composite types',
    protocolSpec.wire.compositeTypes,
    Object.fromEntries(
      Object.entries(typedDocs.compositeTypes).map(([typeName, entries]) => [
        typeName,
        encodeExtractedTable(entries),
      ]),
    ),
  );
  compareTable(
    problems,
    'specs/protocol.json:wire payload types',
    protocolSpec.wire.payloads,
    Object.fromEntries(
      Object.entries(typedDocs.payloads).map(([frameType, entries]) => [
        frameType,
        encodeExtractedTable(entries),
      ]),
    ),
  );
  compareTable(
    problems,
    'specs/protocol.json:canonical common types',
    protocolSpec.canonical.commonTypes,
    Object.fromEntries(
      Object.entries(typedDocs.commonTypes).map(([typeName, entries]) => [
        typeName,
        encodeExtractedTable(entries),
      ]),
    ),
  );
  compareTable(
    problems,
    'specs/protocol.json:canonical objects',
    protocolSpec.canonical.objects,
    Object.fromEntries(
      Object.entries(typedDocs.objects).map(([typeName, entries]) => [
        typeName,
        encodeExtractedTable(entries),
      ]),
    ),
  );

  for (const [typeName, entries] of Object.entries(typedDocs.compositeTypes)) {
    validateTypedEntries(problems, `${wireSource.file}:${typeName}`, entries, knownTypes);
  }
  for (const [frameType, entries] of Object.entries(typedDocs.payloads)) {
    validateTypedEntries(
      problems,
      `${wireSource.file}:${payloadHeadingByFrameType[frameType]}`,
      entries,
      knownTypes,
    );
  }
  for (const [typeName, entries] of Object.entries(typedDocs.commonTypes)) {
    validateTypedEntries(problems, `${canonicalSource.file}:${typeName}`, entries, knownTypes);
  }
  for (const [typeName, entries] of Object.entries(typedDocs.objects)) {
    validateTypedEntries(problems, `${canonicalSource.file}:${typeName}`, entries, knownTypes);
  }

  return problems;
}

if (isMainModule(import.meta.url)) {
  requireNoProblems('validate.protocol', validateProtocolSsot());
}
