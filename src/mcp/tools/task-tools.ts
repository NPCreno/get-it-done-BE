import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as z from 'zod/v4';
import { API_CONTRACT } from 'src/common/api-contract';
import { CreateTaskDto } from 'src/task/dto/create-task-dto';
import { UpdateTaskDto } from 'src/task/dto/update-task-dto';
import { CreateTaskSubInstanceDto } from 'src/task/dto/create-task-subInstance-dto';
import type { TaskTemplateEntity } from 'src/task/models/taskTemplate.entity';
import type { TaskInstanceEntity } from 'src/task/models/taskInstance.entity';
import {
  SubtaskOut,
  TaskOut,
  TaskOutT,
  TaskPriority,
  TaskStatus,
  toIso,
  toSubtaskOut,
  toTaskOut,
} from '../mcp-shapes';
import { unwrap } from '../mcp-errors';
import { toDto } from '../mcp-validate';
import {
  dateInput,
  defineTool,
  limitInput,
  McpDeps,
  ToolCall,
} from '../mcp-tool';

const L = API_CONTRACT.limits;
const taskId = z.string().min(1).max(100).describe('The task id (task_id).');
const projectId = z
  .string()
  .min(1)
  .max(100)
  .describe('A project id (project_id) from list_projects.');

/** The caller's task as a safe shape, or 404 "Task not found". */
async function ownTask(
  deps: McpDeps,
  userId: string,
  id: string,
): Promise<{ entity: TaskInstanceEntity; out: TaskOutT }> {
  const entity = await deps.taskQuery.findOwnTask(userId, id);
  if (!entity) throw new NotFoundException('Task not found');
  const counts = await deps.taskQuery.subtaskCounts([entity.task_id]);
  return { entity, out: toTaskOut(entity, counts.get(entity.task_id)) };
}

