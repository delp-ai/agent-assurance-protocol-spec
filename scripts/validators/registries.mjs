import {
  isMainModule,
  isStructuredToken,
  listMarkdownFiles,
  loadJson,
  readText,
  requireNoProblems,
  splitListLiteral,
} from '../core/common.mjs';
import { extractRegistryEntries } from '../core/docs.mjs';
import { extractObjectBlocks } from '../core/objects.mjs';
import { generatedObjectDefinitions } from '../core/schema.mjs';

export function validateRegistries() {
  const problems = [];
  const ssot = loadJson('specs/registries.json');
  const registryMap = new Map(Object.entries(ssot.registries));
  const fieldRegistryBindings = ssot.fieldRegistryBindings ?? {};
  const fieldRegistryMap = ssot.fieldRegistryMap ?? {};

  for (const [registryId, registry] of registryMap.entries()) {
    const actualEntries = extractRegistryEntries(
      readText(registry.sourceFile),
      registry.sourceHeading,
    );
    if (!actualEntries) {
      problems.push(
        `${registry.sourceFile}: could not locate registry source '${registry.sourceHeading}' for '${registryId}'`,
      );
      continue;
    }
    const expectedSerialized = JSON.stringify(registry.entries);
    const actualSerialized = JSON.stringify(actualEntries);
    if (expectedSerialized !== actualSerialized) {
      problems.push(
        `${registry.sourceFile}: registry '${registryId}' does not exactly match SSOT '${registry.sourceHeading}'`,
      );
    }
  }

  for (const [fieldName, binding] of Object.entries(fieldRegistryBindings)) {
    if (
      [
        'explicitReference',
        'encodedRegistry',
        'genericReference',
        'conflictingExplicitReferences',
      ].includes(
        binding.strategy,
      )
      && !binding.registryId
    ) {
      problems.push(
        `specs/registries.json: field '${fieldName}' has documented registry binding but no resolved registry`,
      );
    }
    if (fieldRegistryMap[fieldName] !== binding.registryId) {
      problems.push(
        `specs/registries.json: fieldRegistryMap disagrees with fieldRegistryBindings for '${fieldName}'`,
      );
    }
  }

  for (const file of listMarkdownFiles()) {
    const content = readText(file);
    const blocks = extractObjectBlocks(content, file).filter(
      (block) =>
        block.typeName === 'Frame'
        || generatedObjectDefinitions[block.typeName]?.representations?.some(
          (representation) => representation.kind === 'typed',
        ),
    );
    for (const block of blocks) {
      for (const [field, rawValue] of Object.entries(block.fieldMap)) {
        const registryId = fieldRegistryMap[field];
        if (!registryId) {
          continue;
        }

        const registry = registryMap.get(registryId);
        if (!registry) {
          problems.push(`${file}: field '${field}' maps to missing registry '${registryId}'`);
          continue;
        }

        const allowed = new Set(registry.entries.map(([, symbol]) => symbol));
        const tokens = splitListLiteral(rawValue)
          .map((token) => token.replace(/^`|`$/g, '').replace(/,$/, '').trim())
          .filter(Boolean);

        for (const token of tokens) {
          if (isStructuredToken(token)) {
            continue;
          }
          if (/^\d+$/.test(token)) {
            problems.push(
              `${file}: field '${field}' uses raw numeric value '${token}' instead of symbolic registry value from '${registryId}'`,
            );
            continue;
          }
          if (!allowed.has(token)) {
            problems.push(
              `${file}: field '${field}' uses unknown symbolic value '${token}' not present in '${registryId}'`,
            );
          }
        }
      }
    }
  }

  return problems;
}

if (isMainModule(import.meta.url)) {
  requireNoProblems('validate.registries', validateRegistries());
}
