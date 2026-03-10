import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { repoPath, repoRoot } from '../core/common.mjs';

export const generatedSpecScripts = ['protocol', 'registries', 'objects', 'bytes', 'bindings'];

function localBin(name) {
  const executable = process.platform === 'win32' ? `${name}.cmd` : name;
  return repoPath('node_modules', '.bin', executable);
}

export function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd'),
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

export function runGeneratedSpecSyncs(write) {
  for (const script of generatedSpecScripts) {
    const args = [`scripts/specs/${script}.mjs`];
    if (write) {
      args.push('--write');
    }
    run(process.execPath, args);
  }
}

export function runDprint(mode) {
  run(localBin('dprint'), [mode, '--config', path.join(repoRoot, 'dprint.json')]);
}

export function runMarkdownLint(fix) {
  const args = [
    '--config',
    path.join(repoRoot, 'configs', '.markdownlint.json'),
    'README.md',
    '*.md',
    'conformances/**/*.md',
    '#node_modules',
  ];
  if (fix) {
    args.push('--fix');
  }
  run(localBin('markdownlint-cli2'), args);
}
