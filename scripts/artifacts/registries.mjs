import process from 'node:process';
import { loadJson, repoPath } from '../core/common.mjs';
import { buildRegistriesState } from '../core/registries.mjs';
import { syncJsonArtifacts } from '../core/sync.mjs';

function main() {
  const write = process.argv.includes('--write');
  syncJsonArtifacts({
    label: 'sync.registries',
    write,
    artifacts: [
      {
        path: repoPath('artifacts', 'registries.json'),
        current: loadJson('artifacts/registries.json'),
        next: buildRegistriesState(),
      },
    ],
    staleMessage:
      'registries artifact is stale; run `node scripts/artifacts/registries.mjs --write`',
    updateMessage: 'updated artifacts/registries.json',
  });
}

main();
