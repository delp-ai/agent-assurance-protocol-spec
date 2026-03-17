import { listMarkdownFiles, loadJson, readText } from './common.mjs';
import {
  collectTopLevelSections,
  extractMarkdownTables,
  findNearestTopLevelSection,
  frameTypeToPayloadType,
  loadPrimarySpecSources,
  normalizeFieldName,
  payloadTypeToFrameType,
} from './docs.mjs';

const objectHeaderPattern =
  /^(\s*)(?:([A-Za-z0-9.[\]_]+):\s+)?([A-Z][A-Za-z0-9]*)(?:\(([^)]*)\))?\s*\{\s*$/;
const scalarFieldPattern = /^\s*([A-Za-z0-9.[\]_]+):\s+(.+?)\s*$/;
const outlineFieldPattern = /^\s*([A-Za-z0-9.[\]_]+(?:\[\])?)\s*$/;
const structuredFieldPattern = /^\s*([A-Za-z0-9.[\]_]+)\s*\{\s*$/;

function isClosingLine(line) {
  return /^\s*}\s*$/.test(line);
}

function collectBracketedValue(lines, startIndex, openingToken, closingToken) {
  const parts = [openingToken];
  let depth = 1;
  let index = startIndex + 1;

  while (index < lines.length) {
    const line = lines[index].trim();
    parts.push(line);
    if (line === openingToken) {
      depth += 1;
    } else if (line === closingToken) {
      depth -= 1;
      if (depth === 0) {
        return {
          value: parts.join('\n'),
          endIndex: index,
        };
      }
    }
    index += 1;
  }

  return {
    value: parts.join('\n'),
    endIndex: lines.length - 1,
  };
}

function countUnquotedDelimiters(source) {
  let inQuote = false;
  let braces = 0;
  let brackets = 0;
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
      braces += 1;
    } else if (char === '}') {
      braces -= 1;
    } else if (char === '[') {
      brackets += 1;
    } else if (char === ']') {
      brackets -= 1;
    }
  }
  return { braces, brackets };
}

function collectStructuredValue(lines, startIndex, initialValue) {
  const parts = [initialValue];
  let { braces, brackets } = countUnquotedDelimiters(initialValue);
  let index = startIndex + 1;

  while (index < lines.length && (braces > 0 || brackets > 0)) {
    const line = lines[index].trim();
    parts.push(line);
    const counts = countUnquotedDelimiters(line);
    braces += counts.braces;
    brackets += counts.brackets;
    index += 1;
  }

  return {
    value: parts.join('\n'),
    endIndex: index - 1,
  };
}

