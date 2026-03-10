import process from 'node:process';
import { loadJson, repoPath } from '../core/common.mjs';
import { buildByteFixtureState } from '../core/fixtures.mjs';
import { syncJsonArtifacts } from '../core/sync.mjs';

function main() {
  const write = process.argv.includes('--write');
  syncJsonArtifacts({
    label: 'sync.bytes',
    write,
    artifacts: [
      {
        path: repoPath('specs', 'bytes.json'),
        current: loadJson('specs/bytes.json'),
        next: buildByteFixtureState(),
      },
    ],
    staleMessage: 'fixture metadata is stale; run `node scripts/specs/bytes.mjs --write`',
    updateMessage: 'updated specs/bytes.json',
  });
}

main();
