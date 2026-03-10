import fs from 'node:fs';
import path from 'node:path';
import {
  extractHeadings,
  extractMarkdownRefs,
  isMainModule,
  listMarkdownFiles,
  normalizeRelative,
  readText,
  repoPath,
  requireNoProblems,
} from '../core/common.mjs';

export function validateAnchors() {
  const problems = [];
  const markdownFiles = listMarkdownFiles();

  const headingMap = new Map();
  for (const file of markdownFiles) {
    const content = readText(file);
    const headings = extractHeadings(content);
    const anchors = new Set(headings.map((heading) => heading.anchor));
    headingMap.set(file, { content, headings, anchors });
  }

  for (const file of markdownFiles) {
    const { content } = headingMap.get(file);
    for (const ref of extractMarkdownRefs(content)) {
      const [targetPath, anchor] = ref.split('#');
      const relativeCandidate = normalizeRelative(
        path.resolve(repoPath(path.posix.dirname(file)), targetPath),
      );
      const rootCandidate = normalizeRelative(repoPath(targetPath));
      const resolvedPath = fs.existsSync(repoPath(relativeCandidate))
        ? relativeCandidate
        : rootCandidate;
      const absoluteTarget = repoPath(resolvedPath);

      if (!fs.existsSync(absoluteTarget)) {
        problems.push(`${file}: missing markdown ref target '${ref}'`);
        continue;
      }

      if (!anchor) {
        continue;
      }

      const target = headingMap.get(resolvedPath);
      if (!target) {
        problems.push(`${file}: ref target '${ref}' is outside markdown scan set`);
        continue;
      }
      if (!target.anchors.has(anchor)) {
        problems.push(`${file}: missing anchor '${anchor}' in '${resolvedPath}'`);
      }
    }
  }

  return problems;
}

if (isMainModule(import.meta.url)) {
  requireNoProblems('validate.anchors', validateAnchors());
}
