import { BadRequestException } from '@nestjs/common';
import * as z from 'zod/v4';
import { API_CONTRACT } from 'src/common/api-contract';
import { CreateProjectDto } from 'src/projects/dto/create-project-dto';
import { UpdateProjectDto } from 'src/projects/dto/update-project-dto';
import { ProjectOut, TaskOut, toProjectOut, toTaskOut } from '../mcp-shapes';
import { unwrap } from '../mcp-errors';
import { toDto } from '../mcp-validate';
import { dateInput, defineTool, limitInput } from '../mcp-tool';
import { ownProject } from './task-tools';

const L = API_CONTRACT.limits;
const COLOR_LABELS = API_CONTRACT.projectColors.map((c) => c.label) as [
  string,
  ...string[],
];
const colorInput = z
  .enum(COLOR_LABELS)
  .describe(`Project color, one of: ${COLOR_LABELS.join(', ')}.`);
const hexOf = (label: string) =>
  API_CONTRACT.projectColors.find((c) => c.label === label)!.hex;
const projectId = z
  .string()
  .min(1)
  .max(100)
  .describe('The project id (project_id) from list_projects.');

export const listProjects = defineTool({
  name: 'list_projects',
  title: 'List projects',
  description:
    'Lists your projects (not deleted), newest first, with task counts (total and completed).',
  input: z.object({}).strict(),
  output: z.object({ projects: z.array(ProjectOut), count: z.int() }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  run: async (_a, { userId, deps }) => {
    const projects = (await deps.projects.listWithCounts(userId)).map(
      toProjectOut,
    );
    return {
      summary: `${projects.length} project(s).`,
      data: { projects, count: projects.length },
    };
  },
});

export const getProject = defineTool({
  name: 'get_project',
  title: 'Get a project',
  description: 'Gets one of your projects and its tasks.',
  input: z.object({ project_id: projectId, limit: limitInput }).strict(),
  output: z.object({ project: ProjectOut, tasks: z.array(TaskOut) }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  run: async (a, { userId, deps }) => {
    const project = toProjectOut(await ownProject(deps, userId, a.project_id));
    const rows = await deps.taskQuery.listOwnTasks(userId, {
      project_id: a.project_id,
      limit: a.limit ?? 50,
    });
    const counts = await deps.taskQuery.subtaskCounts(
      rows.map((t) => t.task_id),
    );
    const tasks = rows.map((t) => toTaskOut(t, counts.get(t.task_id)));
    return {
      summary: `Project "${project.title ?? ''}": ${project.task_count} task(s), ${project.tasks_completed} completed.`,
      data: { project, tasks },
    };
  },
});

export const createProject = defineTool({
  name: 'create_project',
  title: 'Create a project',
  description: 'Creates a project for you.',
  input: z
    .object({
      title: z
        .string()
        .min(L.titleMin)
        .max(L.titleMax)
        .describe(`Title (${L.titleMin}-${L.titleMax} characters).`),
      description: z
        .string()
        .max(L.descriptionMax)
        .optional()
        .describe('Optional details.'),
      color: colorInput,
      due_date: dateInput.optional().describe('When the project is due (UTC).'),
    })
    .strict(),
  output: z.object({ project: ProjectOut }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (a, { userId, deps }) => {
    const dto = await toDto(CreateProjectDto, {
      title: a.title,
      description: a.description,
      color: hexOf(a.color),
      colorLabel: a.color,
      due_date: a.due_date,
    });
    const res = unwrap(await deps.projects.createProject(dto, userId));
    const project = toProjectOut(
      await ownProject(deps, userId, res.data!.project_id),
    );
    return {
      summary: `Created project "${project.title ?? ''}".`,
      data: { project },
    };
  },
});

export const updateProject = defineTool({
  name: 'update_project',
  title: 'Update a project',
  description:
    'Changes fields of one of your projects. Only the fields you pass change; null clears description or due_date.',
  input: z
    .object({
      project_id: projectId,
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
      color: colorInput
        .optional()
        .describe('New color label (see create_project).'),
      due_date: dateInput
        .nullable()
        .optional()
        .describe('New due date (UTC); null clears it.'),
    })
    .strict(),
  output: z.object({ project: ProjectOut }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  run: async (a, { userId, deps }) => {
    const { project_id, color, ...rest } = a;
    if (
      color === undefined &&
      Object.values(rest).every((v) => v === undefined)
    )
      throw new BadRequestException(
        'Nothing to update: pass at least one field.',
      );
    await ownProject(deps, userId, project_id);
    const dto = await toDto(UpdateProjectDto, {
      ...rest,
      ...(color !== undefined
        ? { color: hexOf(color), colorLabel: color }
        : {}),
    });
    unwrap(await deps.projects.updateOne(project_id, dto, userId));
    const project = toProjectOut(await ownProject(deps, userId, project_id));
    return {
      summary: `Updated project "${project.title ?? ''}".`,
      data: { project },
    };
  },
});

export const deleteProject = defineTool({
  name: 'delete_project',
  title: 'Delete a project',
  description:
    'Deletes one of your projects and its tasks (a soft delete: they disappear from lists and can be restored by support).',
  input: z.object({ project_id: projectId }).strict(),
  output: z.object({ project_id: z.string(), deleted: z.literal(true) }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  run: async (a, { userId, deps }) => {
    const p = await ownProject(deps, userId, a.project_id);
    unwrap(await deps.projects.softDeleteOne(a.project_id, userId));
    return {
      summary: `Deleted project "${p.title ?? ''}" and its tasks.`,
      data: { project_id: a.project_id, deleted: true as const },
    };
  },
});

export const PROJECT_TOOLS = [
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
];
