import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as z from 'zod/v4';
import { NotificationOut, toNotificationOut } from '../mcp-shapes';
import { unwrap } from '../mcp-errors';
import { dateInput, defineTool, limitInput } from '../mcp-tool';

export const getProfile = defineTool({
  name: 'get_profile',
  title: 'Get my profile',
  description: 'Gets your username, full name, email and theme.',
  input: z.object({}).strict(),
  output: z.object({
    username: z.string(),
    fullname: z.string(),
    email: z.string(),
    theme: z.string().nullable(),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  run: async (_a, { userId, deps }) => {
    // findOne returns the row without its password (theme included).
    const u = await deps.users.findOne(userId);
    if (!u) throw new NotFoundException('User not found');
    const data = {
      username: u.username,
      fullname: u.fullname,
      email: u.email,
      theme: u.theme ?? null,
    };
    return { summary: `Signed in as ${data.username}.`, data };
  },
});

/** Today in UTC, as the dashboard's default window. */
export function todayUtc(now = new Date()): { from: string; to: string } {
  const day = now.toISOString().slice(0, 10);
  return { from: `${day}T00:00:00.000Z`, to: `${day}T23:59:59.999Z` };
}

export const getDashboard = defineTool({
  name: 'get_dashboard',
  title: 'Get dashboard numbers',
  description:
    'The same numbers as the website dashboard: tasks in the window (due in it, overdue, or without a due date), how many are still to do, all completed tasks, projects, and the current streak in days. The window defaults to today (UTC).',
  input: z
    .object({
      from: dateInput
        .optional()
        .describe('Window start (default: today 00:00 UTC).'),
      to: dateInput
        .optional()
        .describe('Window end (default: today 23:59 UTC).'),
    })
    .strict(),
  output: z.object({
    from: z.string(),
    to: z.string(),
    total_tasks: z.int(),
    to_do: z.int(),
    completed: z.int(),
    projects: z.int(),
    streak_days: z.int(),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  run: async (a, { userId, deps }) => {
    const today = todayUtc();
    const from = new Date(a.from ?? today.from).toISOString();
    const to = new Date(a.to ?? today.to).toISOString();
    if (from > to) throw new BadRequestException('from must be before to');
    const dash = unwrap(
      await deps.taskStats.getDashboardData(userId, from, to),
    ).data!;
    const streak = unwrap(await deps.streak.getStreakCount(userId)).data!;
    const data = {
      from,
      to,
      total_tasks: dash.all_tasks,
      to_do: dash.pending_tasks,
      completed: dash.complete_tasks,
      projects: dash.all_projects,
      streak_days: streak.count,
    };
    return {
      summary: `${data.total_tasks} task(s) in the window, ${data.to_do} to do; ${data.completed} completed overall; streak ${data.streak_days} day(s).`,
      data,
    };
  },
});

export const listNotifications = defineTool({
  name: 'list_notifications',
  title: 'List notifications',
  description: 'Lists your notifications, newest first.',
  input: z
    .object({
      unread_only: z
        .boolean()
        .optional()
        .describe('Only unread ones (default false).'),
      limit: limitInput,
    })
    .strict(),
  output: z.object({
    notifications: z.array(NotificationOut),
    unread_count: z.int(),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  run: async (a, { userId, deps }) => {
    const page = await deps.notifications.list(
      userId,
      a.limit ?? 50,
      undefined,
      a.unread_only ?? false,
    );
    const notifications = page.items.map(toNotificationOut);
    return {
      summary: `${notifications.length} notification(s), ${page.unread_count} unread.`,
      data: { notifications, unread_count: page.unread_count },
    };
  },
});

export const markNotificationRead = defineTool({
  name: 'mark_notification_read',
  title: 'Mark a notification read',
  description: 'Marks one of your notifications as read.',
  input: z
    .object({
      notif_id: z
        .string()
        .min(1)
        .max(100)
        .describe('The notification id (notif_id).'),
    })
    .strict(),
  output: z.object({ notif_id: z.string(), read: z.literal(true) }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  run: async (a, { userId, deps }) => {
    await deps.notifications.markRead(userId, a.notif_id);
    return {
      summary: 'Marked as read.',
      data: { notif_id: a.notif_id, read: true as const },
    };
  },
});

export const ACCOUNT_TOOLS = [
  getProfile,
  getDashboard,
  listNotifications,
  markNotificationRead,
];
