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
        path: repoPath('specs', 'objects.json'),
        current: loadJson('specs/objects.json'),
        next: nextState.generatedObjects,
      },
    ],
    staleMessage:
      'generated objects artifact is stale; run `node scripts/specs/objects.mjs --write`',
    updateMessage: 'updated specs/objects.json',
  });
}

main();
