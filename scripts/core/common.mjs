import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const thisDir = path.dirname(thisFile);

export const repoRoot = path.resolve(thisDir, '..', '..');

export function repoPath(...segments) {
  return path.join(repoRoot, ...segments);
}

export function normalizeRelative(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

export function readText(relativePath) {
  return fs.readFileSync(repoPath(relativePath), 'utf8');
}

export function loadJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

export function isMainModule(metaUrl) {
  if (!process.argv[1]) {
    return false;
  }
  return fileURLToPath(metaUrl) === path.resolve(process.argv[1]);
}

export function listFiles(startRelativePath, predicate) {
  const start = repoPath(startRelativePath);
  const results = [];

  function walk(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') {
        continue;
      }
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      const relativePath = normalizeRelative(absolutePath);
      if (predicate(relativePath, absolutePath)) {
        results.push(relativePath);
      }
    }
  }

  walk(start);
  return results.sort();
}

export function listMarkdownFiles() {
  return listFiles('.', (relativePath) => relativePath.endsWith('.md'));
}

export function makeAnchor(headingText) {
  return headingText
    .trim()
    .toLowerCase()
    .replace(/[`]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function extractHeadings(content) {
  const headings = [];
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+(.*)$/);
    if (!match) {
      continue;
    }
    const text = match[2].trim();
    headings.push({
      lineNumber: index + 1,
      depth: match[1].length,
      text,
      anchor: makeAnchor(text),
    });
  }
  return headings;
}

export function extractMarkdownRefs(content) {
  const refs = [];
  const pattern = /(^|[\s`(])([A-Za-z0-9_./-]+\.md(?:#[A-Za-z0-9._-]+)?)(?=$|[\s`)])/gm;
  for (const match of content.matchAll(pattern)) {
    refs.push(match[2]);
  }
  return refs;
}

export function extractFencedBlocks(content) {
  const blocks = [];
  const pattern = /^```([A-Za-z0-9_-]*)\n([\s\S]*?)^```/gm;
  for (const match of content.matchAll(pattern)) {
    blocks.push({
      language: match[1] || '',
      body: match[2],
    });
  }
  return blocks;
}

export function extractFrameBlocks(content) {
  return extractFencedBlocks(content)
    .map((block) => block.body)
    .filter((body) => body.includes('Frame {'));
}

export function parseColonFields(blockBody) {
  const fields = new Map();
  const lines = blockBody.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = line.match(/^([A-Za-z0-9.[\]_]+):\s+(.+?)\s*$/);
    if (!match) {
      continue;
    }
    fields.set(match[1], match[2]);
  }
  return fields;
}

export function splitListLiteral(rawValue) {
  const trimmed = rawValue.trim();
  if (!(trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return [trimmed];
  }

  const body = trimmed.slice(1, -1).trim();
  if (!body) {
    return [];
  }

  const items = [];
  let current = '';
  let bracketDepth = 0;
  let braceDepth = 0;
  let parenDepth = 0;

  for (const character of body) {
    if (character === ',' && bracketDepth === 0 && braceDepth === 0 && parenDepth === 0) {
      if (current.trim()) {
        items.push(current.trim());
      }
      current = '';
      continue;
    }

    current += character;
    if (character === '[') {
      bracketDepth += 1;
    } else if (character === ']') {
      bracketDepth -= 1;
    } else if (character === '{') {
      braceDepth += 1;
    } else if (character === '}') {
      braceDepth -= 1;
    } else if (character === '(') {
      parenDepth += 1;
    } else if (character === ')') {
      parenDepth -= 1;
    }
  }

  if (current.trim()) {
    items.push(current.trim());
  }

  return items;
}

export function isNumericToken(token) {
  return /^\d+$/.test(token);
}

export function isStructuredToken(token) {
  return (
    token.includes('{')
    || token.includes('}')
    || token.includes('(')
    || token.includes(')')
    || token.startsWith('"')
    || token.startsWith("'")
    || token.startsWith('sha256:')
    || token.startsWith('sig.')
    || token.startsWith('manifest.')
    || token.startsWith('embedded(')
    || token === 'true'
    || token === 'false'
  );
}

export function printProblems(label, problems) {
  if (problems.length === 0) {
    console.log(`${label}: ok`);
    return;
  }

  console.error(`${label}: ${problems.length} problem(s)`);
  for (const problem of problems) {
    console.error(`- ${problem}`);
  }
}

export function requireNoProblems(label, problems) {
  printProblems(label, problems);
  if (problems.length > 0) {
    process.exit(1);
  }
}
