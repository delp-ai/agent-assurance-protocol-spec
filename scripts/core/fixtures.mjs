import { readText } from './common.mjs';

export const byteFixtureDocs = {
  byteCorpusFile: 'conformances/09.BYTE.CORPUS.md',
  byteTranscriptsFile: 'conformances/10.BYTE.TRANSCRIPTS.md',
};

export const byteFixtureLabels = {
  vectorId: 'Vector id',
  sourceVector: 'Source vector',
  requiredAcceptedVectors: 'Required accepted vectors',
  requiredAbsentVectors: 'Required absent vectors',
  dependencyClass: 'Declared dependency class',
  prerequisiteContexts: 'Declared prerequisite contexts',
  observationBoundary: 'Observation boundary',
  orderingKeyFields: 'Ordering key fields',
  protectedArrivalWinner: 'Protected-arrival winner',
  canonicalFrameBytes: 'Canonical frame bytes',
  canonicalMalformedFrameBytes: 'Canonical malformed frame bytes',
  canonicalPayloadBytes: 'Canonical payload bytes',
  canonicalSectionBytes: 'Canonical section bytes',
  canonicalObjectBytes: 'Canonical object bytes',
  canonicalPayloadBody: 'Canonical payload body',
  canonicalHeaderSection: 'Canonical header section',
  canonicalObjectBody: 'Canonical object body',
  expectedParseSummary: 'Expected parse summary',
  expectedPerFrameResult: 'Expected per-frame result',
  expectedTranscriptOutcome: 'Expected transcript outcome',
};

