import { Request, Response } from 'express';
import { AssistantService } from './services/assistant.service.js';
import { AssistantContextType, AssistantMode } from './context/context.types.js';

const assistantService = new AssistantService();

export class AssistantController {
  static chat = async (req: Request, res: Response): Promise<void> => {
    const { message, context, mode, contextPayload, conversationHistory, stream } = req.body as {
      message: string;
      context: AssistantContextType;
      mode: AssistantMode;
      contextPayload?: Record<string, unknown>;
      conversationHistory?: any[];
      stream?: boolean;
    };
    const userId = req.user!.userId;

    const isStreamRequested =
      stream === true || (typeof req.headers.accept === 'string' && req.headers.accept.includes('text/event-stream'));

    if (isStreamRequested) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      if (typeof (res as any).flushHeaders === 'function') {
        (res as any).flushHeaders();
      }

      let clientDisconnected = false;
      req.on('close', () => {
        clientDisconnected = true;
      });

      try {
        const data = await assistantService.chatStream(
          userId,
          message,
          context,
          mode,
          { contextPayload, conversationHistory },
          (chunkText: string) => {
            if (!clientDisconnected) {
              res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunkText })}\n\n`);
            }
          }
        );

        if (!clientDisconnected) {
          res.write(`data: ${JSON.stringify({ type: 'done', data })}\n\n`);
          res.end();
        }
      } catch (err: any) {
        console.error('[AssistantController.chat] Streaming failed:', err?.message || err);
        if (!clientDisconnected) {
          res.write(`data: ${JSON.stringify({ type: 'error', error: err?.message || 'Assistant generation failed' })}\n\n`);
          res.end();
        }
      }
      return;
    }

    const data = await assistantService.chat(userId, message, context, mode, { contextPayload, conversationHistory });
    res.status(200).json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    });
  };
}