export const listTasks = defineTool({
  name: 'list_tasks',
  title: 'List tasks',
  description:
    'Lists your tasks (not deleted), soonest due first, with sub-task counts. All filters are optional and combine.',
  input: z
    .object({
      status: TaskStatus.optional().describe('Only tasks with this status.'),
      project_id: projectId
        .optional()
        .describe('Only tasks in this project (project_id).'),
      due_from: dateInput
        .optional()
        .describe('Only tasks due at or after this ISO 8601 date/time (UTC).'),
      due_to: dateInput
        .optional()
        .describe('Only tasks due at or before this ISO 8601 date/time (UTC).'),
      search: z
        .string()
        .min(1)
        .max(L.titleMax)
        .optional()
        .describe('Only tasks whose title contains this text (any case).'),
      include_completed: z
        .boolean()
        .optional()
        .describe('Include completed tasks (default true).'),
      limit: limitInput,
    })
    .strict(),
  output: z.object({ tasks: z.array(TaskOut), count: z.int() }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  run: async (a, { userId, deps }) => {
    const rows = await deps.taskQuery.listOwnTasks(userId, {
      status: a.status,
      project_id: a.project_id,
      due_from: a.due_from ? new Date(a.due_from) : undefined,
      due_to: a.due_to ? new Date(a.due_to) : undefined,
      search: a.search,
      include_completed: a.include_completed,
      limit: a.limit ?? 50,
    });
    const counts = await deps.taskQuery.subtaskCounts(
      rows.map((t) => t.task_id),
    );
    const tasks = rows.map((t) => toTaskOut(t, counts.get(t.task_id)));
    return {
      summary: `${tasks.length} task(s).`,
      data: { tasks, count: tasks.length },
    };
  },
});

export const getTask = defineTool({
  name: 'get_task',
  title: 'Get a task',
  description: 'Gets one of your tasks with its sub-tasks.',
  input: z.object({ task_id: taskId }).strict(),
  output: z.object({ task: TaskOut, subtasks: z.array(SubtaskOut) }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  run: async (a, { userId, deps }) => {
    const { entity, out } = await ownTask(deps, userId, a.task_id);
    const subs = await deps.taskQuery.subtasksOf(entity.task_id);
    return {
      summary: `Task "${out.title}" (${out.status}), ${subs.length} sub-task(s).`,
      data: {
        task: out,
        subtasks: subs.map((s) => toSubtaskOut(s, entity.task_id)),
      },
    };
  },
});

const createTaskInput = z
  .object({
    title: z
      .string()
      .min(L.titleMin)
      .max(L.titleMax)
      .describe(`Task title (${L.titleMin}-${L.titleMax} characters).`),
    description: z
      .string()
      .max(L.descriptionMax)
      .optional()
      .describe(`Optional details (up to ${L.descriptionMax} characters).`),
    due_date: dateInput.optional().describe('When the task is due (UTC).'),
    priority: TaskPriority.optional().describe('Priority (default Medium).'),
    status: z
      .enum(API_CONTRACT.newTaskStatuses)
      .optional()
      .describe('Initial status (default Pending).'),
    project_id: projectId
      .optional()
      .describe('Put the task in this project (project_id).'),
    is_recurring: z
      .boolean()
      .optional()
      .describe(
        'Create a recurring task (default false). Needs repeat_every and start_date.',
      ),
    repeat_every: z
      .enum(API_CONTRACT.repeatEvery)
      .optional()
      .describe('Recurring only: how often it repeats.'),
    repeat_days: z
      .array(z.enum(API_CONTRACT.weekdays))
      .min(1)
      .max(7)
      .optional()
      .describe('Recurring weekly only: the weekdays it repeats on.'),
    start_date: dateInput
      .optional()
      .describe('Recurring only: first day of the series.'),
    end_date: dateInput
      .optional()
      .describe('Recurring only: last day of the series (optional).'),
  })
  .strict();

/** Maps create_task input to the REST CreateTaskDto body (pure; unit-tested). */
export function createTaskBody(
  a: z.infer<typeof createTaskInput>,
): Record<string, unknown> {
  return {
    title: a.title,
    description: a.description,
    due_date: a.due_date,
    priority: a.priority ?? 'Medium',
    status: a.status ?? 'Pending',
    project_id: a.project_id,
    isRecurring: a.is_recurring ?? false,
    repeat_every: a.repeat_every,
    repeat_days: a.repeat_days,
    start_date: a.start_date,
    end_date: a.end_date,
  };
}

const RecurringOut = z.object({
  template_id: z.string(),
  title: z.string(),
  repeat_every: z.string(),
  repeat_days: z.array(z.string()).nullable(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  project_id: z.string().nullable(),
});

export const createTask = defineTool({
  name: 'create_task',
  title: 'Create a task',
  description:
    'Creates a task for you, or a recurring series (its tasks for the current month are created right away). Validated with the same rules as the website.',
  input: createTaskInput,
  output: z.object({
    task: TaskOut.optional(),
    recurring: RecurringOut.optional(),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (a, { userId, deps }) => {
    const dto = await toDto(CreateTaskDto, createTaskBody(a));
    if (dto.project_id) await ownProject(deps, userId, dto.project_id);
    const res = unwrap(await deps.tasks.createTask(dto, userId));
    if (dto.isRecurring) {
      const t = res.data as TaskTemplateEntity;
      const recurring = {
        template_id: t.taskTemplate_id,
        title: t.title,
        repeat_every: t.repeat_every,
        repeat_days: t.repeat_days ?? null,
        start_date: toIso(t.start_date),
        end_date: toIso(t.end_date),
        project_id: t.project_id ?? null,
      };
      return {
        summary: `Created recurring task "${t.title}" (every ${t.repeat_every}).`,
        data: { recurring },
      };
    }
    const created = res.data as TaskInstanceEntity;
    const { out } = await ownTask(deps, userId, created.task_id);
    return { summary: `Created task "${out.title}".`, data: { task: out } };
  },
});

async function ownProject(deps: McpDeps, userId: string, id: string) {
  const [p] = await deps.projects.listWithCounts(userId, id);
  if (!p) throw new NotFoundException('Project not found');
  return p;
}

export const updateTask = defineTool({
  name: 'update_task',
  title: 'Update a task',
  description:
    'Changes fields of one of your tasks. Only the fields you pass change; null clears description, due_date or project_id. Use set_task_status for the status.',
  input: z
    .object({
      task_id: taskId,
      title: z
        .string()
        .min(L.titleMin)
        .max(L.titleMax)
        .optional()
        .describe(`Title (${L.titleMin}-${L.titleMax} characters).`),
      description: z
        .string()
        .max(L.descriptionMax)
        .nullable()
        .optional()
        .describe('New description; null clears it.'),
      due_date: dateInput
        .nullable()
        .optional()
        .describe('New due date (UTC); null clears it.'),
      priority: TaskPriority.optional().describe('New priority.'),
      project_id: projectId
        .nullable()
        .optional()
        .describe('Move to this project; null removes it from any project.'),
    })
    .strict(),
  output: z.object({ task: TaskOut }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  run: async (a, call) => updateTaskRun(a, call),
});

async function updateTaskRun(
  a: {
    task_id: string;
    title?: string;
    description?: string | null;
    due_date?: string | null;
    priority?: 'Low' | 'Medium' | 'High';
    project_id?: string | null;
  },
  { userId, deps }: ToolCall,
) {
  const { task_id, project_id, ...fields } = a;
  if (
    project_id === undefined &&
    Object.values(fields).every((v) => v === undefined)
  )
    throw new BadRequestException(
      'Nothing to update: pass at least one field.',
    );
  await ownTask(deps, userId, task_id);
  if (Object.values(fields).some((v) => v !== undefined)) {
    const dto = await toDto(UpdateTaskDto, fields);
    unwrap(await deps.tasks.updateOne(task_id, dto, userId));
  }
  if (project_id !== undefined)
    await deps.tasks.setProject(task_id, project_id, userId);
  const { out } = await ownTask(deps, userId, task_id);
  return { summary: `Updated task "${out.title}".`, data: { task: out } };
}

export const setTaskStatus = defineTool({
  name: 'set_task_status',
  title: 'Set a task status',
  description:
    'Sets the status of one of your tasks. Completing a task counts toward awards and notifications, exactly as on the website.',
  input: z
    .object({ task_id: taskId, status: TaskStatus.describe('The new status.') })
    .strict(),
  output: z.object({ task: TaskOut }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  run: async (a, { userId, deps }) => {
    await ownTask(deps, userId, a.task_id);
    unwrap(await deps.taskStatus.updateTaskStatus(a.task_id, a.status, userId));
    const { out } = await ownTask(deps, userId, a.task_id);
    return {
      summary: `Task "${out.title}" is now ${out.status}.`,
      data: { task: out },
    };
  },
});

export const addSubtask = defineTool({
  name: 'add_subtask',
  title: 'Add a sub-task',
  description: 'Adds a sub-task (Pending) to one of your tasks.',
  input: z
    .object({
      task_id: taskId,
      title: z
        .string()
        .min(L.titleMin)
        .max(L.titleMax)
        .describe(`Title (${L.titleMin}-${L.titleMax} characters).`),
      due_date: dateInput
        .optional()
        .describe('When the sub-task is due (UTC).'),
    })
    .strict(),
  output: z.object({ subtask: SubtaskOut }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (a, { userId, deps }) => {
    await ownTask(deps, userId, a.task_id);
    const dto = await toDto(CreateTaskSubInstanceDto, {
      task_id: a.task_id,
      title: a.title,
      status: 'Pending',
      due_date: a.due_date,
    });
    const res = unwrap(await deps.subtasks.createTaskSubInstance(dto, userId));
    const subtask = toSubtaskOut(res.data!, a.task_id);
    return {
      summary: `Added sub-task "${subtask.title}".`,
      data: { subtask },
    };
  },
});

const subtaskId = z
  .string()
  .min(1)
  .max(100)
  .describe('The sub-task id (subtask_id).');

async function ownSubtask(deps: McpDeps, userId: string, id: string) {
  const s = await deps.taskQuery.findOwnSubtask(userId, id);
  if (!s) throw new NotFoundException('Subtask not found');
  return s;
}

export const setSubtaskStatus = defineTool({
  name: 'set_subtask_status',
  title: 'Set a sub-task status',
  description: 'Sets the status of one of your sub-tasks.',
  input: z
    .object({
      subtask_id: subtaskId,
      status: TaskStatus.describe('The new status.'),
    })
    .strict(),
  output: z.object({ subtask: SubtaskOut }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  run: async (a, { userId, deps }) => {
    await ownSubtask(deps, userId, a.subtask_id);
    unwrap(
      await deps.taskStatus.updateSubTaskStatus(a.subtask_id, a.status, userId),
    );
    const subtask = toSubtaskOut(await ownSubtask(deps, userId, a.subtask_id));
    return {
      summary: `Sub-task "${subtask.title}" is now ${subtask.status}.`,
      data: { subtask },
    };
  },
});

const Deleted = z.object({ deleted: z.literal(true) });

export const deleteTask = defineTool({
  name: 'delete_task',
  title: 'Delete a task',
  description:
    'Deletes one of your tasks (a soft delete: it disappears from lists and can be restored by support).',
  input: z.object({ task_id: taskId }).strict(),
  output: Deleted.extend({ task_id: z.string() }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  run: async (a, { userId, deps }) => {
    const { out } = await ownTask(deps, userId, a.task_id);
    unwrap(await deps.tasks.softDeleteOne(a.task_id, userId));
    return {
      summary: `Deleted task "${out.title}".`,
      data: { task_id: a.task_id, deleted: true as const },
    };
  },
});

export const deleteSubtask = defineTool({
  name: 'delete_subtask',
  title: 'Delete a sub-task',
  description: 'Deletes one of your sub-tasks (a soft delete).',
  input: z.object({ subtask_id: subtaskId }).strict(),
  output: Deleted.extend({ subtask_id: z.string() }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  run: async (a, { userId, deps }) => {
    const s = await ownSubtask(deps, userId, a.subtask_id);
    unwrap(await deps.subtasks.softDeleteSubTask(a.subtask_id, userId));
    return {
      summary: `Deleted sub-task "${s.title}".`,
      data: { subtask_id: a.subtask_id, deleted: true as const },
    };
  },
});

export const TASK_TOOLS = [
  listTasks,
  getTask,
  createTask,
  updateTask,
  setTaskStatus,
  addSubtask,
  setSubtaskStatus,
  deleteTask,
  deleteSubtask,
];
export { ownProject };
