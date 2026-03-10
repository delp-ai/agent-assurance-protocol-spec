import {
  isMainModule,
  listMarkdownFiles,
  loadJson,
  readText,
  requireNoProblems,
  splitListLiteral,
} from '../core/common.mjs';
import {
  extractMarkdownTableBlockAfterHeading,
  loadPrimarySpecSources,
  normalizeFieldName,
  normalizeHeadingName,
} from '../core/docs.mjs';
import { buildObjectSyncState, extractObjectBlocks } from '../core/objects.mjs';
import { frameTypeNames, generatedObjectDefinitions, registryLookups } from '../core/schema.mjs';

const bytesSpec = loadJson('specs/bytes.json');
const byteAliasTokens = new Set(Object.keys(bytesSpec.aliasBindings ?? {}));

const registrySymbolsByField = new Map();
for (const [fieldName, lookup] of registryLookups.entries()) {
  if (!lookup) {
    continue;
  }
  registrySymbolsByField.set(fieldName, lookup.symbols);
}

function getDefinition(typeName) {
  return generatedObjectDefinitions[typeName] ?? null;
}

function getTypedRepresentation(definition) {
  return definition?.representations?.find((representation) => representation.kind === 'typed')
    ?? null;
}

function getLiteralRepresentation(definition) {
  return definition?.representations?.find((representation) => representation.kind === 'literal')
    ?? null;
}

function getOutlineRepresentation(definition) {
  return definition?.representations?.find((representation) => representation.kind === 'outline')
    ?? null;
}

function isDigest(value) {
  return /^sha256:[A-Za-z0-9._-]+$/.test(value);
}

function isBoolean(value) {
  return value === 'true' || value === 'false';
}

function isInteger(value) {
  return /^\d+$/.test(value) || /^[0-9A-F]+$/.test(value);
}

function isByteString(value) {
  return (
    /^(?:[0-9A-Fa-f]{2})(?:\s+[0-9A-Fa-f]{2})*$/.test(value)
    || /^sig\.[A-Za-z0-9._-]+$/.test(value)
    || /^nonce\.[A-Za-z0-9._-]+$/.test(value)
    || /^embedded\(.+\)$/.test(value)
    || /^hex:[A-Za-z0-9._-]+$/.test(value)
  );
}

function isVersionString(value) {
  return /^\d+\.\d+$/.test(value);
}

function inferListItems(rawValue) {
  const items = splitListLiteral(rawValue);
  if (items.length === 1 && items[0] === rawValue.trim()) {
    return null;
  }
  return items;
}

function validateInferredKind(rawValue, inferredKind) {
  switch (inferredKind) {
    case 'bool':
      return isBoolean(rawValue);
    case 'integer':
      return isInteger(rawValue);
    case 'digest':
      return isDigest(rawValue);
    case 'bytes':
      return isByteString(rawValue) || rawValue.trim().length > 0;
    case 'registry':
      return true;
    case 'inlineObject':
      return rawValue.startsWith('{') && rawValue.endsWith('}');
    case 'list':
      return rawValue.startsWith('[') && rawValue.endsWith(']');
    case 'list:bool': {
      const items = inferListItems(rawValue);
      return items !== null && items.every(isBoolean);
    }
    case 'list:integer': {
      const items = inferListItems(rawValue);
      return items !== null && items.every(isInteger);
    }
    case 'list:digest': {
      const items = inferListItems(rawValue);
      return items !== null && items.every(isDigest);
    }
    case 'list:text':
      return rawValue.startsWith('[') && rawValue.endsWith(']');
    default:
      return rawValue.trim().length > 0;
  }
}

function validateScalarValue(fieldName, fieldType, rawValue) {
  const registrySymbols = registrySymbolsByField.get(fieldName);
  if (registrySymbols) {
    const numericRegistryTypes = new Set(['u16', 'u32', 'u64', 'uvarint']);
    if (
      registrySymbols.has(rawValue) && (fieldType === 'text' || numericRegistryTypes.has(fieldType))
    ) {
      return true;
    }
    if (isInteger(rawValue) && numericRegistryTypes.has(fieldType)) {
      return true;
    }
  }

  if (fieldName === 'FrameType') {
    return frameTypeNames.has(rawValue);
  }

  if (fieldName === 'Version' || fieldName === 'negotiatedWireVersion') {
    return isVersionString(rawValue);
  }

  switch (fieldType) {
    case 'text':
      return rawValue.trim().length > 0;
    case 'digest':
      return isDigest(rawValue);
    case 'bool':
      return isBoolean(rawValue);
    case 'bytes':
      return isByteString(rawValue);
    case 'u8':
    case 'u16':
    case 'u32':
    case 'u64':
    case 'uvarint':
      return isInteger(rawValue);
    default:
      return rawValue.trim().length > 0;
  }
}

