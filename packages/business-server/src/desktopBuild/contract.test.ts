import { describe, expect, it } from 'vitest';

import {
  desktopBuildProfilePayloadSchema,
  desktopReleaseInputSchema,
  parseDesktopBuildProfilePayload,
} from './contract';

const validPayload = {
  applicationId: 'com.comhub.desktop',
  applicationName: 'ComHub',
  description: 'The ComHub desktop application',
  executableName: 'ComHub',
  homepage: 'https://comhub.example.com',
  installerArtifactName: 'ComHub-${version}-${arch}.${ext}',
  protocolScheme: 'comhub',
  publisher: 'ComHub',
  shortcutName: 'ComHub',
  uninstallDisplayName: 'ComHub',
};

const validRelease = {
  channel: 'stable' as const,
  profileId: '00000000-0000-0000-0000-000000000001',
  releaseNotes: '  First stable release  ',
  version: '2.4.0',
};

describe('desktop build profile contract', () => {
  it('accepts the supported Windows profile fields', () => {
    expect(parseDesktopBuildProfilePayload(validPayload)).toEqual(validPayload);
  });

  it.each([
    'CON',
    '../ComHub',
    'ComHub.exe',
    'ComHub/Setup',
    'ComHub\\Setup',
    'ComHub:Setup',
    'ComHub*Setup',
    'ComHub?Setup',
    'ComHub<Setup',
    'ComHub>Setup',
    'ComHub"Setup',
    'ComHub|Setup',
    ' ComHub',
    'ComHub ',
    'ComHub\u0001',
    'ComHub\u001f',
    'prn',
    'CLOCK$',
    'CONIN$',
    'CONOUT$',
    'COM9',
    'LPT9',
  ])('rejects executable %s', (name) => {
    expect(() =>
      parseDesktopBuildProfilePayload({ ...validPayload, executableName: name }),
    ).toThrow();
  });

  it('accepts conservative executable base names up to 255 characters', () => {
    const executableName = 'ComHub (' + 'A'.repeat(246) + ')';
    expect(
      parseDesktopBuildProfilePayload({
        ...validPayload,
        executableName,
      }),
    ).toMatchObject({ executableName });
  });

  it('rejects executable names over the maximum length', () => {
    expect(() =>
      parseDesktopBuildProfilePayload({ ...validPayload, executableName: 'A'.repeat(256) }),
    ).toThrow();
  });

  it.each(['http://comhub.example.com', 'ftp://comhub.example.com', 'comhub.example.com'])(
    'rejects non-HTTPS homepage %s',
    (homepage) => {
      expect(() => parseDesktopBuildProfilePayload({ ...validPayload, homepage })).toThrow();
    },
  );

  it.each([
    '',
    'Com.qingyou.comhub',
    'qingyou',
    ' com.qingyou.comhub',
    'com.qingyou.comhub ',
    'com..qingyou',
    'com.-qingyou',
    'com.qingyou-',
    '1com.qingyou',
  ])('rejects invalid applicationId %s', (applicationId) => {
    expect(() => parseDesktopBuildProfilePayload({ ...validPayload, applicationId })).toThrow();
  });

  it.each(['com.qingyou.comhub', 'com.qingyou.comhub-desktop'])(
    'accepts valid applicationId %s',
    (applicationId) => {
      expect(parseDesktopBuildProfilePayload({ ...validPayload, applicationId })).toMatchObject({
        applicationId,
      });
    },
  );

  it('rejects an applicationId over 255 characters', () => {
    expect(() =>
      parseDesktopBuildProfilePayload({
        ...validPayload,
        applicationId: `com.${'a'.repeat(252)}`,
      }),
    ).toThrow();
  });

  it.each(['', 'Cohub', '1comhub', 'comhub:', 'comhub/path', ' comhub', 'comhub '])(
    'rejects invalid protocolScheme %s',
    (protocolScheme) => {
      expect(() => parseDesktopBuildProfilePayload({ ...validPayload, protocolScheme })).toThrow();
    },
  );

  it('accepts a lowercase protocol scheme at the 64-character limit', () => {
    const protocolScheme = `c${'o'.repeat(63)}`;
    expect(parseDesktopBuildProfilePayload({ ...validPayload, protocolScheme })).toMatchObject({
      protocolScheme,
    });
  });

  it('rejects a protocol scheme over 64 characters', () => {
    expect(() =>
      parseDesktopBuildProfilePayload({ ...validPayload, protocolScheme: `c${'o'.repeat(64)}` }),
    ).toThrow();
  });

  it('rejects unapproved artifact interpolation', () => {
    expect(() =>
      parseDesktopBuildProfilePayload({
        ...validPayload,
        installerArtifactName: '${env.HOME}-${version}.${ext}',
      }),
    ).toThrow();
  });

  it('does not retain interpolation scan state between payloads', () => {
    expect(() =>
      parseDesktopBuildProfilePayload({
        ...validPayload,
        installerArtifactName: '${version}-${env.HOME}',
      }),
    ).toThrow();
    expect(() =>
      parseDesktopBuildProfilePayload({
        ...validPayload,
        installerArtifactName: '${env.HOME}-aaaaaaaaaaaaaaaaaaaaaaaa-${version}',
      }),
    ).toThrow();
  });

  it('rejects unknown profile fields', () => {
    expect(() =>
      desktopBuildProfilePayloadSchema.parse({ ...validPayload, customBuilderKey: true }),
    ).toThrow();
  });
});

