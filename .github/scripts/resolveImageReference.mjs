import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const shaTagPattern = /^sha-[0-9a-f]{12}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

const invalidReference = () =>
  new Error('image lookup reference must use an exact sha-[0-9a-f]{12} tag');

export const parseTaggedImageReference = (reference) => {
  if (typeof reference !== 'string' || reference.length === 0 || /\s/u.test(reference)) {
    throw invalidReference();
  }

  const lastSlash = reference.lastIndexOf('/');
  const lastColon = reference.lastIndexOf(':');
  if (reference.includes('@') || lastColon <= lastSlash) throw invalidReference();

  const repository = reference.slice(0, lastColon);
  const tag = reference.slice(lastColon + 1);
  if (!repository || repository.endsWith('/') || !shaTagPattern.test(tag)) {
    throw invalidReference();
  }

  return { repository, tag };
};

export const parseManifestDigest = (manifestSource) => {
  let manifest;
  try {
    manifest = JSON.parse(manifestSource);
  } catch {
    throw new Error('image manifest JSON is invalid');
  }

  if (!manifest || typeof manifest !== 'object' || !digestPattern.test(manifest.digest ?? '')) {
    throw new Error('image manifest digest must match sha256:[0-9a-f]{64}');
  }

  return manifest.digest;
};

const inspectManifest = (reference) =>
  execFileSync(
    process.env.DOCKER_BIN || 'docker',
    ['buildx', 'imagetools', 'inspect', '--format', '{{json .Manifest}}', reference],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  ).trim();

export const resolveImageReference = (taggedReference, inspect = inspectManifest) => {
  const { repository } = parseTaggedImageReference(taggedReference);
  const digest = parseManifestDigest(inspect(taggedReference));
  return `${repository}@${digest}`;
};

const isCli =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isCli) {
  try {
    if (process.argv.length !== 3) {
      throw new Error('usage: node resolveImageReference.mjs <sha-tagged-image-reference>');
    }
    process.stdout.write(`${resolveImageReference(process.argv[2])}\n`);
  } catch (error) {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
