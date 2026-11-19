import 'reflect-metadata';
import * as z from 'zod/v4';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateTaskDto } from 'src/task/dto/create-task-dto';
import { createTaskBody } from './tools/task-tools';
import { todayUtc } from './tools/account-tools';
import { toDto } from './mcp-validate';
import {
  GENERIC_ERROR,
  ServiceFailure,
  toolErrorMessage,
  unwrap,
} from './mcp-errors';
import { originAllowed, parseAllowedOrigins } from './mcp-origin';
import { ALL_TOOLS } from './mcp-server.factory';

describe('create_task input -> CreateTaskDto (FEAT-07a)', () => {
  it('maps a plain task with defaults and passes the REST rules', async () => {
    const body = createTaskBody({ title: 'Buy milk', due_date: '2026-11-20' });
    expect(body).toMatchObject({
      title: 'Buy milk',
      priority: 'Medium',
      status: 'Pending',
      isRecurring: false,
    });
    const dto = await toDto(CreateTaskDto, body);
    expect(dto).toBeInstanceOf(CreateTaskDto);
    expect(dto.due_date).toEqual(new Date('2026-11-20'));
  });

  it('maps a weekly series', async () => {
    const dto = await toDto(
      CreateTaskDto,
      createTaskBody({
        title: 'Gym',
        is_recurring: true,
        repeat_every: 'Week',
        repeat_days: ['Monday', 'Thursday'],
        start_date: '2026-11-20',
        end_date: '2026-12-20T00:00:00Z',
        priority: 'High',
      }),
    );
    expect(dto.isRecurring).toBe(true);
    expect(dto.repeat_days).toEqual(['Monday', 'Thursday']);
    expect(dto.start_date).toEqual(new Date('2026-11-20'));
  });

  it('runs the same class-validator rules as the REST route', async () => {
    const fails = async (input: Parameters<typeof createTaskBody>[0]) => {
      const err: unknown = await toDto(
        CreateTaskDto,
        createTaskBody(input),
      ).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(BadRequestException);
      return toolErrorMessage(err).message;
    };
    expect(await fails({ title: 'x' })).toMatch(/title must be longer/);
    expect(
      await fails({
        title: 'Gym',
        is_recurring: true,
        start_date: '2026-11-20',
      }),
    ).toMatch(/repeat_every/);
    expect(
      await fails({
        title: 'Gym',
        is_recurring: true,
        repeat_every: 'Week',
        start_date: '2026-11-20',
      }),
    ).toMatch(/repeat_days/);
    expect(
      await fails({
        title: 'Gym',
        is_recurring: true,
        repeat_every: 'Day',
        start_date: '2026-11-20',
        end_date: '2026-11-01',
      }),
    ).toMatch(/end_date/);
  });

  it('rejects a key the DTO does not know (mapping bug guard)', async () => {
    await expect(
      toDto(CreateTaskDto, { ...createTaskBody({ title: 'ok ok' }), x: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('tool error mapping (FEAT-07a)', () => {
  it('keeps safe 404 labels and hides others', () => {
    expect(toolErrorMessage(new NotFoundException('Task not found'))).toEqual({
      message: 'Task not found',
      expected: true,
    });
    expect(
      toolErrorMessage(new NotFoundException('Task with ID TSK-1 not found'))
        .message,
    ).toBe('Not found');
  });
  it('401 and 403 are "Not allowed"', () => {
    expect(toolErrorMessage(new UnauthorizedException('x')).message).toBe(
      'Not allowed',
    );
    expect(toolErrorMessage(new ForbiddenException('x')).message).toBe(
      'Not allowed',
    );
  });
  it('400 passes its validation messages through', () => {
    expect(
      toolErrorMessage(new BadRequestException(['a is bad', 'b is bad']))
        .message,
    ).toBe('a is bad; b is bad');
    expect(toolErrorMessage(new BadRequestException('nope')).message).toBe(
      'nope',
    );
  });
  it('anything else is generic and unexpected (logged, never shown)', () => {
    const r = toolErrorMessage(new Error('relation "x" does not exist'));
    expect(r).toEqual({ message: GENERIC_ERROR, expected: false });
    expect(() => unwrap({ status: 'error', error: 'db' })).toThrow(
      ServiceFailure,
    );
    expect(toolErrorMessage(new ServiceFailure({})).message).toBe(
      GENERIC_ERROR,
    );
    expect(unwrap({ status: 'success', data: 1 }).data).toBe(1);
  });
});

describe('MCP Origin check (FEAT-07a)', () => {
  it('parses MCP_ALLOWED_ORIGINS', () => {
    expect(parseAllowedOrigins(undefined)).toEqual({
      origins: [],
      error: null,
    });
    expect(parseAllowedOrigins(' ')).toEqual({ origins: [], error: null });
    expect(
      parseAllowedOrigins('https://a.example.com, http://localhost:6274'),
    ).toEqual({
      origins: ['https://a.example.com', 'http://localhost:6274'],
      error: null,
    });
    expect(
      parseAllowedOrigins('https://a.example.com/path').error,
    ).not.toBeNull();
    expect(parseAllowedOrigins('a.example.com').error).not.toBeNull();
    expect(parseAllowedOrigins('ftp://a.example.com').error).not.toBeNull();
  });
  it('no Origin passes; a present one must match exactly', () => {
    const allowed = ['https://a.example.com'];
    expect(originAllowed(undefined, [])).toBe(true);
    expect(originAllowed('https://a.example.com', allowed)).toBe(true);
    expect(originAllowed('https://a.example.com', [])).toBe(false);
    expect(originAllowed('https://a.example.com:8443', allowed)).toBe(false);
    expect(originAllowed('http://a.example.com', allowed)).toBe(false);
    expect(originAllowed('null', allowed)).toBe(false);
    expect(originAllowed(['https://a.example.com'], allowed)).toBe(false);
  });
});

describe('MCP tool set (FEAT-07a)', () => {
  it('has the 21 planned tools with the right hints', () => {
    const specs = ALL_TOOLS.map((t) => t.spec);
    expect(specs).toHaveLength(21);
    const names = specs.map((s) => s.name);
    expect(new Set(names).size).toBe(21);
    const readOnly = specs
      .filter((s) => s.annotations.readOnlyHint)
      .map((s) => s.name)
      .sort();
    expect(readOnly).toEqual(
      [
        'get_profile',
        'list_tasks',
        'get_task',
        'list_projects',
        'get_project',
        'get_dashboard',
        'list_notifications',
        'list_shared_projects',
        'list_chat_messages',
        'get_chat_unread',
      ].sort(),
    );
    const destructive = specs
      .filter((s) => s.annotations.destructiveHint)
      .map((s) => s.name)
      .sort();
    expect(destructive).toEqual(
      ['delete_project', 'delete_subtask', 'delete_task'].sort(),
    );
    const undescribed = specs.flatMap((s) =>
      Object.entries(s.input.shape as Record<string, { description?: string }>)
        .filter(([, f]) => !f.description)
        .map(([k]) => `${s.name}.${k}`),
    );
    expect(undescribed).toEqual([]);
    for (const s of specs) {
      // unknown keys are refused
      expect(z.toJSONSchema(s.input).additionalProperties).toBe(false);
      expect(s.description.length).toBeGreaterThan(10);
      // never a user id as input
      expect(Object.keys(s.input.shape)).not.toContain('user_id');
    }
  });

  it('todayUtc is the whole UTC day', () => {
    expect(todayUtc(new Date('2026-11-19T23:30:00-05:00'))).toEqual({
      from: '2026-11-20T00:00:00.000Z',
      to: '2026-11-20T23:59:59.999Z',
    });
  });
});
