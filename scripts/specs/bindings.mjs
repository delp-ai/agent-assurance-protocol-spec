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
        path: repoPath('specs', 'bindings.json'),
        current: loadJson('specs/bindings.json'),
        next: buildBindingsState(),
      },
    ],
    staleMessage: 'bindings artifact is stale; run `node scripts/specs/bindings.mjs --write`',
    updateMessage: 'updated specs/bindings.json',
  });
}

main();
