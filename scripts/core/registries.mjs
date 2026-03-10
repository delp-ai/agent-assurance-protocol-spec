import { listMarkdownFiles, readText, splitListLiteral } from './common.mjs';
import {
  collectRegistryHeadings,
  extractFieldRegistryReferences,
  extractRegistryEntries,
  listPrimarySpecFiles,
  specNamespaceForFile,
} from './docs.mjs';
import { extractObjectBlocks, extractTypedDefinitionsFromDocs } from './objects.mjs';

function normalizeRegistryLocalName(sourceHeading) {
  const cleaned = sourceHeading
    .replace(/[`]/g, '')
    .replace(/registry:?$/i, '')
    .replace(/registry\s+is:?$/i, '')
    .replace(/must be one of$/i, '')
    .replace(/modes$/i, ' mode')
    .replace(/rules$/i, ' rule')
    .replace(/statuses$/i, ' status')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim();

  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return 'unknown';
  }
  return parts
    .map((part, index) => {
      const normalized = part[0].toUpperCase() + part.slice(1);
      return index === 0 ? normalized[0].toLowerCase() + normalized.slice(1) : normalized;
    })
    .join('');
}

function tokenizeObservedValue(rawValue) {
  return splitListLiteral(rawValue)
    .map((token) => token.replace(/^`|`$/g, '').replace(/^"(.*)"$/, '$1').trim())
    .filter(
      (token) =>
        token
        && !/^\d+$/.test(token)
        && !/^0x[0-9A-Fa-f]+$/.test(token)
        && !/^[0-9A-Fa-f]{2}(?:\s+[0-9A-Fa-f]{2})*$/.test(token)
        && !token.startsWith('sha256:')
        && !token.startsWith('{')
        && !token.startsWith('[')
        && !token.startsWith('"')
        && token !== 'true'
        && token !== 'false',
    );
}

function isRegistryCandidateField(fieldName, type) {
  if (/(Bitmap|Mask|Flags)$/i.test(fieldName)) {
    return false;
  }
  if (['u8', 'u16', 'u32', 'u64', 'uvarint'].includes(type)) {
    return true;
  }
  if (type.startsWith('list<') && type.endsWith('>')) {
    return isRegistryCandidateField(fieldName, type.slice(5, -1));
  }
  return false;
}

function collectFieldTypes(typed) {
  const candidates = new Map();

  for (
    const schemaGroup of [
      typed.compositeTypes,
      typed.payloads,
      typed.commonTypes,
      typed.objects,
    ]
  ) {
    for (const entries of Object.values(schemaGroup)) {
      for (const entry of entries) {
        if (!isRegistryCandidateField(entry.field, entry.type)) {
          continue;
        }
        const record = candidates.get(entry.field) ?? new Set();
        record.add(entry.type);
        candidates.set(entry.field, record);
      }
    }
  }

  return candidates;
}

function collectObservedTokensByField() {
  const observedTokensByField = new Map();

  for (const file of listMarkdownFiles()) {
    for (const block of extractObjectBlocks(readText(file), file)) {
      for (const [fieldName, rawValue] of Object.entries(block.fieldMap)) {
        const tokens = tokenizeObservedValue(rawValue);
        if (tokens.length === 0) {
          continue;
        }
        const current = observedTokensByField.get(fieldName) ?? new Set();
        tokens.forEach((token) => current.add(token));
        observedTokensByField.set(fieldName, current);
      }
    }
  }

  return observedTokensByField;
}

function buildRegistryLookupIndexes(registries) {
  const byHeading = new Map();
  const byLocalName = new Map();
  const entries = [];

  for (const [registryId, registry] of Object.entries(registries)) {
    byHeading.set(registry.sourceHeading, registryId);
    byLocalName.set(normalizeRegistryLocalName(registry.sourceHeading), registryId);
    entries.push({
      registryId,
      sourceHeading: registry.sourceHeading,
      normalizedHeading: normalizeRegistryLocalName(registry.sourceHeading),
    });
  }

  return { byHeading, byLocalName, entries };
}

function tokenizeHint(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function resolveRegistryIdFromHint(registries, registryHint) {
  const { byHeading, byLocalName, entries } = buildRegistryLookupIndexes(registries);
  const exact = byHeading.get(registryHint)
    ?? byLocalName.get(normalizeRegistryLocalName(registryHint));
  if (exact) {
    return exact;
  }

  const hintTokens = tokenizeHint(registryHint);
  const candidates = entries
    .filter((entry) => {
      const haystack = `${entry.sourceHeading} ${entry.normalizedHeading}`;
      const haystackTokens = new Set(tokenizeHint(haystack));
      return hintTokens.every((token) => haystackTokens.has(token) || haystack.includes(token));
    })
    .map((entry) => entry.registryId);

  return candidates.length === 1 ? candidates[0] : null;
}

function collectExplicitFieldRegistryBindings(registries) {
  const referencesByField = new Map();

  for (const file of listPrimarySpecFiles()) {
    const content = readText(file);
    for (const reference of extractFieldRegistryReferences(content)) {
      const current = referencesByField.get(reference.fieldName) ?? [];
      current.push({
        ...reference,
        sourceFile: file,
        registryId: reference.registryHint
          ? resolveRegistryIdFromHint(registries, reference.registryHint)
          : null,
      });
      referencesByField.set(reference.fieldName, current);
    }
  }

  return referencesByField;
}

function inferFieldRegistryBindings(registries) {
  const registryEntriesById = Object.fromEntries(
    Object.entries(registries).map(([registryId, registry]) => [
      registryId,
      new Set(registry.entries.map(([, symbol]) => symbol)),
    ]),
  );

  const typed = extractTypedDefinitionsFromDocs();
  const fieldTypes = collectFieldTypes(typed);
  const observedTokensByField = collectObservedTokensByField();
  const explicitBindings = collectExplicitFieldRegistryBindings(registries);
  const bindings = {};
  const candidateFieldNames = new Set([
    ...fieldTypes.keys(),
    ...explicitBindings.keys(),
  ]);

  for (const fieldName of candidateFieldNames) {
    const candidateTypes = fieldTypes.get(fieldName) ?? new Set();
    const observedTokens = [...(observedTokensByField.get(fieldName) ?? new Set())].sort();
    const explicitReferences = explicitBindings.get(fieldName) ?? [];
    const resolvedExplicitIds = [
      ...new Set(
        explicitReferences.map((reference) => reference.registryId).filter(Boolean),
      ),
    ];

    if (resolvedExplicitIds.length === 1) {
      bindings[fieldName] = {
        registryId: resolvedExplicitIds[0],
        strategy: explicitReferences[0].strategy,
        evidence: explicitReferences.map((reference) =>
          `${reference.sourceFile}: ${reference.registryHint || 'unnamed registry reference'}`
        ),
        observedTokens,
        candidateTypes: [...candidateTypes].sort(),
      };
      continue;
    }

    if (resolvedExplicitIds.length > 1) {
      bindings[fieldName] = {
        registryId: null,
        strategy: 'conflictingExplicitReferences',
        evidence: explicitReferences.map((reference) =>
          `${reference.sourceFile}: ${reference.registryHint || 'unnamed registry reference'}`
        ),
        observedTokens,
        candidateTypes: [...candidateTypes].sort(),
      };
      continue;
    }

    const numericCandidate = [...candidateTypes].some((type) =>
      isRegistryCandidateField(fieldName, type)
    );
    if (!numericCandidate) {
      bindings[fieldName] = {
        registryId: null,
        strategy: explicitReferences.length > 0 ? explicitReferences[0].strategy : 'unbound',
        evidence: explicitReferences.map((reference) =>
          `${reference.sourceFile}: ${reference.registryHint || 'unnamed registry reference'}`
        ),
        observedTokens,
        candidateTypes: [...candidateTypes].sort(),
      };
      continue;
    }

    const localName = normalizeRegistryLocalName(fieldName);
    const nameMatch = Object.keys(registries).find((registryId) =>
      registryId.endsWith(`.${localName}`)
    );
    if (nameMatch) {
      bindings[fieldName] = {
        registryId: nameMatch,
        strategy: 'headingName',
        evidence: [fieldName],
        observedTokens,
        candidateTypes: [...candidateTypes].sort(),
      };
      continue;
    }

    const candidates = Object.entries(registryEntriesById)
      .filter(([, symbols]) =>
        observedTokens.length > 0 && observedTokens.every((token) => symbols.has(token))
      )
      .map(([registryId]) => registryId);

    if (candidates.length === 1) {
      bindings[fieldName] = {
        registryId: candidates[0],
        strategy: 'observedTokens',
        evidence: observedTokens,
        observedTokens,
        candidateTypes: [...candidateTypes].sort(),
      };
      continue;
    }

    bindings[fieldName] = {
      registryId: null,
      strategy: explicitReferences.length > 0 ? explicitReferences[0].strategy : 'unbound',
      evidence: explicitReferences.map((reference) =>
        `${reference.sourceFile}: ${reference.registryHint || 'unnamed registry reference'}`
      ),
      observedTokens,
      candidateTypes: [...candidateTypes].sort(),
    };
  }

  return Object.fromEntries(
    Object.entries(bindings).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function flattenFieldRegistryMap(bindings) {
  return Object.fromEntries(
    Object.entries(bindings).map(([fieldName, binding]) => [fieldName, binding.registryId]),
  );
}

export function buildRegistriesState() {
  const registries = {};

  for (const file of listPrimarySpecFiles()) {
    const namespace = specNamespaceForFile(file);
    if (!namespace) {
      continue;
    }
    const content = readText(file);
    for (const sourceHeading of collectRegistryHeadings(content)) {
      const entries = extractRegistryEntries(content, sourceHeading);
      if (!entries) {
        continue;
      }
      const registryId = `${namespace}.${normalizeRegistryLocalName(sourceHeading)}`;
      registries[registryId] = {
        sourceFile: file,
        sourceHeading,
        entries,
      };
    }
  }

  const fieldRegistryBindings = inferFieldRegistryBindings(registries);

  return {
    agentManagementMode: 'agent-native',
    registries,
    fieldRegistryBindings,
    fieldRegistryMap: flattenFieldRegistryMap(fieldRegistryBindings),
  };
}
