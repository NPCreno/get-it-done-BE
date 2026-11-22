import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/server';
import { TaskService } from 'src/task/task.service';
import { TaskAccessService } from 'src/task/task-access.service';
import { TaskQueryService } from 'src/task/task-query.service';
import { SubTaskService } from 'src/task/subtask.service';
import { TaskStatusService } from 'src/task/task-status.service';
import { TaskStatsService } from 'src/task/task-stats.service';
import { TaskStreakService } from 'src/task/task-streak.service';
import { ProjectsService } from 'src/projects/projects.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { UserService } from 'src/user/user.service';
import { ChatMembersService } from 'src/chat/chat-members.service';
import { ChatMessagesService } from 'src/chat/chat-messages.service';
import { ChatUnreadService } from 'src/chat/chat-unread.service';
import { McpDeps } from './mcp-tool';
import { TASK_TOOLS } from './tools/task-tools';
import { PROJECT_TOOLS } from './tools/project-tools';
import { ACCOUNT_TOOLS } from './tools/account-tools';
import { CHAT_TOOLS } from './tools/chat-tools';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version } = require('../../package.json') as { version: string };

/** Every tool, in the order tools/list shows them. */
export const ALL_TOOLS = [
  ...ACCOUNT_TOOLS,
  ...TASK_TOOLS,
  ...PROJECT_TOOLS,
  ...CHAT_TOOLS,
];

export const MCP_INSTRUCTIONS =
  'Get It Done is a personal task manager. These tools read and manage the signed-in user\'s tasks, sub-tasks, projects and notifications, and read the chat of projects they own or that are shared with them. In a shared project the owner and every member can add, edit, assign and complete its tasks; "your tasks" are the ones you\'re responsible for (yours, or assigned to you). Every call acts only on data that user may see. Dates are ISO 8601 in UTC. Deletes are soft: deleted items disappear from lists but are kept and can be restored by support.';

/**
 * Builds one McpServer per request (stateless: createMcpHandler calls the
 * factory for every request). Tools get the user from the verified token.
 */
@Injectable()
export class McpServerFactory {
  private readonly deps: McpDeps;

  constructor(
    tasks: TaskService,
    taskQuery: TaskQueryService,
    subtasks: SubTaskService,
    taskStatus: TaskStatusService,
    taskStats: TaskStatsService,
    streak: TaskStreakService,
    projects: ProjectsService,
    notifications: NotificationsService,
    users: UserService,
    chatMembers: ChatMembersService,
    chatMessages: ChatMessagesService,
    chatUnread: ChatUnreadService,
    taskAccess: TaskAccessService,
  ) {
    this.deps = {
      tasks,
      taskAccess,
      taskQuery,
      subtasks,
      taskStatus,
      taskStats,
      streak,
      projects,
      notifications,
      users,
      chatMembers,
      chatMessages,
      chatUnread,
    };
  }

  create(): McpServer {
    const server = new McpServer(
      { name: 'get-it-done', version },
      { instructions: MCP_INSTRUCTIONS },
    );
    for (const register of ALL_TOOLS) register(server, this.deps);
    return server;
  }
}
