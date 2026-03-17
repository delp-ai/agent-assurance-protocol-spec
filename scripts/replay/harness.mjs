import { spawnSync } from 'node:child_process';
import process from 'node:process';

import { isMainModule, loadJson, requireNoProblems } from '../core/common.mjs';
import { bytesToHex, hexToBytes } from '../core/parser.mjs';
import {
  emittedWireErrorSet,
  normalizeExpectedValue,
  parseExpectedFrameOutcome,
  parseExpectedTranscriptOutcome,
  replayHarnessVersion,
} from './model.mjs';

function normalizeHex(hex) {
  return bytesToHex(hexToBytes(hex));
}

function parseArgs(argv) {
  const options = {
    adapterCommand: 'node scripts/replay/reference.adapter.mjs',
    claimId: 'aapOpenCore',
    transcriptIds: [],
    allTranscripts: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--adapter-command') {
      options.adapterCommand = argv[index + 1];
      index += 1;
    } else if (token === '--claim') {
      options.claimId = argv[index + 1];
      index += 1;
    } else if (token === '--transcript') {
      options.transcriptIds.push(argv[index + 1]);
      index += 1;
    } else if (token === '--all-transcripts') {
      options.allTranscripts = true;
    } else {
      throw new Error(`unknown argument '${token}'`);
    }
  }

  return options;
}

function resolveSelectedTranscripts(bytesSpec, bindingsSpec, options) {
  const transcriptsById = new Map((bytesSpec.transcripts ?? []).map((entry) => [entry.id, entry]));
  if (options.transcriptIds.length > 0) {
    return options.transcriptIds.map((id) => {
      const transcript = transcriptsById.get(id);
      if (!transcript) {
        throw new Error(`unknown transcript '${id}'`);
      }
      return transcript;
    });
  }

  if (options.allTranscripts) {
    return bytesSpec.transcripts ?? [];
  }

  const claimManifest = bindingsSpec.claimManifests?.[options.claimId];
  if (!claimManifest) {
    throw new Error(`unknown claim manifest '${options.claimId}'`);
  }
  return (claimManifest.requiredByteTranscripts ?? []).map((id) => {
    const transcript = transcriptsById.get(id);
    if (!transcript) {
      throw new Error(`claim manifest '${options.claimId}' references unknown transcript '${id}'`);
    }
    return transcript;
  });
}

function buildFrameHexLookup(bytesSpec) {
  const lookup = new Map();
  for (const vector of bytesSpec.vectors ?? []) {
    if (vector.canonicalFrameBytes) {
      lookup.set(vector.id, normalizeHex(vector.canonicalFrameBytes));
    }
  }
  return lookup;
}

function buildHarnessRequest(transcripts, frameHexLookup, claimId) {
  return {
    harnessVersion: replayHarnessVersion,
    claimManifestId: claimId,
    transcripts: transcripts.map((transcript) => ({
      id: transcript.id,
      dependencyClass: transcript.dependencyClass ?? null,
      declaredPrerequisiteContextIds: transcript.declaredPrerequisiteContextIds ?? [],
      requiredAcceptedVectorIds: transcript.requiredAcceptedVectorIds ?? [],
      requiredAbsentVectorIds: transcript.requiredAbsentVectorIds ?? [],
      observationBoundary: transcript.observationBoundary ?? null,
      orderingKeyFields: transcript.orderingKeyFields ?? [],
      protectedArrivalWinnerFrameId: transcript.protectedArrivalWinnerFrameId ?? null,
      frames: (transcript.frames ?? []).map((frame) => {
        const frameHex = frame.canonicalFrameBytes
          ? normalizeHex(frame.canonicalFrameBytes)
          : frameHexLookup.get(frame.sourceVectorId);
        if (!frameHex) {
          throw new Error(
            `transcript '${transcript.id}' frame '${frame.id}' does not resolve to canonical frame bytes`,
          );
        }
        return {
          id: frame.id,
          sourceVectorId: frame.sourceVectorId ?? null,
          frameHex,
        };
      }),
    })),
  };
}

function runAdapter(adapterCommand, request) {
  const result = spawnSync(adapterCommand, {
    shell: true,
    input: JSON.stringify(request),
    encoding: 'utf8',
    cwd: process.cwd(),
  });

  if (result.status !== 0) {
    throw new Error(
      `adapter command failed with exit code ${
        result.status ?? 'unknown'
      }\n${result.stderr.trim()}`,
    );
  }
  if (!result.stdout.trim()) {
    throw new Error('adapter command returned no JSON output');
  }
  return JSON.parse(result.stdout);
}

