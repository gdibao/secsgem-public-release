import { describe, expect, it } from 'vitest';

import { collectionWriteSchema, endpointLaunchable, endpointUnavailableReason, engineeringEndpointSchema } from './workspaceSchema';

const evidence = { checkedAt: '2026-10-18T08:00:00+08:00', reference: 'https://vendor.example.com/license' };
const endpoint = {
  authPrerequisite: '',
  embedEvidence: null,
  enabled: true,
  hostedEvidence: null,
  id: '2879619d-dd64-4f9b-a922-94e742f579c9',
  licenseEvidence: evidence,
  licenseState: 'verified' as const,
  mode: 'external_web' as const,
  title: 'Tool',
  toolId: 'PG001',
  url: 'https://vendor.example.com/work',
  version: 1,
};

describe('engineering workspace endpoint evidence', () => {
  it('permits a verified external endpoint', () => {
    const parsed = engineeringEndpointSchema.parse(endpoint);
    expect(endpointLaunchable(parsed)).toBe(true);
  });

  it('does not launch an unlicensed or archived endpoint', () => {
    expect(endpointLaunchable(engineeringEndpointSchema.parse({ ...endpoint, licenseState: 'pending' }))).toBe(false);
    expect(endpointLaunchable(engineeringEndpointSchema.parse({ ...endpoint, enabled: false }))).toBe(false);
    expect(endpointUnavailableReason(engineeringEndpointSchema.parse({ ...endpoint, licenseState: 'pending' }))).toBe('license_pending');
    expect(endpointUnavailableReason(engineeringEndpointSchema.parse({ ...endpoint, enabled: false }))).toBe('disabled');
  });

  it('requires frame permission, headers, and browser login for embedded mode', () => {
    const base = engineeringEndpointSchema.parse({ ...endpoint, mode: 'embedded_web' });
    expect(endpointLaunchable(base)).toBe(false);
    expect(endpointUnavailableReason(base)).toBe('embed_unverified');
    const frame = { browserLoginVerified: true, cspFrameAncestorsAllowed: true, permission: evidence, xFrameOptionsAllowed: true };
    expect(endpointLaunchable(engineeringEndpointSchema.parse({ ...base, embedEvidence: frame }))).toBe(true);
    expect(endpointLaunchable(engineeringEndpointSchema.parse({ ...base, embedEvidence: { ...frame, xFrameOptionsAllowed: false } }))).toBe(false);
  });

  it('keeps hosted configuration non-launchable without a trusted live verifier', () => {
    const base = engineeringEndpointSchema.parse({ ...endpoint, mode: 'hosted_web' });
    expect(endpointLaunchable(base)).toBe(false);
    expect(endpointUnavailableReason(base)).toBe('hosted_unverified');
    const hostedEvidence = { approvedOrigin: 'https://vendor.example.com/', deploymentVerifiedAt: evidence.checkedAt, rights: evidence };
    expect(endpointLaunchable(engineeringEndpointSchema.parse({ ...base, hostedEvidence }))).toBe(false);
    expect(endpointUnavailableReason(engineeringEndpointSchema.parse({ ...base, hostedEvidence }))).toBe('hosted_unverified');
    expect(endpointLaunchable(engineeringEndpointSchema.parse({ ...base, hostedEvidence: { ...hostedEvidence, deploymentVerifiedAt: '2000-01-01T00:00:00Z' } }))).toBe(false);
    expect(endpointLaunchable(engineeringEndpointSchema.parse({ ...base, hostedEvidence: { ...hostedEvidence, approvedOrigin: 'https://other.example.com/' } }))).toBe(false);
    expect(engineeringEndpointSchema.safeParse({ ...base, hostedEvidence: { ...hostedEvidence, approvedOrigin: 'https://vendor.example.com/other' } }).success).toBe(false);
  });

  it('rejects local navigation and duplicate collection entries', () => {
    expect(engineeringEndpointSchema.safeParse({ ...endpoint, url: 'http://localhost:3000/' }).success).toBe(false);
    expect(engineeringEndpointSchema.safeParse({ ...endpoint, url: 'https://app.localhost/' }).success).toBe(false);
    expect(engineeringEndpointSchema.safeParse({ ...endpoint, url: 'https://app.localhost.:8443/' }).success).toBe(false);
    expect(engineeringEndpointSchema.safeParse({ ...endpoint, url: 'https://nested.app.localhost/' }).success).toBe(false);
    const item = { alias: null, defaultEndpointId: null, groupId: null, sortOrder: 0, toolId: 'PG001' };
    expect(collectionWriteSchema.safeParse({ name: 'Favorites', sortOrder: 0, groups: [], entries: [item, item] }).success).toBe(false);
  });

  it('allows one tool in multiple groups while rejecting a duplicate in one group', () => {
    const a = 'cdf9f412-e45c-46fc-a9e3-3e20c1d06a36';
    const b = '71d59852-b124-4a79-aa82-c3a67b3e5cb3';
    const item = { alias: null, defaultEndpointId: null, sortOrder: 0, toolId: 'PG001' };
    const groups = [{ id: a, name: 'Design', sortOrder: 0 }, { id: b, name: 'Review', sortOrder: 1 }];
    const entries = [{ ...item, groupId: a }, { ...item, groupId: b }];
    expect(collectionWriteSchema.safeParse({ name: 'Favorites', sortOrder: 0, groups, entries }).success).toBe(true);
    expect(collectionWriteSchema.safeParse({ name: 'Favorites', sortOrder: 0, groups, entries: [entries[0], entries[0]] }).success).toBe(false);
  });
});
