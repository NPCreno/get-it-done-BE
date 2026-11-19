import { All, Controller, Logger, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createMcpHandler } from '@modelcontextprotocol/server';
import {
  toNodeHandler,
  type NodeMcpRequestHandler,
} from '@modelcontextprotocol/node';
import { RateLimit } from 'src/auth/rate-limit/rate-limit.decorator';
import { McpServerFactory } from './mcp-server.factory';

/**
 * The MCP endpoint (FEAT-07a), Streamable HTTP, stateless: a fresh McpServer
 * per request, no sessions, so a 2025-era GET/DELETE answers 405 (SDK
 * default). In front of it (McpModule middleware): the Origin check (403) and
 * requireBearerAuth with personal access tokens (401). The rate limit (429)
 * runs here as a guard, keyed on the token id.
 */
@Controller()
export class McpController {
  private readonly logger = new Logger('mcp');
  private readonly node: NodeMcpRequestHandler;

  constructor(factory: McpServerFactory) {
    const onerror = (e: Error) =>
      this.logger.warn(`${e.name}: ${e.message.slice(0, 200)}`);
    const handler = createMcpHandler(() => factory.create(), { onerror });
    this.node = toNodeHandler(handler, { onerror });
  }

  @RateLimit('mcp')
  @All('mcp')
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    // The JSON body was parsed by express.json (1 MB limit, app.setup.ts).
    await this.node(req, res, req.body);
  }
}
