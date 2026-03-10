import { runDprint, runGeneratedSpecSyncs, runMarkdownLint } from './common.mjs';

runGeneratedSpecSyncs(false);
runDprint('check');
runMarkdownLint(false);