function getVectorSections(content) {
  const matches = [...content.matchAll(/^## Vector .*$/gm)];
  return matches.map((match, index) => {
    const start = match.index;
    const end = matches[index + 1]?.index ?? content.length;
    return content.slice(start, end);
  });
}

function getTranscriptSections(content) {
  const matches = [...content.matchAll(/^## Transcript \d+: .*$/gm)];
  return matches.map((match, index) => {
    const start = match.index;
    const end = matches[index + 1]?.index ?? content.length;
    return content.slice(start, end);
  });
}

function getTranscriptFrameSections(section) {
  const matches = [...section.matchAll(/^### T\d+\.F\d+.*$/gm)];
  return matches.map((match, index) => {
    const start = match.index;
    const end = matches[index + 1]?.index ?? section.length;
    return section.slice(start, end);
  });
}

function extractBulletId(section, label) {
  const regex = new RegExp(`${label}:\\s*\\n\\s*\\n-\\s+\`([^\\\`]+)\``);
  return section.match(regex)?.[1] ?? null;
}

function extractBulletIds(section, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = section.match(
    new RegExp(`${escaped}:\\s*\\n\\s*\\n((?:-\\s+\`[^\\\`]+\`\\s*\\n?)*)`),
  );
  if (!match) {
    return [];
  }
  return [...match[1].matchAll(/-\s+\`([^`]+)\`/g)].map((item) => item[1]);
}

function extractCodeBlockAfterLabel(section, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`${escaped}:\\s*\\n\\s*\\n\`\`\`[A-Za-z0-9_-]*\\n([\\s\\S]*?)\\n\`\`\``);
  return section.match(regex)?.[1] ?? null;
}

function extractAliasBindings(content) {
  const firstVectorHeading = content.match(/^## Vector .*$/m)?.[0];
  const aliasSection = firstVectorHeading ? content.split(firstVectorHeading)[0] : content;
  const bindings = {};
  for (const match of aliasSection.matchAll(/^- ([^\n]+)$/gm)) {
    const line = match[1].trim();
    if (!/\bbinds?\b/.test(line)) {
      continue;
    }
    const aliases = [...line.matchAll(/`([^`]+)`/g)].map((aliasMatch) => aliasMatch[1]);
    if (aliases.length === 0) {
      continue;
    }
    for (const alias of aliases) {
      bindings[alias] = line;
    }
  }
  return bindings;
}

function parseVectorSection(section) {
  return {
    heading: section.match(/^##\s+(.*)$/m)?.[1] ?? null,
    id: extractBulletId(section, byteFixtureLabels.vectorId),
    canonicalFrameBytes: extractCodeBlockAfterLabel(section, byteFixtureLabels.canonicalFrameBytes),
    canonicalPayloadBytes: extractCodeBlockAfterLabel(
      section,
      byteFixtureLabels.canonicalPayloadBytes,
    ),
    canonicalSectionBytes: extractCodeBlockAfterLabel(
      section,
      byteFixtureLabels.canonicalSectionBytes,
    ),
    canonicalObjectBytes: extractCodeBlockAfterLabel(
      section,
      byteFixtureLabels.canonicalObjectBytes,
    ),
    canonicalPayloadBody: extractCodeBlockAfterLabel(
      section,
      byteFixtureLabels.canonicalPayloadBody,
    ),
    canonicalHeaderSection: extractCodeBlockAfterLabel(
      section,
      byteFixtureLabels.canonicalHeaderSection,
    ),
    canonicalObjectBody: extractCodeBlockAfterLabel(section, byteFixtureLabels.canonicalObjectBody),
    expectedParseSummary: extractCodeBlockAfterLabel(
      section,
      byteFixtureLabels.expectedParseSummary,
    ),
  };
}

function parseTranscriptFrameSection(section) {
  return {
    id: section.match(/^###\s+(T\d+\.F\d+)/m)?.[1] ?? null,
    heading: section.match(/^###\s+(.*)$/m)?.[1] ?? null,
    sourceVectorId: extractBulletId(section, byteFixtureLabels.sourceVector),
    canonicalFrameBytes: extractCodeBlockAfterLabel(section, byteFixtureLabels.canonicalFrameBytes)
      ?? extractCodeBlockAfterLabel(section, byteFixtureLabels.canonicalMalformedFrameBytes),
    expectedPerFrameResult: extractCodeBlockAfterLabel(
      section,
      byteFixtureLabels.expectedPerFrameResult,
    ),
  };
}

function parseTranscriptSection(section) {
  return {
    heading: section.match(/^##\s+(.*)$/m)?.[1] ?? null,
    id: extractBulletId(section, 'Transcript id'),
    requiredAcceptedVectorIds: extractBulletIds(section, byteFixtureLabels.requiredAcceptedVectors),
    requiredAbsentVectorIds: extractBulletIds(section, byteFixtureLabels.requiredAbsentVectors),
    dependencyClass: extractBulletId(section, byteFixtureLabels.dependencyClass),
    declaredPrerequisiteContextIds: extractBulletIds(
      section,
      byteFixtureLabels.prerequisiteContexts,
    ),
    observationBoundary: extractBulletId(section, byteFixtureLabels.observationBoundary),
    orderingKeyFields: extractBulletIds(section, byteFixtureLabels.orderingKeyFields),
    protectedArrivalWinnerFrameId: extractBulletId(
      section,
      byteFixtureLabels.protectedArrivalWinner,
    ),
    frames: getTranscriptFrameSections(section).map((frameSection) =>
      parseTranscriptFrameSection(frameSection)
    ),
    expectedTranscriptOutcome: extractCodeBlockAfterLabel(
      section,
      byteFixtureLabels.expectedTranscriptOutcome,
    ),
  };
}

export function buildByteFixtureState() {
  const byteCorpusContent = readText(byteFixtureDocs.byteCorpusFile);
  const transcriptContent = readText(byteFixtureDocs.byteTranscriptsFile);

  return {
    docs: byteFixtureDocs,
    labels: byteFixtureLabels,
    aliasBindings: extractAliasBindings(byteCorpusContent),
    vectors: getVectorSections(byteCorpusContent).map((section) => parseVectorSection(section)),
    transcripts: getTranscriptSections(transcriptContent).map((section) =>
      parseTranscriptSection(section)
    ),
  };
}
