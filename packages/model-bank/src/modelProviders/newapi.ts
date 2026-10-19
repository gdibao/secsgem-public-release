import type { ModelProviderCard } from '../types';

const NewAPI: ModelProviderCard = {
  chatModels: [],
  checkModel: 'gpt-4o-mini',
  description:
    'Manage AI providers through provider gateways or compatible OpenAI, Claude, and OpenCode Go formats.',
  enabled: true,
  id: 'newapi',
  name: 'AI Provider',
  settings: {
    proxyUrl: {
      placeholder: 'https://your.new-api-provider.com',
    },
    sdkType: 'router',
    showModelFetcher: true,
    supportResponsesApi: true,
  },
  url: 'https://github.com/Calcium-Ion/new-api',
};

export default NewAPI;
