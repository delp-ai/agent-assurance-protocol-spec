import { listMarkdownFiles, loadJson, readText } from './common.mjs';
import { extractListAfterHeading } from './docs.mjs';

function collectMarkdownAnchorReferences(file) {
  const content = readText(file);
  return [...content.matchAll(/\[[^\]]+\]\(([^)#]+)#([^)]+)\)/g)].map((match) => ({
    targetFile: match[1],
    anchor: match[2],
  }));
}

function buildTranscriptLinks(bytesSpec) {
  const links = [];

  for (const transcript of bytesSpec.transcripts ?? []) {
    for (const frame of transcript.frames ?? []) {
      if (!frame.sourceVectorId) {
        continue;
      }
      links.push({
        transcriptId: transcript.id,
        frameId: frame.id,
        sourceVectorId: frame.sourceVectorId,
      });
    }
  }

  return links;
}

export function buildBindingsState() {
  const bytesSpec = loadJson('artifacts/bytes.json');
  const readme = readText('README.md');
  const corpusFiles = listMarkdownFiles()
    .filter((file) => file.startsWith('conformances/'))
    .sort();

  return {
    agentManagementMode: 'agent-native',
    corpusFiles,
    anchorReferences: corpusFiles.flatMap((file) =>
      collectMarkdownAnchorReferences(file).map((reference) => ({
        file,
        ...reference,
      }))
    ),
    transcriptLinks: buildTranscriptLinks(bytesSpec),
    claimManifests: {
      aapOpenCore: {
        requiredSpecs: extractListAfterHeading(readme, 'AAP Open Core Claim Required Specs') ?? [],
        requiredCorpusFiles: extractListAfterHeading(
          readme,
          'AAP Open Core Claim Required Corpus Files',
        ) ?? [],
        requiredValidators: extractListAfterHeading(
          readme,
          'AAP Open Core Claim Required Validators',
        ) ?? [],
        requiredByteTranscripts: extractListAfterHeading(
          readme,
          'AAP Open Core Claim Required Byte Transcripts',
        ) ?? [],
      },
    },
  };
}
