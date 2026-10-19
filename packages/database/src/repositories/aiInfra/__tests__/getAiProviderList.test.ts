import type { AiProviderListItem } from '@lobechat/types';
import { DEFAULT_MODEL_PROVIDER_LIST } from 'model-bank/modelProviders';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import type { LobeChatDatabase } from '../../../type';
import { AiInfraRepos } from '../index';

const userId = 'test-user-id';
const mockProviderConfigs = {
  openai: { enabled: true },
  anthropic: { enabled: false },
};

let serverDB: LobeChatDatabase;
let repo: AiInfraRepos;

beforeAll(async () => {
  serverDB = await getTestDB();
}, 30000);

beforeEach(() => {
  vi.clearAllMocks();
  repo = new AiInfraRepos(serverDB, userId, mockProviderConfigs);
});

describe('AiInfraRepos', () => {
  describe('getAiProviderList', () => {
    it('should merge builtin and user providers correctly', async () => {
      const mockUserProviders = [
        { id: 'openai', enabled: true, name: 'Custom OpenAI' },
        { id: 'custom', enabled: true, name: 'Custom Provider' },
      ] as AiProviderListItem[];

      vi.spyOn(repo.aiProviderModel, 'getAiProviderList').mockResolvedValueOnce(mockUserProviders);

      const result = await repo.getAiProviderList();

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      // Verify the merge logic
      const openaiProvider = result.find((p) => p.id === 'openai');
      expect(openaiProvider).toMatchObject({ enabled: true, name: 'Custom OpenAI' });
    });

    it('uses backend provider config as the authority in business builds', async () => {
      const mockUserProviders = [
        { id: 'deepseek', enabled: true, name: 'DeepSeek' },
        { id: 'custom-user-provider', enabled: true, name: 'User Provider', source: 'custom' },
      ] as AiProviderListItem[];

      vi.spyOn(repo.aiProviderModel, 'getAiProviderList').mockResolvedValueOnce(mockUserProviders);

      const result = await repo.getAiProviderList();

      expect(result.find((p) => p.id === 'openai')).toMatchObject({ enabled: true });
      expect(result.find((p) => p.id === 'deepseek')).toMatchObject({ enabled: false });
      expect(result.find((p) => p.id === 'custom-user-provider')).toMatchObject({
        enabled: false,
      });
    });

    it('should sort providers according to DEFAULT_MODEL_PROVIDER_LIST order', async () => {
      vi.spyOn(repo.aiProviderModel, 'getAiProviderList').mockResolvedValue([]);

      const result = await repo.getAiProviderList();

      expect(result).toEqual(
        expect.arrayContaining(
          DEFAULT_MODEL_PROVIDER_LIST.map((item) =>
            expect.objectContaining({
              id: item.id,
              source: 'builtin',
            }),
          ),
        ),
      );
    });
  });
});
