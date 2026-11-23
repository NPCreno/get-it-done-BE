import { Logger } from '@nestjs/common';
import type {
  CallToolResult,
  McpServer,
  ServerContext,
  ToolAnnotations,
  ToolCallback,
} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TaskService } from 'src/task/task.service';
import type { TaskAccessService } from 'src/task/task-access.service';
import type { TaskAssignService } from 'src/task/task-assign.service';
import type { TaskQueryService } from 'src/task/task-query.service';
import type { SubTaskService } from 'src/task/subtask.service';
import type { TaskStatusService } from 'src/task/task-status.service';
import type { TaskStatsService } from 'src/task/task-stats.service';
import type { TaskStreakService } from 'src/task/task-streak.service';
import type { ProjectsService } from 'src/projects/projects.service';
import type { NotificationsService } from 'src/notifications/notifications.service';
import type { UserService } from 'src/user/user.service';
import type { ChatMembersService } from 'src/chat/chat-members.service';
import type { ChatMessagesService } from 'src/chat/chat-messages.service';
import type { ChatUnreadService } from 'src/chat/chat-unread.service';
import { toolErrorMessage } from './mcp-errors';

/** The services the tools call: the same ones the REST routes use. */
export interface McpDeps {
  tasks: TaskService;
  taskAccess: TaskAccessService;
  taskAssign: TaskAssignService;
  taskQuery: TaskQueryService;
  subtasks: SubTaskService;
  taskStatus: TaskStatusService;
  taskStats: TaskStatsService;
  streak: TaskStreakService;
  projects: ProjectsService;
  notifications: NotificationsService;
  users: UserService;
  chatMembers: ChatMembersService;
  chatMessages: ChatMessagesService;
  chatUnread: ChatUnreadService;
}

export interface ToolCall {
  /** The token's user (from the verified AuthInfo), never a tool input. */
  userId: string;
  deps: McpDeps;
}

export interface ToolSpec<I extends z.ZodObject, O extends z.ZodObject> {
  name: string;
  title: string;
  description: string;
  input: I;
  output: O;
  annotations: ToolAnnotations;
  run: (
    args: z.infer<I>,
    call: ToolCall,
  ) => Promise<{ summary: string; data: z.infer<O> }>;
}

export type RegisterTool = (server: McpServer, deps: McpDeps) => void;

const logger = new Logger('mcp');

/** The verified identity behind this call (set by PatVerifier). */
export function authOf(ctx: ServerContext): { userId: string; prefix: string } {
  const extra = ctx.http?.authInfo?.extra;
  const userId = extra?.userId;
  const prefix = extra?.prefix;
  if (typeof userId !== 'string' || userId === '')
    throw new Error('MCP call without a verified token');
  return { userId, prefix: typeof prefix === 'string' ? prefix : '?' };
}

/** Summary text plus a compact JSON block; the same data as structuredContent. */
export function toolResult(summary: string, data: object): CallToolResult {
  return {
    content: [
      { type: 'text', text: summary },
      { type: 'text', text: JSON.stringify(data) },
    ],
    structuredContent: data,
  };
}

export function toolError(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Registers one tool. Every call logs one line (tool, token prefix, user,
 * duration, ok/error), never the arguments or the result. Errors become
 * `isError` results with a safe message (see toolErrorMessage); unexpected
 * ones are logged in full.
 */
export function defineTool<I extends z.ZodObject, O extends z.ZodObject>(
  spec: ToolSpec<I, O>,
): RegisterTool & { spec: ToolSpec<I, O> } {
  const register = (server: McpServer, deps: McpDeps) => {
    // The SDK has already validated `args` against spec.input (strict zod).
    const callback = async (
      args: unknown,
      ctx: ServerContext,
    ): Promise<CallToolResult> => {
      const started = Date.now();
      let who = { userId: '?', prefix: '?' };
      try {
        who = authOf(ctx);
        const { summary, data } = await spec.run(args as z.infer<I>, {
          userId: who.userId,
          deps,
        });
        logger.log(line(spec.name, who, started, 'ok'));
        return toolResult(summary, data);
      } catch (err) {
        const { message, expected } = toolErrorMessage(err);
        logger.log(line(spec.name, who, started, 'error'));
        if (!expected)
          logger.error(
            `tool=${spec.name} failed`,
            err instanceof Error ? err.stack : JSON.stringify(err),
          );
        return toolError(message);
      }
    };
    server.registerTool(
      spec.name,
      {
        title: spec.title,
        description: spec.description,
        inputSchema: spec.input,
        outputSchema: spec.output,
        annotations: { title: spec.title, ...spec.annotations },
      },
      callback as unknown as ToolCallback<I>,
    );
  };
  return Object.assign(register, { spec });
}

function line(
  tool: string,
  who: { userId: string; prefix: string },
  started: number,
  outcome: 'ok' | 'error',
): string {
  return `tool=${tool} prefix=${who.prefix} user=${who.userId} ms=${Date.now() - started} ${outcome}`;
}

/** Shared input fields. */
export const limitInput = z
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe('Maximum number of results (1-100, default 50).');
export const dateInput = z
  .union([z.iso.datetime({ offset: true }), z.iso.date()])
  .describe('ISO 8601 date (2026-11-20) or date-time with offset (UTC).');
