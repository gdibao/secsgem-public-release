import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseManifestDigest,
  parseTaggedImageReference,
  resolveImageReference,
} from './resolveImageReference.mjs';

const digest = `sha256:${'a'.repeat(64)}`;

test('parses an immutable SHA lookup tag', () => {
  assert.deepEqual(
    parseTaggedImageReference('ghcr.io/example/comhub-module-worker:sha-0123456789ab'),
    {
      repository: 'ghcr.io/example/comhub-module-worker',
      tag: 'sha-0123456789ab',
    },
  );
});

test('keeps a registry port when removing the lookup tag', () => {
  assert.deepEqual(
    parseTaggedImageReference('registry.example:5443/team/worker:sha-abcdef012345'),
    {
      repository: 'registry.example:5443/team/worker',
      tag: 'sha-abcdef012345',
    },
  );
});

test('rejects mutable, missing, and already resolved image references', () => {
  for (const reference of [
    'ghcr.io/example/worker',
    'ghcr.io/example/worker:latest',
    `ghcr.io/example/worker@${digest}`,
    'ghcr.io/example/worker:sha-ABCDEF012345',
    'ghcr.io/example/worker:sha-abcdef0123456',
  ]) {
    assert.throws(() => parseTaggedImageReference(reference), /sha-\[0-9a-f\]\{12\}/);
  }
});

test('parses a valid manifest digest', () => {
  assert.equal(parseManifestDigest(JSON.stringify({ digest })), digest);
});

test('rejects malformed manifest output', () => {
  assert.throws(() => parseManifestDigest('{'), /manifest JSON/);
  assert.throws(
    () => parseManifestDigest(JSON.stringify({ digest: 'sha256:not-a-digest' })),
    /manifest digest/,
  );
  assert.throws(() => parseManifestDigest(JSON.stringify({})), /manifest digest/);
});

test('resolves a lookup tag to a digest reference', () => {
  const calls = [];
  const resolved = resolveImageReference(
    'ghcr.io/example/comhub-module-worker:sha-0123456789ab',
    (reference) => {
      calls.push(reference);
      return JSON.stringify({ digest });
    },
  );

  assert.equal(resolved, `ghcr.io/example/comhub-module-worker@${digest}`);
  assert.deepEqual(calls, ['ghcr.io/example/comhub-module-worker:sha-0123456789ab']);
});
