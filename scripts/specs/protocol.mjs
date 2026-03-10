import process from 'node:process';
import { loadJson, repoPath } from '../core/common.mjs';
import { buildProtocolState } from '../core/protocol.mjs';
import { syncJsonArtifacts } from '../core/sync.mjs';

function main() {
  const write = process.argv.includes('--write');
  syncJsonArtifacts({
    label: 'sync.protocol',
    write,
    artifacts: [
      {
        path: repoPath('specs', 'protocol.json'),
        current: loadJson('specs/protocol.json'),
        next: buildProtocolState(),
      },
    ],
    staleMessage: 'protocol artifact is stale; run `node scripts/specs/protocol.mjs --write`',
    updateMessage: 'updated specs/protocol.json',
  });
}

main();
