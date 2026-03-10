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
        path: repoPath('specs', 'registries.json'),
        current: loadJson('specs/registries.json'),
        next: buildRegistriesState(),
      },
    ],
    staleMessage: 'registries artifact is stale; run `node scripts/specs/registries.mjs --write`',
    updateMessage: 'updated specs/registries.json',
  });
}

main();
