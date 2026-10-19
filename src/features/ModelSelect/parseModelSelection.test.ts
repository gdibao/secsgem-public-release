import { describe, expect, it } from 'vitest';

import { parseModelSelection } from './parseModelSelection';

describe('parseModelSelection', () => {
  it('parses a provider/model option', () => {
    expect(parseModelSelection('myapi/default-vision', 'myapi')).toEqual({
      model: 'default-vision',
      provider: 'myapi',
    });
  });

  it('keeps model ids that contain slashes', () => {
    expect(parseModelSelection('provider/owner/model')).toEqual({
      model: 'owner/model',
      provider: 'provider',
    });
  });

  it('ignores transient empty or non-string values', () => {
    expect(parseModelSelection(undefined)).toBeUndefined();
    expect(parseModelSelection(null)).toBeUndefined();
    expect(parseModelSelection({})).toBeUndefined();
    expect(parseModelSelection('provider/')).toBeUndefined();
  });
});
