import fs from 'node:fs';
import process from 'node:process';

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function syncJsonArtifacts({ label, artifacts, write, staleMessage, updateMessage }) {
  const serializedArtifacts = artifacts.map((artifact) => ({
    ...artifact,
    currentSerialized: serialize(artifact.current),
    nextSerialized: serialize(artifact.next),
  }));

  const stale = serializedArtifacts.some(
    (artifact) => artifact.currentSerialized !== artifact.nextSerialized,
  );
  if (!write) {
    if (stale) {
      console.error(`${label}: ${staleMessage}`);
      process.exit(1);
    }
    console.log(`${label}: ok`);
    return;
  }

  for (const artifact of serializedArtifacts) {
    fs.writeFileSync(artifact.path, artifact.nextSerialized);
  }
  console.log(`${label}: ${updateMessage}`);
}
