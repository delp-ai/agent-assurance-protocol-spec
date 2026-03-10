import { runDprint, runGeneratedSpecSyncs, runMarkdownLint } from './common.mjs';

runGeneratedSpecSyncs(true);
runDprint('fmt');
runMarkdownLint(true);
