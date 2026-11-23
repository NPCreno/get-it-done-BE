import * as z from 'zod/v4';
import { API_CONTRACT } from 'src/common/api-contract';
import { MessageOut, SharedProjectOut } from '../mcp-shapes';
import { defineTool } from '../mcp-tool';

const PAGE_MAX = API_CONTRACT.limits.chatMessagesPageMax;

export const listSharedProjects = defineTool({
  name: 'list_shared_projects',
  title: 'List projects shared with me',
  description:
    "Lists other users' projects that were shared with you (for their chat).",
  input: z.object({}).strict(),
  output: z.object({ projects: z.array(SharedProjectOut), count: z.int() }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  run: async (_a, { userId, deps }) => {
    const projects = (await deps.chatMembers.sharedWith(userId)).map((p) => ({
      project_id: p.project_id,
      title: p.title ?? null,
      color: p.color ?? null,
      owner_username: p.owner_username,
    }));
    return {
      summary: `${projects.length} shared project(s).`,
      data: { projects, count: projects.length },
    };
  },
});

const Person = z.object({ user_id: z.string(), username: z.string() });

export const listProjectMembers = defineTool({
  name: 'list_project_members',
  title: 'List project members',
  description:
    'Lists the owner and members of a project you own or that is shared with you: the people its tasks can be assigned to (use their username with assign_task or create_task).',
  input: z
    .object({
      project_id: z
        .string()
        .min(1)
        .max(100)
        .describe('The project id (project_id).'),
    })
    .strict(),
  output: z.object({ owner: Person, members: z.array(Person) }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  run: async (a, { userId, deps }) => {
    const people = await deps.chatMembers.list(a.project_id, userId);
    // Only id and username: never the full name or anything else.
    const person = (p: { user_id: string; username: string }) => ({
      user_id: p.user_id,
      username: p.username,
    });
    const owner = person(people.owner);
    const members = people.members.map(person);
    return {
      summary: `Owner ${owner.username}, ${members.length} member(s).`,
      data: { owner, members },
    };
  },
});

export const listChatMessages = defineTool({
  name: 'list_chat_messages',
  title: 'List chat messages',
  description:
    'Lists the newest chat messages of a project you own or that is shared with you, newest first.',
  input: z
    .object({
      project_id: z.string().min(1).max(100).describe('The project id.'),
      limit: z
        .int()
        .min(1)
        .max(PAGE_MAX)
        .optional()
        .describe(
          `Maximum number of messages (1-${PAGE_MAX}, default ${PAGE_MAX}).`,
        ),
    })
    .strict(),
  output: z.object({ messages: z.array(MessageOut), count: z.int() }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  run: async (a, { userId, deps }) => {
    const page = await deps.chatMessages.list(
      a.project_id,
      userId,
      a.limit ?? PAGE_MAX,
    );
    const messages = page.items.map((m) => ({
      id: m.id,
      project_id: m.project_id,
      author_username: m.username,
      body: m.body,
      created_at: m.created_at,
    }));
    return {
      summary: `${messages.length} message(s).`,
      data: { messages, count: messages.length },
    };
  },
});

export const getChatUnread = defineTool({
  name: 'get_chat_unread',
  title: 'Get unread chat counts',
  description: `Unread chat message counts per project (each capped at ${API_CONTRACT.chat.unreadCap}) and in total.`,
  input: z.object({}).strict(),
  output: z.object({
    items: z.array(z.object({ project_id: z.string(), unread_count: z.int() })),
    total: z.int(),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  run: async (_a, { userId, deps }) => {
    const data = await deps.chatUnread.unread(userId);
    return {
      summary: `${data.total} unread message(s) in ${data.items.length} project(s).`,
      data: { items: data.items, total: data.total },
    };
  },
});

export const CHAT_TOOLS = [
  listSharedProjects,
  listProjectMembers,
  listChatMessages,
  getChatUnread,
];
