import process from 'node:process';

import { bytesToHex, hexToBytes, parseFrame } from '../core/parser.mjs';
import { serializeFrame } from '../core/serialize.mjs';
import { deriveTranscriptOutcome, replayHarnessVersion } from './model.mjs';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function normalizeHex(hex) {
  return bytesToHex(hexToBytes(hex));
}

async function main() {
  const rawInput = await readStdin();
  const request = JSON.parse(rawInput);
  if (request.harnessVersion !== replayHarnessVersion) {
    throw new Error(
      `unsupported harness version '${request.harnessVersion ?? 'missing'}'`,
    );
  }

  const transcriptResults = [];
  for (const transcript of request.transcripts ?? []) {
    const frameResults = [];
    for (const frame of transcript.frames ?? []) {
      let parsedSuccessfully = false;
      let accepted = false;
      let parsedFrame = null;
      let errorMessage = null;
      let roundTripMatchesCanonical = false;
      try {
        parsedFrame = parseFrame(hexToBytes(frame.frameHex));
        parsedSuccessfully = true;
        roundTripMatchesCanonical = bytesToHex(serializeFrame(parsedFrame))
          === normalizeHex(frame.frameHex);
        accepted = parsedSuccessfully && roundTripMatchesCanonical;
      } catch (error) {
        errorMessage = error.message;
      }
      frameResults.push({
        id: frame.id,
        parsedSuccessfully,
        accepted,
        roundTripMatchesCanonical,
        errorMessage,
        parsedFrame,
      });
    }

    transcriptResults.push({
      transcriptId: transcript.id,
      frameResults: frameResults.map((result) => ({
        id: result.id,
        parsedSuccessfully: result.parsedSuccessfully,
        accepted: result.accepted,
        roundTripMatchesCanonical: result.roundTripMatchesCanonical,
        errorMessage: result.errorMessage,
      })),
      transcriptOutcome: deriveTranscriptOutcome(frameResults, transcript),
    });
  }

  process.stdout.write(
    `${
      JSON.stringify(
        {
          harnessVersion: replayHarnessVersion,
          adapterId: 'aap-reference-replay-adapter-v1',
          capabilities: {
            exactByteRoundTrip: true,
            transcriptSemanticRejection: false,
          },
          transcriptResults,
        },
        null,
        2,
      )
    }\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exit(1);
});
