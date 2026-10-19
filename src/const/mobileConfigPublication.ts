import {
  DEFAULT_MOBILE_CONFIG,
  type MobilePublicConfigV1,
  normalizeMobileConfig,
} from './mobileConfig';

export const MOBILE_CONFIG_HISTORY_LIMIT = 20;

export interface MobileConfigRevisionSnapshot {
  config: MobilePublicConfigV1;
  revision: number;
  updatedAt: string;
}

export interface MobileConfigPublicationState {
  draft: MobileConfigRevisionSnapshot;
  history: MobileConfigRevisionSnapshot[];
  published: MobileConfigRevisionSnapshot;
}

const normalizeRevision = (value: unknown, fallback = 0) => {
  const revision = Number(value);
  return Number.isInteger(revision) && revision >= 0 ? revision : fallback;
};

const normalizeUpdatedAt = (value: unknown, fallback: string) => {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return fallback;
  return new Date(value).toISOString();
};

export const normalizeMobileConfigRevisionSnapshot = (
  value: unknown,
  fallback: MobileConfigRevisionSnapshot,
): MobileConfigRevisionSnapshot => {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    config: normalizeMobileConfig(raw.config ?? fallback.config),
    revision: normalizeRevision(raw.revision, fallback.revision),
    updatedAt: normalizeUpdatedAt(raw.updatedAt, fallback.updatedAt),
  };
};

const normalizeHistory = (
  value: unknown,
  published: MobileConfigRevisionSnapshot,
): MobileConfigRevisionSnapshot[] => {
  const source = Array.isArray(value) ? value : [];
  const byRevision = new Map<number, MobileConfigRevisionSnapshot>();

  for (const item of [published, ...source]) {
    const snapshot = normalizeMobileConfigRevisionSnapshot(item, published);
    if (!byRevision.has(snapshot.revision)) byRevision.set(snapshot.revision, snapshot);
  }

  return Array.from(byRevision.values())
    .sort((left, right) => right.revision - left.revision)
    .slice(0, MOBILE_CONFIG_HISTORY_LIMIT);
};

export const createMobileConfigPublication = (
  config: unknown = DEFAULT_MOBILE_CONFIG,
  updatedAt = new Date().toISOString(),
): MobileConfigPublicationState => {
  const published = {
    config: normalizeMobileConfig(config),
    revision: 0,
    updatedAt: normalizeUpdatedAt(updatedAt, new Date().toISOString()),
  };

  return { draft: published, history: [published], published };
};

export const normalizeMobileConfigPublication = (
  value: unknown,
  legacyConfig: unknown = DEFAULT_MOBILE_CONFIG,
  updatedAt = new Date().toISOString(),
): MobileConfigPublicationState => {
  const fallback = createMobileConfigPublication(legacyConfig, updatedAt);
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const published = normalizeMobileConfigRevisionSnapshot(raw.published, fallback.published);
  const draft = normalizeMobileConfigRevisionSnapshot(raw.draft, published);

  return {
    draft,
    history: normalizeHistory(raw.history, published),
    published,
  };
};

export const saveMobileConfigDraft = (
  state: MobileConfigPublicationState,
  config: unknown,
  updatedAt = new Date().toISOString(),
): MobileConfigPublicationState => ({
  ...state,
  draft: {
    config: normalizeMobileConfig(config),
    revision: state.draft.revision + 1,
    updatedAt: normalizeUpdatedAt(updatedAt, new Date().toISOString()),
  },
});

const assertExpectedRevisions = (
  state: MobileConfigPublicationState,
  expectedRevision: number,
  expectedDraftRevision: number,
) => {
  if (
    state.published.revision !== expectedRevision ||
    state.draft.revision !== expectedDraftRevision
  ) {
    throw new Error('MOBILE_CONFIG_REVISION_CONFLICT');
  }
};

const publishSnapshot = (
  state: MobileConfigPublicationState,
  config: unknown,
  updatedAt: string,
): MobileConfigPublicationState => {
  const published = {
    config: normalizeMobileConfig(config),
    revision: state.published.revision + 1,
    updatedAt: normalizeUpdatedAt(updatedAt, new Date().toISOString()),
  };

  return {
    draft: {
      config: published.config,
      revision: state.draft.revision + 1,
      updatedAt: published.updatedAt,
    },
    history: normalizeHistory([published, ...state.history], published),
    published,
  };
};

export const publishMobileConfigDraft = (
  state: MobileConfigPublicationState,
  expectedRevision: number,
  expectedDraftRevision: number,
  updatedAt = new Date().toISOString(),
) => {
  assertExpectedRevisions(state, expectedRevision, expectedDraftRevision);
  return publishSnapshot(state, state.draft.config, updatedAt);
};

export const rollbackMobileConfigPublication = (
  state: MobileConfigPublicationState,
  targetRevision: number,
  expectedRevision: number,
  expectedDraftRevision: number,
  updatedAt = new Date().toISOString(),
) => {
  assertExpectedRevisions(state, expectedRevision, expectedDraftRevision);
  const target = state.history.find((item) => item.revision === targetRevision);
  if (!target) throw new Error('MOBILE_CONFIG_REVISION_NOT_FOUND');
  return publishSnapshot(state, target.config, updatedAt);
};