function validateTypedField(problems, block, fieldName, fieldType, rawValue) {
  if (
    block.file === 'conformances/09.BYTE.CORPUS.md'
    && fieldType === 'digest'
    && (byteAliasTokens.has(rawValue) || /^[A-Za-z0-9]+$/.test(rawValue))
  ) {
    return;
  }

  if (fieldType.startsWith('list<')) {
    if (!(rawValue.startsWith('[') && rawValue.endsWith(']'))) {
      problems.push(
        `${block.file}:${block.typeName}: field '${fieldName}' must be a list literal in text objects`,
      );
      return;
    }
    return;
  }

  if (!validateScalarValue(fieldName, fieldType, rawValue)) {
    problems.push(
      `${block.file}:${block.typeName}: field '${fieldName}' has invalid value '${rawValue}' for type '${fieldType}'`,
    );
  }
}

function validateTypedBlock(block, typedRepresentation, literalRepresentation, problems) {
  const entries = typedRepresentation.fields.map(([tag, field, type, required]) => ({
    tag,
    field,
    type,
    required: required === 1,
  }));

  if (block.representation === 'outline') {
    const expectedOutline = typedRepresentation.outline;
    if (JSON.stringify(block.outlineNames) !== JSON.stringify(expectedOutline)) {
      problems.push(
        `${block.file}:${block.typeName}: declared field order does not match typed schema`,
      );
    }
    return;
  }

  const fieldMap = new Map(entries.map((entry) => [entry.field, entry]));
  const matchedLiteralVariant = literalRepresentation?.variants?.find(
    (variant) => JSON.stringify(variant) === JSON.stringify(block.fieldNames),
  );
  const literalFieldKinds = literalRepresentation?.fieldKinds ?? {};

  for (const required of entries.filter((entry) => entry.required)) {
    if (!block.fieldMap[required.field]) {
      problems.push(`${block.file}:${block.typeName}: missing required field '${required.field}'`);
    }
  }

  for (const fieldName of block.fieldNames) {
    if (!fieldMap.has(fieldName)) {
      if (matchedLiteralVariant && literalFieldKinds[fieldName]) {
        if (!validateInferredKind(block.fieldMap[fieldName], literalFieldKinds[fieldName])) {
          problems.push(
            `${block.file}:${block.typeName}: field '${fieldName}' has invalid value '${
              block.fieldMap[fieldName]
            }' for inferred kind '${literalFieldKinds[fieldName]}'`,
          );
        }
        continue;
      }
      problems.push(`${block.file}:${block.typeName}: unknown field '${fieldName}'`);
      continue;
    }
    const entry = fieldMap.get(fieldName);
    validateTypedField(problems, block, fieldName, entry.type, block.fieldMap[fieldName]);
  }
}

function validateLiteralBlock(block, literalRepresentation, problems) {
  const variantStrings = literalRepresentation.variants.map((variant) => JSON.stringify(variant));
  const actualVariant = JSON.stringify(block.fieldNames);
  if (!variantStrings.includes(actualVariant)) {
    problems.push(
      `${block.file}:${block.typeName}: field set ${actualVariant} does not match any known variant`,
    );
  }

  for (const [fieldName, rawValue] of Object.entries(block.fieldMap)) {
    const inferredKind = literalRepresentation.fieldKinds?.[fieldName];
    if (!inferredKind) {
      problems.push(`${block.file}:${block.typeName}: unknown field '${fieldName}'`);
      continue;
    }
    if (!validateInferredKind(rawValue, inferredKind)) {
      problems.push(
        `${block.file}:${block.typeName}: field '${fieldName}' has invalid value '${rawValue}' for inferred kind '${inferredKind}'`,
      );
    }
  }
}

function validateOutlineBlock(block, outlineRepresentation, problems) {
  const variantStrings = outlineRepresentation.variants.map((variant) => JSON.stringify(variant));
  const actualVariant = JSON.stringify(block.outlineNames);
  if (!variantStrings.includes(actualVariant)) {
    problems.push(
      `${block.file}:${block.typeName}: outline fields ${actualVariant} do not match any known declaration`,
    );
  }
}