function safeJsonCompare(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildRegistryLookups() {
  const byField = new Map();
  const registriesSpec = loadJson('artifacts/registries.json');
  for (const [fieldName, registryId] of Object.entries(registriesSpec.fieldRegistryMap ?? {})) {
    if (!registryId) {
      continue;
    }
    const registry = registriesSpec.registries?.[registryId];
    if (!registry) {
      continue;
    }
    byField.set(fieldName, new Set((registry.entries ?? []).map(([, symbol]) => String(symbol))));
  }
  return byField;
}

export const objectRegistrySymbols = buildRegistryLookups();

function flattenChildren(objectNode, output) {
  output.push(objectNode);
  for (const child of objectNode.children) {
    flattenChildren(child, output);
  }
}

function finalizeObjectNode(node) {
  node.fieldMap = Object.fromEntries(node.scalarFields.map((field) => [field.name, field.value]));
  node.fieldNames = node.scalarFields.map((field) => field.name);
  node.outlineNames = node.outlineFields.map((field) => normalizeFieldName(field));
  node.representation = node.scalarFields.length > 0 ? 'literal' : 'outline';
  return node;
}

function parseObjectAt(lines, startIndex, context) {
  const headerMatch = lines[startIndex].match(objectHeaderPattern);
  if (!headerMatch) {
    return null;
  }

  const node = {
    file: context.file,
    fenceIndex: context.fenceIndex,
    typeName: headerMatch[3],
    fieldName: headerMatch[2] ?? null,
    label: headerMatch[4] ?? null,
    startLine: startIndex + 1,
    endLine: startIndex + 1,
    scalarFields: [],
    outlineFields: [],
    children: [],
  };

  let index = startIndex + 1;
  while (index < lines.length) {
    const line = lines[index];
    if (isClosingLine(line)) {
      node.endLine = index + 1;
      return { node: finalizeObjectNode(node), endIndex: index };
    }

    const nested = parseObjectAt(lines, index, context);
    if (nested) {
      node.children.push(nested.node);
      index = nested.endIndex + 1;
      continue;
    }

    const scalarField = line.match(scalarFieldPattern);
    if (scalarField) {
      const rawValue = scalarField[2].trim();
      const counts = countUnquotedDelimiters(rawValue);
      if (counts.braces > 0 || counts.brackets > 0) {
        const collected = collectStructuredValue(lines, index, rawValue);
        node.scalarFields.push({
          name: normalizeFieldName(scalarField[1]),
          value: collected.value,
        });
        index = collected.endIndex + 1;
        continue;
      }
      if (rawValue === '[') {
        const collected = collectBracketedValue(lines, index, '[', ']');
        node.scalarFields.push({
          name: normalizeFieldName(scalarField[1]),
          value: collected.value,
        });
        index = collected.endIndex + 1;
        continue;
      }
      if (rawValue === '{') {
        const collected = collectBracketedValue(lines, index, '{', '}');
        node.scalarFields.push({
          name: normalizeFieldName(scalarField[1]),
          value: collected.value,
        });
        index = collected.endIndex + 1;
        continue;
      }
      node.scalarFields.push({
        name: normalizeFieldName(scalarField[1]),
        value: rawValue,
      });
      index += 1;
      continue;
    }

    const structuredField = line.match(structuredFieldPattern);
    if (structuredField) {
      const collected = collectBracketedValue(lines, index, '{', '}');
      node.scalarFields.push({
        name: normalizeFieldName(structuredField[1]),
        value: collected.value,
      });
      index = collected.endIndex + 1;
      continue;
    }

    const outlineField = line.match(outlineFieldPattern);
    if (outlineField && line.trim()) {
      node.outlineFields.push(outlineField[1].trim());
    }
    index += 1;
  }

  node.endLine = lines.length;
  return { node: finalizeObjectNode(node), endIndex: lines.length - 1 };
}

export function extractObjectBlocks(content, file = '<memory>') {
  const blocks = [];
  const fencePattern = /^```text\n([\s\S]*?)^```/gm;
  let fenceIndex = 0;

  for (const match of content.matchAll(fencePattern)) {
    const body = match[1];
    const lines = body.split('\n');
    const context = { file, fenceIndex };
    let index = 0;
    while (index < lines.length) {
      const parsed = parseObjectAt(lines, index, context);
      if (!parsed) {
        index += 1;
        continue;
      }
      flattenChildren(parsed.node, blocks);
      index = parsed.endIndex + 1;
    }
    fenceIndex += 1;
  }

  return blocks;
}

function simplifyTypedEntries(entries) {
  return entries.map((entry) => [entry.tag, entry.field, entry.type, entry.required ? 1 : 0]);
}

function addDefinitionRepresentation(definitions, typeName, representation) {
  const existing = definitions[typeName] ?? {
    representations: [],
  };
  const alreadyPresent = existing.representations.some((candidate) =>
    safeJsonCompare(candidate, representation)
  );
  if (!alreadyPresent) {
    existing.representations.push(representation);
  }
  definitions[typeName] = existing;
}

function hasTypedRepresentation(definition) {
  return definition?.representations?.some((representation) => representation.kind === 'typed');
}

export function extractTypedDefinitionsFromDocs() {
  const sources = loadPrimarySpecSources();
  const wireTables = extractMarkdownTables(sources.wire.content);
  const canonicalContent = sources.canonical.content;
  const canonicalTables = extractMarkdownTables(canonicalContent);
  const canonicalSections = collectTopLevelSections(canonicalContent);

  const payloads = {};
  const compositeTypes = {};
  for (const [heading, entries] of wireTables.entries()) {
    if (heading.endsWith('Body')) {
      payloads[payloadTypeToFrameType(heading)] = entries;
    } else {
      compositeTypes[heading] = entries;
    }
  }

  const commonTypes = {};
  const objects = {};
  for (const [heading, entries] of canonicalTables.entries()) {
    const lineNumber = canonicalContent
      .split('\n')
      .findIndex((line) => line.match(/^#{1,6}\s+(.*)$/)?.[1]?.replace(/`/g, '').trim() === heading)
      + 1;
    const section = findNearestTopLevelSection(canonicalSections, lineNumber);
    if (section === 'Common Composite Types') {
      commonTypes[heading] = entries;
    } else {
      objects[heading] = entries;
    }
  }

  const definitions = {};
  for (
    const [typeName, entries] of Object.entries({
      ...Object.fromEntries(
        Object.entries(compositeTypes).map(([name, value]) => [name, value ?? []]),
      ),
      ...Object.fromEntries(
        Object.entries(payloads).map((
          [frameType, value],
        ) => [frameTypeToPayloadType(frameType), value ?? []]),
      ),
      ...Object.fromEntries(
        Object.entries(commonTypes).map(([name, value]) => [name, value ?? []]),
      ),
      ...Object.fromEntries(Object.entries(objects).map(([name, value]) => [name, value ?? []])),
    })
  ) {
    addDefinitionRepresentation(definitions, typeName, {
      kind: 'typed',
      fields: simplifyTypedEntries(entries),
      outline: entries.map((entry) => entry.field),
    });
  }

  return {
    compositeTypes,
    payloads,
    commonTypes,
    objects,
    definitions,
  };
}

function splitSimpleList(rawValue) {
  const trimmed = rawValue.trim();
  if (!(trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return null;
  }
  const body = trimmed.slice(1, -1).trim();
  if (!body) {
    return [];
  }
  if (body.includes('{') || body.includes('(')) {
    return null;
  }
  return body
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function inferScalarKind(fieldName, value) {
  if (value === 'true' || value === 'false') {
    return 'bool';
  }
  if (/^\d+$/.test(value)) {
    return 'integer';
  }
  if (/^sha256:[A-Za-z0-9._-]+$/.test(value)) {
    return 'digest';
  }
  if (/^(?:[0-9A-Fa-f]{2})(?:\s+[0-9A-Fa-f]{2})+$/.test(value)) {
    return 'bytes';
  }
  if (objectRegistrySymbols.has(fieldName) && objectRegistrySymbols.get(fieldName).has(value)) {
    return 'registry';
  }
  if (value.startsWith('{') && value.endsWith('}')) {
    return 'inlineObject';
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    const items = splitSimpleList(value);
    if (items === null) {
      return 'list';
    }
    const innerKinds = [...new Set(items.map((item) => inferScalarKind(fieldName, item)))];
    return innerKinds.length === 1 ? `list:${innerKinds[0]}` : 'list';
  }
  return 'text';
}

function mergeKinds(currentKind, nextKind) {
  if (!currentKind) {
    return nextKind;
  }
  if (currentKind === nextKind) {
    return currentKind;
  }
  return 'text';
}

function buildObservedDefinitions(existingDefinitions) {
  const definitions = { ...existingDefinitions };
  const byType = new Map();

  for (const file of listMarkdownFiles()) {
    const content = readText(file);
    const blocks = extractObjectBlocks(content, file);
    for (const block of blocks) {
      const record = byType.get(block.typeName) ?? [];
      record.push(block);
      byType.set(block.typeName, record);
    }
  }

  for (
    const [typeName, blocks] of [...byType.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    )
  ) {
    if (hasTypedRepresentation(existingDefinitions[typeName])) {
      continue;
    }

    const literalBlocks = blocks.filter((block) => block.representation === 'literal');
    const outlineBlocks = blocks.filter((block) => block.representation === 'outline');

    if (literalBlocks.length > 0) {
      const fieldKinds = {};
      for (const block of literalBlocks) {
        for (const field of block.scalarFields) {
          const nextKind = inferScalarKind(field.name, field.value);
          fieldKinds[field.name] = mergeKinds(fieldKinds[field.name], nextKind);
        }
      }

      addDefinitionRepresentation(definitions, typeName, {
        kind: 'literal',
        variants: [
          ...new Map(
            literalBlocks.map((block) => [
              JSON.stringify(block.fieldNames),
              block.fieldNames,
            ]),
          ).values(),
        ],
        fieldKinds,
        sourceFiles: [...new Set(literalBlocks.map((block) => block.file))].sort(),
      });
    }

    if (outlineBlocks.length > 0) {
      addDefinitionRepresentation(definitions, typeName, {
        kind: 'outline',
        variants: [
          ...new Map(
            outlineBlocks.map((block) => [
              JSON.stringify(block.outlineNames),
              block.outlineNames,
            ]),
          ).values(),
        ],
        sourceFiles: [...new Set(outlineBlocks.map((block) => block.file))].sort(),
      });
    }
  }

  return definitions;
}

export function buildObjectSyncState() {
  const typed = extractTypedDefinitionsFromDocs();
  const definitions = buildObservedDefinitions(typed.definitions);

  return {
    generatedObjects: {
      definitions,
    },
  };
}
