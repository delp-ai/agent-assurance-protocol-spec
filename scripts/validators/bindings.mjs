import { buildBindingsState } from '../core/bindings.mjs';
import { isMainModule, listFiles, loadJson, requireNoProblems } from '../core/common.mjs';

export function validateCorpusBindings() {
  const problems = [];
  const generated = buildBindingsState();
  const ssot = loadJson('specs/bindings.json');
  const bytesSpec = loadJson('specs/bytes.json');
  const packageJson = loadJson('package.json');

  if (JSON.stringify(ssot) !== JSON.stringify(generated)) {
    problems.push(
      'specs/bindings.json is stale; run `node scripts/specs/bindings.mjs --write`',
    );
  }

  const vectorIds = new Set((bytesSpec.vectors ?? []).map((vector) => vector.id));
  const transcriptIds = new Set((bytesSpec.transcripts ?? []).map((transcript) => transcript.id));
  const repoFiles = new Set(listFiles('.', () => true));
  for (const link of ssot.transcriptLinks ?? []) {
    if (!vectorIds.has(link.sourceVectorId)) {
      problems.push(
        `conformances/10.BYTE.TRANSCRIPTS.md: source vector '${link.sourceVectorId}' is not published in 09.BYTE.CORPUS.md`,
      );
    }
  }

  for (const [manifestId, manifest] of Object.entries(ssot.claimManifests ?? {})) {
    for (const file of manifest.requiredSpecs ?? []) {
      if (!repoFiles.has(file)) {
        problems.push(
          `README.md:${manifestId}: required spec '${file}' is not present in the repository`,
        );
      }
    }
    for (const file of manifest.requiredCorpusFiles ?? []) {
      if (!(ssot.corpusFiles ?? []).includes(file)) {
        problems.push(
          `README.md:${manifestId}: required corpus file '${file}' is not published in bindings corpusFiles`,
        );
      }
    }
    for (const transcriptId of manifest.requiredByteTranscripts ?? []) {
      if (!transcriptIds.has(transcriptId)) {
        problems.push(
          `README.md:${manifestId}: required byte transcript '${transcriptId}' is not published in specs/bytes.json`,
        );
      }
    }
    for (const validatorScript of manifest.requiredValidators ?? []) {
      if (!packageJson.scripts?.[validatorScript]) {
        problems.push(
          `README.md:${manifestId}: required validator '${validatorScript}' is not defined in package.json`,
        );
      }
    }
  }

  return problems;
}

if (isMainModule(import.meta.url)) {
  requireNoProblems('validate.bindings', validateCorpusBindings());
}
