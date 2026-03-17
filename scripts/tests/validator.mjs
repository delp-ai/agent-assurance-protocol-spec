import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { listMarkdownFiles, readText, repoRoot } from '../core/common.mjs';
import { loadPrimarySpecSources, normalizeFieldName } from '../core/docs.mjs';
import { extractObjectBlocks } from '../core/objects.mjs';
import { generatedObjectDefinitions, registryLookups } from '../core/schema.mjs';

const generatedSpecScripts = ['protocol', 'registries', 'objects', 'bytes', 'bindings'];

function run(cwd, command, args) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
  });
}

function assertSuccess(result, label) {
  if (result.status === 0) {
    return;
  }
  throw new Error(
    `${label} failed with exit code ${result.status ?? 1}\n${(result.stdout ?? '').trim()}\n${
      (result.stderr ?? '').trim()
    }`.trim(),
  );
}

function copyRepo(targetDirectory) {
  fs.cpSync(repoRoot, targetDirectory, {
    recursive: true,
    filter: (source) => {
      const baseName = path.basename(source);
      return baseName !== '.git' && baseName !== 'node_modules';
    },
  });
}

function replaceOnce(filePath, oldText, newText) {
  const original = fs.readFileSync(filePath, 'utf8');
  if (!original.includes(oldText)) {
    throw new Error(`replacement target not found in ${filePath}`);
  }
  fs.writeFileSync(filePath, original.replace(oldText, newText), 'utf8');
}

function countOccurrences(content, needle) {
  return content.split(needle).length - 1;
}

function syncGeneratedSpecs(repoDirectory) {
  for (const script of generatedSpecScripts) {
    const result = run(repoDirectory, process.execPath, [
      `scripts/artifacts/${script}.mjs`,
      '--write',
    ]);
    assertSuccess(result, `sync ${script}`);
  }
}

function validateSsot(repoDirectory) {
  return run(repoDirectory, process.execPath, ['scripts/validators/index.mjs']);
}

function collectInterestingLines(result) {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith('validate:') || line.startsWith('- '))
    .slice(0, 20);
}

function assertFailureContains(result, expectedSubstrings, label) {
  if (result.status === 0) {
    throw new Error(`${label} unexpectedly passed validation`);
  }

  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  for (const expected of expectedSubstrings) {
    if (!combined.includes(expected)) {
      throw new Error(
        `${label} failed, but did not contain expected text: ${expected}\n${
          collectInterestingLines(result).join('\n')
        }`,
      );
    }
  }
}

function getTypedRepresentation(typeName) {
  return generatedObjectDefinitions[typeName]?.representations?.find(
    (representation) => representation.kind === 'typed',
  ) ?? null;
}

function listScenarioObjectBlocks() {
  return listMarkdownFiles()
    .filter(
      (file) =>
        file.startsWith('conformances/')
        && file !== 'conformances/README.md'
        && file !== 'conformances/09.BYTE.CORPUS.md'
        && file !== 'conformances/10.BYTE.TRANSCRIPTS.md',
    )
    .flatMap((file) => extractObjectBlocks(readText(file), file))
    .filter((block) => getTypedRepresentation(block.typeName));
}

function findCanonicalTable(typeName) {
  const canonicalSource = loadPrimarySpecSources().canonical;
  const lines = canonicalSource.content.split('\n');
  const headingPattern = new RegExp(`^#{1,6}\\s+\`?${typeName}\`?$`);
  const headingIndex = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (headingIndex === -1) {
    throw new Error(`missing canonical heading for ${typeName}`);
  }

  const rowLines = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      if (rowLines.length > 0) {
        break;
      }
      continue;
    }
    if (line.trim().startsWith('|')) {
      rowLines.push(line);
      continue;
    }
    if (rowLines.length > 0) {
      break;
    }
  }

  const rows = rowLines.slice(2).map((line) => {
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    return {
      line,
      tag: Number(cells[0]),
      field: normalizeFieldName(cells[1].replace(/`/g, '')),
      type: cells[2].replace(/`/g, ''),
      required: cells[3] === 'yes',
    };
  });

  return {
    sourceFile: canonicalSource.file,
    rows,
  };
}

function buildUniqueScalarLine(block, field) {
  return `  ${field.name}: ${field.value}`;
}

function chooseTypedBlockCandidate() {
  for (const block of listScenarioObjectBlocks()) {
    if (block.scalarFields.length === 0) {
      continue;
    }
    const anchorField = block.scalarFields.find((field) => {
      const candidateLine = buildUniqueScalarLine(block, field);
      return countOccurrences(readText(block.file), candidateLine) === 1;
    });
    if (!anchorField) {
      continue;
    }

    const canonicalTable = findCanonicalTable(block.typeName);
    if (canonicalTable.rows.length === 0) {
      continue;
    }

    return {
      block,
      anchorField,
      canonicalTable,
    };
  }

  throw new Error('could not find typed conformance block candidate');
}

