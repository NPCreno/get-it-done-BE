import * as z from 'zod/v4';
import { API_CONTRACT } from 'src/common/api-contract';
import type { TaskInstanceEntity } from 'src/task/models/taskInstance.entity';
import type { TaskSubInstanceEntity } from 'src/task/models/taskSubInstance.entity';
import type { SubtaskCounts } from 'src/task/task-query.service';
import type { ProjectWithCounts } from 'src/projects/projects.service';
import type { NotificationDto } from 'src/notifications/notification.dto';

/**
 * Safe output shapes for the MCP tools (FEAT-07a): no user objects, no
 * internal numeric or uuid row ids, no password or token fields. Dates are ISO
 * 8601 strings in UTC.
 */
const isoOrNull = z.string().nullable();
const iso = (d: Date | string | null | undefined): string | null =>
  d === null || d === undefined ? null : new Date(d).toISOString();

export const TaskStatus = z.enum(API_CONTRACT.taskStatuses);
export const TaskPriority = z.enum(API_CONTRACT.taskPriorities);

export const TaskOut = z.object({
  task_id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: TaskStatus,
  priority: TaskPriority,
  due_date: isoOrNull,
  project_id: z.string().nullable(),
  project_title: z.string().nullable(),
  is_recurring: z.boolean(),
  subtask_count: z.int(),
  subtasks_completed: z.int(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type TaskOutT = z.infer<typeof TaskOut>;

export const SubtaskOut = z.object({
  subtask_id: z.string(),
  task_id: z.string().nullable(),
  title: z.string(),
  status: TaskStatus,
  due_date: isoOrNull,
  created_at: z.string(),
});
export type SubtaskOutT = z.infer<typeof SubtaskOut>;

export const ProjectOut = z.object({
  project_id: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  color: z.string().nullable(),
  color_label: z.string().nullable(),
  due_date: isoOrNull,
  created_at: z.string(),
  task_count: z.int(),
  tasks_completed: z.int(),
});
export type ProjectOutT = z.infer<typeof ProjectOut>;

export const NotificationOut = z.object({
  notif_id: z.string(),
  type: z.string(),
  title: z.string(),
  message: z.string(),
  read: z.boolean(),
  created_at: z.string(),
});

export const MessageOut = z.object({
  id: z.string(),
  project_id: z.string(),
  author_username: z.string(),
  body: z.string(),
  created_at: z.string(),
});

export const SharedProjectOut = z.object({
  project_id: z.string(),
  title: z.string().nullable(),
  color: z.string().nullable(),
  owner_username: z.string(),
});

export function toTaskOut(
  t: TaskInstanceEntity,
  counts?: SubtaskCounts,
): TaskOutT {
  return {
    task_id: t.task_id,
    title: t.title,
    description: t.description ?? null,
    status: t.status,
    priority: t.priority,
    due_date: iso(t.due_date),
    project_id: t.project?.project_id ?? null,
    project_title: t.project?.title ?? null,
    is_recurring: Boolean(t.template),
    subtask_count: counts?.total ?? 0,
    subtasks_completed: counts?.completed ?? 0,
    created_at: iso(t.createdAt)!,
    updated_at: iso(t.updatedAt)!,
  };
}

export function toSubtaskOut(
  s: TaskSubInstanceEntity,
  taskId: string | null = s.instance?.task_id ?? null,
): SubtaskOutT {
  return {
    subtask_id: s.taskSubInstance_id,
    task_id: taskId,
    title: s.title,
    status: s.status,
    due_date: iso(s.due_date),
    created_at: iso(s.createdAt)!,
  };
}

export function toProjectOut(p: ProjectWithCounts): ProjectOutT {
  return {
    project_id: p.project_id,
    title: p.title ?? null,
    description: p.description ?? null,
    color: p.color ?? null,
    color_label: p.colorLabel ?? null,
    due_date: iso(p.due_date),
    created_at: iso(p.createdAt)!,
    task_count: Number(p.task_count),
    tasks_completed: Number(p.tasks_completed),
  };
}

export function toNotificationOut(n: NotificationDto) {
  return {
    notif_id: n.notif_id,
    type: String(n.type),
    title: n.title,
    message: n.message,
    read: n.read,
    created_at: n.createdAt,
  };
}

export { iso as toIso };