describe('desktop release input contract', () => {
  it('accepts and trims a stable SemVer 2.0 release', () => {
    expect(desktopReleaseInputSchema.parse(validRelease)).toEqual({
      ...validRelease,
      releaseNotes: 'First stable release',
    });
  });

  it('accepts a prerelease with build metadata', () => {
    expect(
      desktopReleaseInputSchema.parse({
        ...validRelease,
        channel: 'canary',
        version: '1.2.3-beta.1+build.7',
      }),
    ).toMatchObject({ channel: 'canary', version: '1.2.3-beta.1+build.7' });
  });

  it('trims a SemVer at the exact 64-character limit', () => {
    const version = `1.2.3+${'a'.repeat(58)}`;
    expect(version).toHaveLength(64);
    expect(
      desktopReleaseInputSchema.parse({ ...validRelease, version: `  ${version}  ` }).version,
    ).toBe(version);
  });

  it('rejects a SemVer over 64 characters after trimming', () => {
    const version = `1.2.3+${'a'.repeat(59)}`;
    expect(version).toHaveLength(65);
    expect(() => desktopReleaseInputSchema.parse({ ...validRelease, version })).toThrow();
  });

  it.each(['v2.4.0', '2.4', '01.2.3', '2.4.3-01', 'not-semver'])(
    'rejects invalid version %s',
    (version) => {
      expect(() => desktopReleaseInputSchema.parse({ ...validRelease, version })).toThrow();
    },
  );

  it('rejects a bad profile UUID', () => {
    expect(() =>
      desktopReleaseInputSchema.parse({ ...validRelease, profileId: 'profile-1' }),
    ).toThrow();
  });

  it('rejects oversized release notes', () => {
    expect(() =>
      desktopReleaseInputSchema.parse({ ...validRelease, releaseNotes: 'x'.repeat(10_001) }),
    ).toThrow();
  });

  it('allows empty trimmed release notes', () => {
    expect(
      desktopReleaseInputSchema.parse({ ...validRelease, releaseNotes: '   ' }).releaseNotes,
    ).toBe('');
  });

  it('rejects unknown release input fields', () => {
    expect(() =>
      desktopReleaseInputSchema.parse({ ...validRelease, revisionId: 'revision-1' }),
    ).toThrow();
  });
});