function chooseRegistryValueCandidate() {
  for (const block of listScenarioObjectBlocks()) {
    const typedRepresentation = getTypedRepresentation(block.typeName);
    const typedFields = new Map(
      typedRepresentation.fields.map(([tag, field, type, required]) => [
        field,
        { tag, field, type, required: required === 1 },
      ]),
    );

    for (const field of block.scalarFields) {
      const typedField = typedFields.get(field.name);
      const lookup = registryLookups.get(field.name);
      const line = buildUniqueScalarLine(block, field);
      if (
        !typedField
        || typedField.type !== 'u16'
        || !lookup
        || !lookup.symbols.has(field.value)
        || countOccurrences(readText(block.file), line) !== 1
      ) {
        continue;
      }

      const canonicalTable = findCanonicalTable(block.typeName);
      const canonicalRow = canonicalTable.rows.find((row) => row.field === field.name);
      if (
        !canonicalRow
        || countOccurrences(readText(canonicalTable.sourceFile), canonicalRow.line) !== 1
      ) {
        continue;
      }

      return {
        block,
        field,
        canonicalTable,
        canonicalRow,
      };
    }
  }

  throw new Error('could not find registry-backed conformance field candidate');
}

function buildMutationCases() {
  const registryCandidate = chooseRegistryValueCandidate();
  const typedBlockCandidate = chooseTypedBlockCandidate();
  const renamedField = `${registryCandidate.field.name}Mutation`;
  const addedField = 'mutationRequiredField';
  const unknownField = 'protocolGhostField';
  const unknownRegistryValue = 'mutationUnknownRegistrySymbol';
  const lastRow = typedBlockCandidate.canonicalTable.rows.at(-1);
  const nextTag = Math.max(...typedBlockCandidate.canonicalTable.rows.map((row) => row.tag)) + 1;
  const requiredFieldRow = `| ${nextTag}   | \`${addedField}\` | \`bytes\` | yes      |`;

  return [
    {
      id: 'spec-field-type-change',
      description: 'Changing a canonical field type should invalidate corpus usage after resync.',
      mutate(repoDirectory) {
        replaceOnce(
          path.join(repoDirectory, registryCandidate.canonicalTable.sourceFile),
          registryCandidate.canonicalRow.line,
          registryCandidate.canonicalRow.line.replace('`u16`', '`digest`'),
        );
      },
      expectedSubstrings: [
        `field '${registryCandidate.field.name}' has invalid value '${registryCandidate.field.value}' for type 'digest'`,
      ],
    },
    {
      id: 'spec-field-rename',
      description:
        'Renaming a canonical field should invalidate unchanged conformances after resync.',
      mutate(repoDirectory) {
        replaceOnce(
          path.join(repoDirectory, registryCandidate.canonicalTable.sourceFile),
          registryCandidate.canonicalRow.line,
          registryCandidate.canonicalRow.line.replace(
            `\`${registryCandidate.field.name}\``,
            `\`${renamedField}\``,
          ),
        );
      },
      expectedSubstrings: [
        `missing required field '${renamedField}'`,
        `unknown field '${registryCandidate.field.name}'`,
      ],
    },
    {
      id: 'spec-required-field-added',
      description:
        'Adding a required canonical field should invalidate corpus objects after resync.',
      mutate(repoDirectory) {
        replaceOnce(
          path.join(repoDirectory, typedBlockCandidate.canonicalTable.sourceFile),
          lastRow.line,
          `${lastRow.line}\n${requiredFieldRow}`,
        );
      },
      expectedSubstrings: [`missing required field '${addedField}'`],
    },
    {
      id: 'conformance-unknown-field',
      description: 'Injecting a non-protocol field into conformance must be rejected after resync.',
      mutate(repoDirectory) {
        const anchorLine = buildUniqueScalarLine(
          typedBlockCandidate.block,
          typedBlockCandidate.anchorField,
        );
        replaceOnce(
          path.join(repoDirectory, typedBlockCandidate.block.file),
          anchorLine,
          `  ${unknownField}: shouldFail\n${anchorLine}`,
        );
      },
      expectedSubstrings: [`unknown field '${unknownField}'`],
    },
    {
      id: 'conformance-unknown-registry-symbol',
      description:
        'Injecting an unknown registry symbol into conformance must be rejected after resync.',
      mutate(repoDirectory) {
        const anchorLine = buildUniqueScalarLine(registryCandidate.block, registryCandidate.field);
        replaceOnce(
          path.join(repoDirectory, registryCandidate.block.file),
          anchorLine,
          `  ${registryCandidate.field.name}: ${unknownRegistryValue}`,
        );
      },
      expectedSubstrings: [`unknown symbolic value '${unknownRegistryValue}'`],
    },
  ];
}

function runMutationCase(tempRoot, testCase) {
  const repoDirectory = path.join(tempRoot, testCase.id);
  copyRepo(repoDirectory);
  testCase.mutate(repoDirectory);
  syncGeneratedSpecs(repoDirectory);
  const result = validateSsot(repoDirectory);
  assertFailureContains(result, testCase.expectedSubstrings, testCase.id);
  return {
    id: testCase.id,
    description: testCase.description,
    status: 'ok',
    interesting: collectInterestingLines(result),
  };
}

function main() {
  const baseline = validateSsot(repoRoot);
  assertSuccess(baseline, 'baseline validate:ssot');
  const mutationCases = buildMutationCases();

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aap-validator'));
  const results = [];

  try {
    for (const testCase of mutationCases) {
      results.push(runMutationCase(tempRoot, testCase));
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log(`validator: ${results.length} case(s) passed`);
  for (const result of results) {
    console.log(`- ${result.id}: ${result.description}`);
  }
}

main();
