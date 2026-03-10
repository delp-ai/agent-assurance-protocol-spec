import { listFiles, readText } from './common.mjs';

export function normalizeHeadingName(name) {
  return name.replace(/`/g, '').trim();
}

export function normalizeFieldName(name) {
  const normalized = name.replace(/`/g, '').replace(/\[\]$/, '').trim();
  const parts = normalized.split('.');
  return parts[parts.length - 1];
}

export function frameTypeToPayloadType(frameType) {
  return frameType
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('') + 'Body';
}

export function payloadTypeToFrameType(payloadType) {
  return payloadType
    .replace(/Body$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toUpperCase();
}

export function listPrimarySpecFiles() {
  return listFiles('.', (relativePath) => /^\d+\.[A-Z0-9.]+\.md$/.test(relativePath));
}

export function specNamespaceForFile(file) {
  if (!/^\d+\.[A-Z0-9.]+\.md$/.test(file)) {
    return null;
  }
  const parts = file.replace(/\.md$/, '').split('.');
  return parts[1]?.toLowerCase() ?? null;
}

export function loadPrimarySpecSources() {
  const sources = {};
  for (const file of listPrimarySpecFiles()) {
    const namespace = specNamespaceForFile(file);
    if (!namespace) {
      continue;
    }
    if (sources[namespace]) {
      throw new Error(
        `duplicate primary spec namespace '${namespace}' in '${file}' and '${
          sources[namespace].file
        }'`,
      );
    }
    sources[namespace] = {
      file,
      namespace,
      content: readText(file),
    };
  }
  return sources;
}

function findHeadingIndex(lines, headingText) {
  const target = normalizeHeadingName(headingText);
  for (let index = 0; index < lines.length; index += 1) {
    const headingMatch = lines[index].match(/^#{1,6}\s+(.*)$/);
    if (headingMatch && normalizeHeadingName(headingMatch[1]) === target) {
      return index;
    }
  }
  return -1;
}

export function extractHeadingBody(content, headingText) {
  const lines = content.split('\n');
  const headingIndex = findHeadingIndex(lines, headingText);
  if (headingIndex === -1) {
    return null;
  }

  const start = headingIndex + 1;
  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    if (/^#{1,6}\s+/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

export function extractListAfterHeading(content, headingText) {
  const lines = content.split('\n');
  const headingIndex = findHeadingIndex(lines, headingText);
  const startIndex = headingIndex === -1 ? -1 : headingIndex + 1;

  if (startIndex === -1) {
    return null;
  }

  const items = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      if (items.length > 0) {
        break;
      }
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      break;
    }
    const match = line.match(/^- `?([^`]+?)`?$/);
    if (match) {
      items.push(match[1]);
      continue;
    }
    if (items.length > 0) {
      break;
    }
  }

  return items;
}

export function extractMarkdownTableBlockAfterHeading(content, headingText) {
  const lines = content.split('\n');
  const headingIndex = findHeadingIndex(lines, headingText);

  if (headingIndex === -1) {
    return null;
  }

  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }
    if (!line.startsWith('|')) {
      if (/^#{1,6}\s+/.test(line)) {
        return null;
      }
      continue;
    }

    const rows = [];
    let cursor = index;
    while (cursor < lines.length && lines[cursor].trim().startsWith('|')) {
      rows.push(
        lines[cursor]
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim()),
      );
      cursor += 1;
    }
    return {
      headers: rows[0] ?? [],
      rows: rows.filter((cells, rowIndex) => rowIndex > 1),
    };
  }

  return null;
}

export function extractMarkdownTableAfterHeading(content, headingText) {
  return extractMarkdownTableBlockAfterHeading(content, headingText)?.rows ?? null;
}

export function extractKeyValueTableAfterHeading(content, headingText) {
  const rows = extractMarkdownTableAfterHeading(content, headingText);
  if (!rows) {
    return null;
  }
  return Object.fromEntries(
    rows.map(([key, value]) => [normalizeHeadingName(key), normalizeHeadingName(value)]),
  );
}

function normalizeHeaderRow(headers) {
  return headers.map((header) => normalizeHeadingName(header));
}

function collectHeadingArtifacts(source) {
  const lines = source.content.split('\n');
  const artifacts = [];
  for (let index = 0; index < lines.length; index += 1) {
    const headingMatch = lines[index].match(/^#{1,6}\s+(.*)$/);
    if (!headingMatch) {
      continue;
    }
    const sourceHeading = normalizeHeadingName(headingMatch[1]);
    artifacts.push({
      sourceFile: source.file,
      sourceHeading,
      tableBlock: extractMarkdownTableBlockAfterHeading(source.content, sourceHeading),
      keyValueTable: extractKeyValueTableAfterHeading(source.content, sourceHeading),
      list: extractListAfterHeading(source.content, sourceHeading),
    });
  }
  return artifacts;
}

function resolveUniqueArtifact(source, predicate, description) {
  const matches = collectHeadingArtifacts(source).filter(predicate);
  if (matches.length !== 1) {
    throw new Error(
      `${source.file}: expected exactly one ${description} section but found ${matches.length}`,
    );
  }
  return matches[0];
}

export function findUniqueTableSection(source, { headers, predicate, description }) {
  const expectedHeaders = headers ? normalizeHeaderRow(headers) : null;
  return resolveUniqueArtifact(
    source,
    (artifact) => {
      if (!artifact.tableBlock) {
        return false;
      }
      if (
        expectedHeaders
        && JSON.stringify(normalizeHeaderRow(artifact.tableBlock.headers))
          !== JSON.stringify(expectedHeaders)
      ) {
        return false;
      }
      return predicate ? predicate(artifact.tableBlock, artifact) : true;
    },
    description,
  );
}

export function findUniqueKeyValueSection(source, { requiredKeys, description }) {
  const normalizedKeys = requiredKeys.map((key) => normalizeHeadingName(key));
  return resolveUniqueArtifact(
    source,
    (artifact) => {
      if (!artifact.keyValueTable) {
        return false;
      }
      const actualKeys = new Set(
        Object.keys(artifact.keyValueTable).map((key) => normalizeHeadingName(key)),
      );
      return normalizedKeys.every((key) => actualKeys.has(key));
    },
    description,
  );
}

export function findUniqueListSection(source, { predicate, description }) {
  return resolveUniqueArtifact(
    source,
    (artifact) => Array.isArray(artifact.list) && predicate(artifact.list, artifact),
    description,
  );
}

export function queryUniqueSection(source, query) {
  if (query.kind === 'headingBody') {
    const body = extractHeadingBody(source.content, query.heading);
    if (body === null) {
      throw new Error(`${source.file}: missing ${query.description}`);
    }
    return {
      sourceFile: source.file,
      sourceHeading: query.heading,
      value: body,
    };
  }

  if (query.kind === 'table') {
    const section = findUniqueTableSection(source, {
      headers: query.headers,
      description: query.description,
      predicate: (tableBlock, artifact) => {
        if (query.requiredFirstColumnValues) {
          const firstColumnValues = new Set(
            tableBlock.rows.map((cells) => normalizeHeadingName(cells[0] ?? '')),
          );
          if (
            !query.requiredFirstColumnValues.every((value) =>
              firstColumnValues.has(normalizeHeadingName(value))
            )
          ) {
            return false;
          }
        }
        return query.predicate ? query.predicate(tableBlock, artifact) : true;
      },
    });
    return {
      sourceFile: section.sourceFile,
      sourceHeading: section.sourceHeading,
      value: query.includeHeaders ? section.tableBlock : section.tableBlock.rows,
    };
  }

  if (query.kind === 'keyValue') {
    const section = findUniqueKeyValueSection(source, {
      requiredKeys: query.requiredKeys ?? [],
      description: query.description,
    });
    return {
      sourceFile: section.sourceFile,
      sourceHeading: section.sourceHeading,
      value: section.keyValueTable,
    };
  }

  if (query.kind === 'list') {
    const section = findUniqueListSection(source, {
      description: query.description,
      predicate: (list, artifact) => {
        if (query.minLength && list.length < query.minLength) {
          return false;
        }
        if (query.requiredItems && !query.requiredItems.every((item) => list.includes(item))) {
          return false;
        }
        return query.predicate ? query.predicate(list, artifact) : true;
      },
    });
    return {
      sourceFile: section.sourceFile,
      sourceHeading: section.sourceHeading,
      value: section.list,
    };
  }

  throw new Error(`${source.file}: unknown section query kind '${query.kind}'`);
}

export function querySourceFields(source, query) {
  const record = Object.fromEntries(
    Object.entries(query.fields).map(([fieldName, spec]) => {
      const match = source.content.match(spec.pattern);
      if (!match) {
        throw new Error(
          `${source.file}: could not parse ${query.description} field '${fieldName}'`,
        );
      }
      return [fieldName, spec.select ? spec.select(match) : match[1] ?? match[0]];
    }),
  );

  return {
    sourceFile: source.file,
    value: record,
  };
}

export function extractRegistryEntries(content, sourceHeading) {
  const lines = content.split('\n');
  let startIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const headingMatch = lines[index].match(/^#{1,6}\s+(.*)$/);
    if (
      headingMatch && normalizeHeadingName(headingMatch[1]) === normalizeHeadingName(sourceHeading)
    ) {
      startIndex = index + 1;
      break;
    }
    if (normalizeHeadingName(lines[index]) === `${normalizeHeadingName(sourceHeading)}:`) {
      startIndex = index + 1;
      break;
    }
  }

  if (startIndex === -1) {
    return null;
  }

  const entries = [];
  let sawEntry = false;
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      if (sawEntry) {
        break;
      }
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      break;
    }
    const match = line.match(/^- `(\d+)`: `([^`]+)`$/);
    if (match) {
      entries.push([Number(match[1]), match[2]]);
      sawEntry = true;
      continue;
    }
    if (sawEntry && !line.startsWith('-')) {
      break;
    }
  }

  return entries.length > 0 ? entries : null;
}

export function collectRegistryHeadings(content) {
  const headings = new Set();
  const lines = content.split('\n');

  function hasImmediateNumericEntries(startIndex) {
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) {
        continue;
      }
      if (/^#{1,6}\s+/.test(line)) {
        return false;
      }
      return /^- `\d+`: `[^`]+`$/.test(line);
    }
    return false;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const headingMatch = line.match(/^#{1,6}\s+(.*)$/);
    if (headingMatch && /registry/i.test(headingMatch[1])) {
      headings.add(normalizeHeadingName(headingMatch[1]));
      continue;
    }
    if (headingMatch && hasImmediateNumericEntries(index)) {
      headings.add(normalizeHeadingName(headingMatch[1]));
      continue;
    }
    if (
      /registry:?$/i.test(line)
      || /must be one of:?$/i.test(line)
      || /Modes:?$/.test(line)
    ) {
      headings.add(normalizeHeadingName(line).replace(/:$/, ''));
    }
  }

  return [...headings];
}

function normalizeRegistryHint(hint) {
  return hint.replace(/[`]/g, '').replace(/\s+/g, ' ').trim();
}