function buildOrderedUniqueListPolicies() {
  const canonicalSource = loadPrimarySpecSources().canonical;
  const policies = new Map();

  for (const typeName of Object.keys(generatedObjectDefinitions)) {
    const tableBlock = extractMarkdownTableBlockAfterHeading(canonicalSource.content, typeName);
    if (!tableBlock) {
      continue;
    }
    const normalizedHeaders = tableBlock.headers.map((header) => normalizeHeadingName(header));
    const noteIndex = normalizedHeaders.indexOf('Notes');
    const fieldIndex = normalizedHeaders.indexOf('Field');
    if (noteIndex === -1 || fieldIndex === -1) {
      continue;
    }
    for (const row of tableBlock.rows) {
      const notes = row[noteIndex] ?? '';
      if (!/ascending unique/i.test(notes)) {
        continue;
      }
      const rawFieldName = row[fieldIndex] ?? '';
      policies.set(`${typeName}.${normalizeFieldName(rawFieldName)}`, 'ascendingUnique');
    }
  }

  return policies;
}

const orderedUniqueListPolicies = buildOrderedUniqueListPolicies();

function validateOrderedUniqueLists(block, problems) {
  for (const [fieldName, rawValue] of Object.entries(block.fieldMap)) {
    const policy = orderedUniqueListPolicies.get(`${block.typeName}.${fieldName}`);
    if (!policy) {
      continue;
    }
    const items = splitListLiteral(rawValue);
    if (items.length === 1 && items[0] === rawValue.trim()) {
      continue;
    }
    const uniqueItems = new Set(items);
    if (uniqueItems.size !== items.length) {
      problems.push(
        `${block.file}:${block.typeName}: field '${fieldName}' must use ${policy} ordering but contains duplicates`,
      );
      continue;
    }
    const sortedItems = [...items].sort((left, right) => left.localeCompare(right));
    if (JSON.stringify(items) !== JSON.stringify(sortedItems)) {
      problems.push(
        `${block.file}:${block.typeName}: field '${fieldName}' must use ${policy} ordering`,
      );
    }
  }
}

function validateCustomObjectSemantics(block, problems) {
  validateOrderedUniqueLists(block, problems);

  if (/TimeoutResolution$/.test(block.typeName)) {
    const candidateFields = Object.keys(block.fieldMap).filter((fieldName) =>
      /(?:^resulting[A-Z].*Digest$)|(?:^absenceProofDigest$)/.test(fieldName)
    );
    if (candidateFields.length === 0) {
      problems.push(
        `${block.file}:${block.typeName}: timeout resolution must reference at least one resulting artifact digest`,
      );
    }
  }
}

export function validateObjectBlocks() {
  const problems = [];
  const regeneratedDefinitions = buildObjectSyncState().generatedObjects.definitions;
  if (JSON.stringify(regeneratedDefinitions) !== JSON.stringify(generatedObjectDefinitions)) {
    problems.push(
      'specs/objects.json: generated object metadata is stale; run `node scripts/specs/objects.mjs --write`',
    );
    return problems;
  }

  for (const file of listMarkdownFiles()) {
    const blocks = extractObjectBlocks(readText(file), file);
    for (const block of blocks) {
      const definition = getDefinition(block.typeName);
      if (!definition) {
        problems.push(
          `${file}:${block.typeName}: missing object definition in specs/protocol.json`,
        );
        continue;
      }

      const typedRepresentation = getTypedRepresentation(definition);
      if (typedRepresentation) {
        validateTypedBlock(
          block,
          typedRepresentation,
          getLiteralRepresentation(definition),
          problems,
        );
        validateCustomObjectSemantics(block, problems);
        continue;
      }

      if (block.representation === 'literal') {
        const literalRepresentation = getLiteralRepresentation(definition);
        if (!literalRepresentation) {
          problems.push(
            `${file}:${block.typeName}: no literal representation is registered for this object`,
          );
          continue;
        }
        validateLiteralBlock(block, literalRepresentation, problems);
        validateCustomObjectSemantics(block, problems);
        continue;
      }

      const outlineRepresentation = getOutlineRepresentation(definition);
      if (!outlineRepresentation) {
        problems.push(
          `${file}:${block.typeName}: no outline representation is registered for this object`,
        );
        continue;
      }
      validateOutlineBlock(block, outlineRepresentation, problems);
      validateCustomObjectSemantics(block, problems);
    }
  }

  return problems;
}

if (isMainModule(import.meta.url)) {
  requireNoProblems('validate.objects', validateObjectBlocks());
}
