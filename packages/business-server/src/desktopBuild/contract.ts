import type { DesktopBuildProfilePayload, DesktopReleaseChannel } from '@lobechat/types';
import { z } from 'zod';

const APPLICATION_ID_PATTERN =
  /^[a-z](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const EXECUTABLE_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9 ()_-]*[A-Za-z0-9()_-])?$/;
const PROTOCOL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]+$/;
const WINDOWS_RESERVED_NAME_PATTERN =
  /^(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM[1-9]|LPT[1-9])$/i;
const ALLOWED_INTERPOLATION_TOKENS = new Set(['arch', 'ext', 'productName', 'version']);
const SEMVER_2_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const hasOnlyApprovedArtifactInterpolation = (value: string) => {
  const interpolationPattern = /\$\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;

  while ((match = interpolationPattern.exec(value))) {
    if (!ALLOWED_INTERPOLATION_TOKENS.has(match[1])) return false;
    lastIndex = match.index + match[0].length;
  }

  return !value.slice(lastIndex).includes('${');
};

const executableNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) => EXECUTABLE_NAME_PATTERN.test(value),
    'Executable name contains unsupported characters or surrounding whitespace.',
  )
  .refine(
    (value) => !WINDOWS_RESERVED_NAME_PATTERN.test(value.trim()),
    'Executable name is reserved by Windows.',
  );

export const desktopBuildProfilePayloadSchema = z
  .object({
    applicationId: z
      .string()
      .max(255)
      .regex(APPLICATION_ID_PATTERN, 'Application ID must use reverse-DNS format.'),
    applicationName: z.string(),
    description: z.string(),
    executableName: executableNameSchema,
    homepage: z
      .string()
      .url()
      .refine((value) => new URL(value).protocol === 'https:', 'Homepage must use HTTPS.'),
    installerArtifactName: z
      .string()
      .min(1)
      .refine(
        hasOnlyApprovedArtifactInterpolation,
        'Installer artifact names may only use approved interpolation tokens.',
      ),
    protocolScheme: z
      .string()
      .min(2)
      .max(64)
      .regex(PROTOCOL_SCHEME_PATTERN, 'Protocol scheme must use lowercase RFC 3986 syntax.'),
    publisher: z.string(),
    shortcutName: z.string(),
    uninstallDisplayName: z.string(),
  })
  .strict();

export const desktopReleaseInputSchema = z
  .object({
    channel: z.enum(['canary', 'stable'] satisfies [DesktopReleaseChannel, DesktopReleaseChannel]),
    profileId: z.string().uuid(),
    releaseNotes: z.string().trim().max(10_000),
    version: z.string().trim().max(64).regex(SEMVER_2_PATTERN, 'Version must be valid SemVer 2.0.'),
  })
  .strict();

export function parseDesktopBuildProfilePayload(input: unknown): DesktopBuildProfilePayload {
  return desktopBuildProfilePayloadSchema.parse(input);
}