export function extractFieldRegistryReferences(content) {
  const references = [];
  const paragraphs = content
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.replace(/\n+/g, ' ').trim())
    .filter(Boolean);

  const usagePattern =
    /((?:`[^`]+`\s*(?:,|\sand\s)?\s*)+)\s+use(?:s)?\s+the\s+base-profile(?:\s+`([^`]+)`| ([A-Za-z0-9 -]+?))\s+registr(?:y|ies)/gi;
  for (const paragraph of paragraphs) {
    for (const match of paragraph.matchAll(usagePattern)) {
      const fields = [...match[1].matchAll(/`([^`]+)`/g)].map((entry) =>
        normalizeFieldName(entry[1])
      );
      const registryHint = normalizeRegistryHint(match[2] ?? match[3] ?? '');
      for (const fieldName of fields) {
        references.push({
          fieldName,
          registryHint,
          strategy: 'explicitReference',
        });
      }
    }
  }

  const encodedPattern =
    /When\s+`([^`]+)`\s+is\s+encoded\s+as\s+`u\d+`,\s+the\s+base-profile\s+([A-Za-z0-9 -]+?)\s+registry\s+is/gi;
  for (const paragraph of paragraphs) {
    for (const match of paragraph.matchAll(encodedPattern)) {
      references.push({
        fieldName: normalizeFieldName(match[1]),
        registryHint: normalizeRegistryHint(match[2]),
        strategy: 'encodedRegistry',
      });
    }
  }

  const generalUsagePattern =
    /((?:`[^`]+`\s*(?:,|\sand\s)?\s*)+)\s+use(?:s)?\s+the\s+(?:same\s+)?(?:[A-Za-z0-9 -]+?\s+)?([A-Za-z0-9 -]+?)\s+registry/gi;
  for (const paragraph of paragraphs) {
    for (const match of paragraph.matchAll(generalUsagePattern)) {
      const fields = [...match[1].matchAll(/`([^`]+)`/g)].map((entry) =>
        normalizeFieldName(entry[1])
      );
      const registryHint = normalizeRegistryHint(match[2]);
      for (const fieldName of fields) {
        references.push({
          fieldName,
          registryHint,
          strategy: 'genericReference',
        });
      }
    }
  }

  return references;
}

export function extractSchemaAliasReferences(content, sourceFile = null) {
  const references = [];
  const lines = content.split('\n');
  let currentHeading = null;

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,6}\s+(.*)$/);
    if (headingMatch) {
      currentHeading = normalizeHeadingName(headingMatch[1]);
      continue;
    }

    const sameTagMatch = line.trim().match(/^Use the same field tags as `([^`]+)` in `([^`]+)`\.$/);
    if (currentHeading && sameTagMatch) {
      references.push({
        alias: currentHeading,
        target: sameTagMatch[1],
        sourceFile: sameTagMatch[2],
        strategy: 'sameFieldTags',
      });
    }
  }

  for (
    const match of content.matchAll(/(?:a\s+)?field typed as\s+`([^`]+)`\s+means\s+`([^`]+)`/gi)
  ) {
    references.push({
      alias: match[1],
      target: match[2],
      sourceFile,
      strategy: 'typedAlias',
    });
  }

  return references;
}

export function extractMarkdownTables(content) {
  const lines = content.split('\n');
  const tables = new Map();

  for (let index = 0; index < lines.length; index += 1) {
    const headingMatch = lines[index].match(/^#{1,6}\s+(.*)$/);
    if (!headingMatch) {
      continue;
    }
    const heading = normalizeHeadingName(headingMatch[1]);
    const headerLine = lines[index + 2]?.trim() ?? '';
    if (!headerLine.startsWith('| Tag | Field') || !headerLine.includes('| Type')) {
      continue;
    }

    const entries = [];
    let cursor = index + 4;
    while (cursor < lines.length && lines[cursor].trim().startsWith('|')) {
      const cells = lines[cursor]
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim());
      entries.push({
        tag: Number(cells[0]),
        field: normalizeFieldName(cells[1]),
        type: cells[2].replace(/`/g, ''),
        required: cells[3] === 'yes',
      });
      cursor += 1;
    }

    tables.set(heading, entries);
  }

  return tables;
}

export function collectTopLevelSections(content) {
  const sections = [];
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^##\s+(.*)$/);
    if (!match) {
      continue;
    }
    sections.push({
      lineNumber: index + 1,
      heading: normalizeHeadingName(match[1]),
    });
  }
  return sections;
}

export function findNearestTopLevelSection(sections, lineNumber) {
  let current = null;
  for (const section of sections) {
    if (section.lineNumber > lineNumber) {
      break;
    }
    current = section.heading;
  }
  return current;
}
