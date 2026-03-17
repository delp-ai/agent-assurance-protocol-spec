import process from 'node:process';
import { loadJson, repoPath } from '../core/common.mjs';
import { buildObjectSyncState } from '../core/objects.mjs';
import { syncJsonArtifacts } from '../core/sync.mjs';

function main() {
  const write = process.argv.includes('--write');
  const nextState = buildObjectSyncState();
  syncJsonArtifacts({
    label: 'sync.objects',
    write,
    artifacts: [
      {
        path: repoPath('artifacts', 'objects.json'),
        current: loadJson('artifacts/objects.json'),
        next: nextState.generatedObjects,
      },
    ],
    staleMessage:
      'generated objects artifact is stale; run `node scripts/artifacts/objects.mjs --write`',
    updateMessage: 'updated artifacts/objects.json',
  });
}

main();
