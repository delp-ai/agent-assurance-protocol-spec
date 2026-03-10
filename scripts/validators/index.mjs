import { isMainModule, requireNoProblems } from '../core/common.mjs';
import { validateAnchors } from './anchors.mjs';
import { validateCorpusBindings } from './bindings.mjs';
import { validateByteSets } from './bytes.mjs';
import { validateObjectBlocks } from './objects.mjs';
import { validateProtocolSsot } from './protocol.mjs';
import { validateRegistries } from './registries.mjs';
import { validateScenarios } from './scenarios.mjs';

export function validateAll() {
  return [
    ...validateAnchors(),
    ...validateProtocolSsot(),
    ...validateByteSets(),
    ...validateObjectBlocks(),
    ...validateRegistries(),
    ...validateCorpusBindings(),
    ...validateScenarios(),
  ];
}

if (isMainModule(import.meta.url)) {
  requireNoProblems('validate', validateAll());
}