function compareFrameExpectations(transcript, actualResult, problems) {
  const frameResultsById = new Map(
    (actualResult.frameResults ?? []).map((result) => [result.id, result]),
  );
  for (const frame of transcript.frames ?? []) {
    const actualFrameResult = frameResultsById.get(frame.id);
    if (!actualFrameResult) {
      problems.push(`${transcript.id}:${frame.id}: adapter did not return a frame result`);
      continue;
    }
    if (actualFrameResult.roundTripMatchesCanonical !== true) {
      problems.push(
        `${transcript.id}:${frame.id}: adapter did not round-trip canonical frame bytes`,
      );
    }

    const expectedFrameOutcome = parseExpectedFrameOutcome(frame.expectedPerFrameResult);
    if (!expectedFrameOutcome) {
      continue;
    }
    if (
      expectedFrameOutcome.accepted !== null
      && String(actualFrameResult.accepted) !== expectedFrameOutcome.accepted
    ) {
      problems.push(
        `${transcript.id}:${frame.id}: expected accepted='${expectedFrameOutcome.accepted}' but adapter reported '${actualFrameResult.accepted}'`,
      );
    }
    if (
      expectedFrameOutcome.parsedSuccessfully !== null
      && String(actualFrameResult.parsedSuccessfully) !== expectedFrameOutcome.parsedSuccessfully
    ) {
      problems.push(
        `${transcript.id}:${frame.id}: expected parsedSuccessfully='${expectedFrameOutcome.parsedSuccessfully}' but adapter reported '${actualFrameResult.parsedSuccessfully}'`,
      );
    }
  }
}

function compareTranscriptExpectations(transcript, actualResult, problems) {
  const expectedOutcome = parseExpectedTranscriptOutcome(transcript.expectedTranscriptOutcome);
  if (!expectedOutcome) {
    return;
  }
  for (const [key, expectedRaw] of Object.entries(expectedOutcome)) {
    const actualValue = actualResult.transcriptOutcome?.[key];
    if (actualValue === undefined || actualValue === null) {
      problems.push(
        `${transcript.id}: adapter omitted required transcript outcome '${key}'`,
      );
      continue;
    }
    const normalizedExpected = normalizeExpectedValue(expectedRaw);
    if (actualValue !== normalizedExpected) {
      problems.push(
        `${transcript.id}: transcript outcome mismatch for '${key}', expected '${expectedRaw}' but adapter reported '${actualValue}'`,
      );
    }
  }

  const emittedWireErrors = emittedWireErrorSet(actualResult.transcriptOutcome ?? {});
  for (const frame of transcript.frames ?? []) {
    const expectedFrameOutcome = parseExpectedFrameOutcome(frame.expectedPerFrameResult);
    const expectedWireError = normalizeExpectedValue(
      expectedFrameOutcome?.generatedWireError ?? 'none',
    );
    if (expectedWireError !== 'none' && !emittedWireErrors.has(expectedWireError)) {
      problems.push(
        `${transcript.id}:${frame.id}: expected generated wire error '${expectedWireError}' was not emitted by adapter transcript outcome`,
      );
    }
  }
}

function validateAdapterCoverage(selectedTranscripts, adapterResponse, problems) {
  if (adapterResponse.harnessVersion !== replayHarnessVersion) {
    problems.push(
      `adapter returned harnessVersion '${
        adapterResponse.harnessVersion ?? 'missing'
      }' instead of '${replayHarnessVersion}'`,
    );
  }

  const resultsByTranscriptId = new Map(
    (adapterResponse.transcriptResults ?? []).map((result) => [result.transcriptId, result]),
  );
  for (const transcript of selectedTranscripts) {
    const actualResult = resultsByTranscriptId.get(transcript.id);
    if (!actualResult) {
      problems.push(`adapter did not return a result for transcript '${transcript.id}'`);
      continue;
    }
    compareFrameExpectations(transcript, actualResult, problems);
    compareTranscriptExpectations(transcript, actualResult, problems);
  }
}

export function validateCrossImplementationReplay(options = {}) {
  const bytesSpec = loadJson('artifacts/bytes.json');
  const bindingsSpec = loadJson('artifacts/bindings.json');
  const selectedTranscripts = resolveSelectedTranscripts(bytesSpec, bindingsSpec, {
    adapterCommand: options.adapterCommand ?? 'node scripts/replay/reference.adapter.mjs',
    claimId: options.claimId ?? 'aapOpenCore',
    transcriptIds: options.transcriptIds ?? [],
    allTranscripts: options.allTranscripts ?? false,
  });
  const frameHexLookup = buildFrameHexLookup(bytesSpec);
  const request = buildHarnessRequest(
    selectedTranscripts,
    frameHexLookup,
    options.claimId ?? 'aapOpenCore',
  );
  const adapterResponse = runAdapter(
    options.adapterCommand ?? 'node scripts/replay/reference.adapter.mjs',
    request,
  );

  const problems = [];
  validateAdapterCoverage(selectedTranscripts, adapterResponse, problems);
  return {
    adapterId: adapterResponse.adapterId ?? 'unknown-adapter',
    transcriptCount: selectedTranscripts.length,
    problems,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = validateCrossImplementationReplay(options);
  if (result.problems.length === 0) {
    console.log(
      `validate.replay: ok (${result.transcriptCount} transcript(s), adapter=${result.adapterId})`,
    );
    return;
  }
  requireNoProblems('validate.replay', result.problems);
}

if (isMainModule(import.meta.url)) {
  main();
}
