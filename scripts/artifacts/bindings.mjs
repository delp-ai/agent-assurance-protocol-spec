import process from 'node:process';
import { buildBindingsState } from '../core/bindings.mjs';
import { loadJson, repoPath } from '../core/common.mjs';
import { syncJsonArtifacts } from '../core/sync.mjs';

function main() {
  const write = process.argv.includes('--write');
  syncJsonArtifacts({
    label: 'sync.bindings',
    write,
    artifacts: [
      {
        path: repoPath('artifacts', 'bindings.json'),
        current: loadJson('artifacts/bindings.json'),
        next: buildBindingsState(),
      },
    ],
    staleMessage: 'bindings artifact is stale; run `node scripts/artifacts/bindings.mjs --write`',
    updateMessage: 'updated artifacts/bindings.json',
  });
}

main();
