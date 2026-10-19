import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { globalHelpers } from '@/store/global/helpers';

import { discoverService } from './discover';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    market: {
      getAssistantDetail: {
        query: vi.fn(),
      },
      getGroupAgentDetail: {
        query: vi.fn(),
      },
      getMcpDetail: {
        query: vi.fn(),
      },
      skill: {
        getSkillDetail: {
          query: vi.fn(),
        },
        getSkillList: {
          query: vi.fn(),
        },
      },
    },
  },
}));

vi.mock('@/store/global/helpers', () => ({
  globalHelpers: {
    getCurrentLanguage: vi.fn(),
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: {
    getState: vi.fn(() => ({})),
  },
}));

vi.mock('@/store/user/selectors', () => ({
  userGeneralSettingsSelectors: {
    telemetry: vi.fn(() => false),
  },
}));

describe('DiscoverService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(globalHelpers.getCurrentLanguage).mockReturnValue('en-US');
    vi.mocked(lambdaClient.market.skill.getSkillList.query).mockResolvedValue({
      currentPage: 1,
      items: [],
      pageSize: 20,
      totalCount: 0,
      totalPages: 0,
    });
    vi.mocked(lambdaClient.market.getAssistantDetail.query).mockResolvedValue({
      identifier: 'assistant-demo',
    } as any);
    vi.mocked(lambdaClient.market.getGroupAgentDetail.query).mockResolvedValue({
      identifier: 'group-agent-demo',
    } as any);
    vi.mocked(lambdaClient.market.getMcpDetail.query).mockResolvedValue({
      identifier: 'mcp-demo',
    } as any);
    vi.mocked(lambdaClient.market.skill.getSkillDetail.query).mockResolvedValue({
      identifier: 'skill-demo',
    } as any);
  });

  it('injects a market token before fetching assistant details', async () => {
    const injectSpy = vi.spyOn(discoverService, 'safeInjectMPToken').mockResolvedValue(undefined);

    await discoverService.getAssistantDetail({
      identifier: 'assistant-demo',
      source: 'new',
      version: '1.0.0',
    });

    expect(injectSpy).toHaveBeenCalledBefore(lambdaClient.market.getAssistantDetail.query as any);
    expect(lambdaClient.market.getAssistantDetail.query).toHaveBeenCalledWith({
      identifier: 'assistant-demo',
      locale: 'en-US',
      source: 'new',
      version: '1.0.0',
    });
  });

  it('injects a market token before fetching group agent details', async () => {
    const injectSpy = vi.spyOn(discoverService, 'safeInjectMPToken').mockResolvedValue(undefined);

    await discoverService.getGroupAgentDetail({
      identifier: 'group-agent-demo',
      version: '1.0.0',
    });

    expect(injectSpy).toHaveBeenCalledBefore(lambdaClient.market.getGroupAgentDetail.query as any);
    expect(lambdaClient.market.getGroupAgentDetail.query).toHaveBeenCalledWith({
      identifier: 'group-agent-demo',
      locale: 'en-US',
      version: '1.0.0',
    });
  });

  it('injects a market token before fetching MCP details', async () => {
    const injectSpy = vi.spyOn(discoverService, 'safeInjectMPToken').mockResolvedValue(undefined);

    await discoverService.getMcpDetail({ identifier: 'mcp-demo', version: '1.0.0' });

    expect(injectSpy).toHaveBeenCalledBefore(lambdaClient.market.getMcpDetail.query as any);
    expect(lambdaClient.market.getMcpDetail.query).toHaveBeenCalledWith({
      identifier: 'mcp-demo',
      locale: 'en-US',
      version: '1.0.0',
    });
  });

  it('injects a market token before fetching skill details', async () => {
    const injectSpy = vi.spyOn(discoverService, 'safeInjectMPToken').mockResolvedValue(undefined);

    await discoverService.getSkillDetail({ identifier: 'skill-demo', version: '1.0.0' });

    expect(injectSpy).toHaveBeenCalledBefore(lambdaClient.market.skill.getSkillDetail.query as any);
    expect(lambdaClient.market.skill.getSkillDetail.query).toHaveBeenCalledWith({
      identifier: 'skill-demo',
      locale: 'en-US',
      version: '1.0.0',
    });
  });

  it('injects a market token before fetching skill lists', async () => {
    const injectSpy = vi.spyOn(discoverService, 'safeInjectMPToken').mockResolvedValue(undefined);

    await discoverService.getSkillList({ page: 2, pageSize: 10 });

    expect(injectSpy).toHaveBeenCalledBefore(lambdaClient.market.skill.getSkillList.query as any);
    expect(lambdaClient.market.skill.getSkillList.query).toHaveBeenCalledWith({
      locale: 'en-US',
      page: 2,
      pageSize: 10,
    });
  });
});
