import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getMetadataStorage } from 'class-validator';
import { API_CONTRACT } from './api-contract';
import { CreateTaskDto } from '../task/dto/create-task-dto';
import { UpdateTaskDto } from '../task/dto/update-task-dto';
import { CreateTaskSubInstanceDto } from '../task/dto/create-task-subInstance-dto';
import { CreateProjectDto } from '../projects/dto/create-project-dto';
import { UpdateProjectDto } from '../projects/dto/update-project-dto';
import { CreateUserDto } from '../user/dto/create-user-dto';
import { UpdateUserDto } from '../user/dto/update-user-dto';

const L = API_CONTRACT.limits;

function metas(cls: new () => object, property: string, type: string) {
  return getMetadataStorage()
    .getTargetValidationMetadatas(cls, '', false, false)
    .filter((m) => m.propertyName === property && m.name === type);
}

function constraint(
  cls: new () => object,
  property: string,
  type: string,
): unknown {
  const m = metas(cls, property, type);
  if (m.length === 0) throw new Error(`${cls.name}.${property} has no ${type}`);
  return m[0].constraints?.[0];
}

describe('API contract', () => {
  it('docs/api-contract.json equals API_CONTRACT (run pnpm contract:export)', () => {
    const file = JSON.parse(
      readFileSync(
        join(__dirname, '..', '..', 'docs', 'api-contract.json'),
        'utf8',
      ),
    );
    expect(file).toEqual(JSON.parse(JSON.stringify(API_CONTRACT)));
  });

  it('task DTOs use the contract enums', () => {
    expect(constraint(CreateTaskDto, 'priority', 'isIn')).toEqual([
      ...API_CONTRACT.taskPriorities,
    ]);
    expect(constraint(CreateTaskDto, 'status', 'isIn')).toEqual([
      ...API_CONTRACT.newTaskStatuses,
    ]);
    expect(constraint(CreateTaskDto, 'repeat_every', 'isIn')).toEqual([
      ...API_CONTRACT.repeatEvery,
    ]);
    expect(constraint(CreateTaskDto, 'repeat_days', 'isIn')).toEqual([
      ...API_CONTRACT.weekdays,
    ]);
    expect(constraint(UpdateTaskDto, 'priority', 'isIn')).toEqual([
      ...API_CONTRACT.taskPriorities,
    ]);
    expect(constraint(UpdateTaskDto, 'status', 'isIn')).toEqual([
      ...API_CONTRACT.taskStatuses,
    ]);
    expect(constraint(CreateTaskSubInstanceDto, 'status', 'isIn')).toEqual([
      ...API_CONTRACT.newTaskStatuses,
    ]);
  });

  it('task, project and sub-task titles use the contract limits', () => {
    for (const cls of [
      CreateTaskDto,
      UpdateTaskDto,
      CreateTaskSubInstanceDto,
      CreateProjectDto,
      UpdateProjectDto,
    ]) {
      expect(constraint(cls, 'title', 'maxLength')).toBe(L.titleMax);
      expect(constraint(cls, 'title', 'minLength')).toBe(L.titleMin);
    }
    expect(constraint(CreateTaskDto, 'description', 'maxLength')).toBe(
      L.descriptionMax,
    );
    expect(constraint(CreateProjectDto, 'colorLabel', 'maxLength')).toBe(
      L.colorLabelMax,
    );
  });

  it('user DTOs use the contract limits, patterns and enums', () => {
    for (const cls of [CreateUserDto, UpdateUserDto]) {
      expect(constraint(cls, 'fullname', 'minLength')).toBe(L.fullnameMin);
      expect(constraint(cls, 'fullname', 'maxLength')).toBe(L.fullnameMax);
      expect(constraint(cls, 'username', 'minLength')).toBe(L.usernameMin);
      expect(constraint(cls, 'username', 'maxLength')).toBe(L.usernameMax);
      expect(constraint(cls, 'password', 'minLength')).toBe(L.passwordMin);
      expect(constraint(cls, 'password', 'maxLength')).toBe(L.passwordMax);
      expect((constraint(cls, 'username', 'matches') as RegExp).source).toBe(
        API_CONTRACT.patterns.username,
      );
      expect((constraint(cls, 'password', 'matches') as RegExp).source).toBe(
        API_CONTRACT.patterns.password,
      );
    }
    expect(constraint(UpdateUserDto, 'theme', 'isIn')).toEqual([
      ...API_CONTRACT.themes,
    ]);
    expect(constraint(UpdateUserDto, 'soundFx', 'isIn')).toEqual([
      ...API_CONTRACT.booleanStrings,
    ]);
    expect(constraint(UpdateUserDto, 'enableNotifications', 'isIn')).toEqual([
      ...API_CONTRACT.booleanStrings,
    ]);
  });

  it('privileged fields are not part of any client DTO', () => {
    for (const [cls, forbidden] of [
      [CreateUserDto, ['tier', 'role', 'status', 'user_id']],
      [UpdateUserDto, ['tier', 'role', 'status', 'user_id', 'email']],
      [CreateProjectDto, ['user_id']],
      [UpdateProjectDto, ['user_id']],
      [CreateTaskDto, ['user_id']],
      [CreateTaskSubInstanceDto, ['user_id']],
      [UpdateTaskDto, ['task_id', 'user_id', 'deletedAt', 'createdAt']],
    ] as [new () => object, string[]][]) {
      const props = getMetadataStorage()
        .getTargetValidationMetadatas(cls, '', false, false)
        .map((m) => m.propertyName);
      for (const f of forbidden) expect(props).not.toContain(f);
    }
  });
});
