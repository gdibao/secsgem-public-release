import {
  type ModuleAppAiChatInput,
  moduleAppAiChatInputSchema,
  type ModuleAppAiChatResult,
  moduleAppAiChatResultSchema,
  type ModuleAppAiModelList,
  moduleAppAiModelListSchema,
  type ModuleAppCapabilityClaims,
} from '@lobechat/types';
import { z } from 'zod';

import type { ModuleAppGatewayContext } from './context';

const emptyInputSchema = z.object({}).strict();

export type ModuleAppAiGatewayAdapter = {
  chat: (input: {
    capability: ModuleAppCapabilityClaims;
    context: ModuleAppGatewayContext;
    input: ModuleAppAiChatInput;
    requestId: string;
  }) => Promise<ModuleAppAiChatResult>;
  listModels: (input: {
    capability: ModuleAppCapabilityClaims;
    context: ModuleAppGatewayContext;
  }) => Promise<ModuleAppAiModelList>;
};

export class ModuleAppAiGateway {
  constructor(private readonly adapter: ModuleAppAiGatewayAdapter) {}

  chat = async (input: {
    capability: ModuleAppCapabilityClaims;
    context: ModuleAppGatewayContext;
    payload: unknown;
    requestId: string;
  }) => {
    const payload = moduleAppAiChatInputSchema.parse(input.payload);
    return moduleAppAiChatResultSchema.parse(
      await this.adapter.chat({
        capability: input.capability,
        context: input.context,
        input: payload,
        requestId: input.requestId,
      }),
    );
  };

  listModels = async (input: {
    capability: ModuleAppCapabilityClaims;
    context: ModuleAppGatewayContext;
    payload: unknown;
  }) => {
    if (input.payload !== undefined) emptyInputSchema.parse(input.payload);
    return moduleAppAiModelListSchema.parse(
      await this.adapter.listModels({
        capability: input.capability,
        context: input.context,
      }),
    );
  };
}
