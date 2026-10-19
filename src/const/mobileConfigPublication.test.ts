import { describe, expect, it } from 'vitest';

import { DEFAULT_MOBILE_CONFIG } from './mobileConfig';
import {
  createMobileConfigPublication,
  publishMobileConfigDraft,
  rollbackMobileConfigPublication,
  saveMobileConfigDraft,
} from './mobileConfigPublication';

const at = (minute: number) => `2026-07-20T08:${String(minute).padStart(2, '0')}:00.000Z`;

describe('mobile config publication', () => {
  it('keeps draft changes isolated from the published snapshot', () => {
    const initial = createMobileConfigPublication(DEFAULT_MOBILE_CONFIG, at(0));
    const saved = saveMobileConfigDraft(
      initial,
      { ...DEFAULT_MOBILE_CONFIG, brand: { displayName: 'Draft', logoUrl: null } },
      at(1),
    );

    expect(saved.draft).toMatchObject({ revision: 1, updatedAt: at(1) });
    expect(saved.draft.config.brand.displayName).toBe('Draft');
    expect(saved.published).toEqual(initial.published);
  });

  it('publishes only from the expected revision and records bounded history', () => {
    const initial = createMobileConfigPublication(DEFAULT_MOBILE_CONFIG, at(0));
    const saved = saveMobileConfigDraft(
      initial,
      { ...DEFAULT_MOBILE_CONFIG, brand: { displayName: 'Published', logoUrl: null } },
      at(1),
    );
    const published = publishMobileConfigDraft(saved, 0, 1, at(2));

    expect(published.published).toMatchObject({ revision: 1, updatedAt: at(2) });
    expect(published.published.config.brand.displayName).toBe('Published');
    expect(published.history.map((item) => item.revision)).toEqual([1, 0]);
    expect(() => publishMobileConfigDraft(published, 0, 2, at(3))).toThrow(
      'MOBILE_CONFIG_REVISION_CONFLICT',
    );
  });

  it('rejects publishing when the reviewed draft revision was replaced', () => {
    const initial = createMobileConfigPublication(DEFAULT_MOBILE_CONFIG, at(0));
    const reviewed = saveMobileConfigDraft(initial, DEFAULT_MOBILE_CONFIG, at(1));
    const replaced = saveMobileConfigDraft(reviewed, DEFAULT_MOBILE_CONFIG, at(2));

    expect(() => publishMobileConfigDraft(replaced, 0, reviewed.draft.revision, at(3))).toThrow(
      'MOBILE_CONFIG_REVISION_CONFLICT',
    );
  });

  it('rolls a historical snapshot forward as a new revision', () => {
    const initial = createMobileConfigPublication(DEFAULT_MOBILE_CONFIG, at(0));
    const first = publishMobileConfigDraft(
      saveMobileConfigDraft(
        initial,
        { ...DEFAULT_MOBILE_CONFIG, brand: { displayName: 'First', logoUrl: null } },
        at(1),
      ),
      0,
      1,
      at(2),
    );
    const second = publishMobileConfigDraft(
      saveMobileConfigDraft(
        first,
        { ...DEFAULT_MOBILE_CONFIG, brand: { displayName: 'Second', logoUrl: null } },
        at(3),
      ),
      1,
      3,
      at(4),
    );
    const rolledBack = rollbackMobileConfigPublication(second, 1, 2, 4, at(5));

    expect(rolledBack.published).toMatchObject({ revision: 3, updatedAt: at(5) });
    expect(rolledBack.published.config.brand.displayName).toBe('First');
    expect(rolledBack.draft.config.brand.displayName).toBe('First');
    expect(rolledBack.history.map((item) => item.revision)).toEqual([3, 2, 1, 0]);
  });

  it('rejects rollback when the current draft revision was replaced', () => {
    const initial = createMobileConfigPublication(DEFAULT_MOBILE_CONFIG, at(0));
    const replaced = saveMobileConfigDraft(initial, DEFAULT_MOBILE_CONFIG, at(1));

    expect(() => rollbackMobileConfigPublication(replaced, 0, 0, 0, at(2))).toThrow(
      'MOBILE_CONFIG_REVISION_CONFLICT',
    );
  });
});
