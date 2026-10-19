import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { ChatService } from '../services/chat.service';
import type {
  ChatServiceParams,
  MessageGenerationParams,
  TranslateServiceParams,
} from '../types/chat.type';
import { resolveOpenApiOperationId } from '../utils/operationId';

export class ChatController extends BaseController {
  /**
   * General chat endpoint
   * POST /api/v1/chat
   * Body: ChatServiceParams
   */
  async handleChat(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const chatParams = (await this.getBody<ChatServiceParams>(c))!;

      const db = await this.getDatabase();
      const workspaceId = this.getWorkspaceId(c);
      const config = {
        operationId: resolveOpenApiOperationId((name) => c.req.header(name)),
      };
      const chatService = workspaceId
        ? new ChatService(db, userId, workspaceId, config)
        : new ChatService(db, userId, config);

      const result = await chatService.chat(chatParams);
      return this.success(c, result, 'Chat completed successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Text translation endpoint
   * POST /api/v1/chat/translate
   * Body: TranslateServiceParams
   */
  async handleTranslate(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const translateParams = (await this.getBody<TranslateServiceParams>(c))!;

      const db = await this.getDatabase();
      const chatService = new ChatService(db, userId, this.getWorkspaceId(c));
      const result = await chatService.translate(translateParams);

      return this.success(c, { translatedText: result }, 'Translation successful');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Message reply generation endpoint
   * POST /api/v1/chat/generate-reply
   * Body: MessageGenerationParams
   */
  async handleGenerateReply(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const generationParams = (await this.getBody<MessageGenerationParams>(c))!;

      const db = await this.getDatabase();
      const chatService = new ChatService(db, userId, this.getWorkspaceId(c));
      const result = await chatService.generateReply(generationParams);

      return this.success(c, { reply: result }, 'Reply generated successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
