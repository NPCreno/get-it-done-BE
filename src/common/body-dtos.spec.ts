import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { getMetadataStorage } from 'class-validator';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { AuthController } from '../auth/auth.controller';
import { UserController } from '../user/user.controller';
import { ProjectsController } from '../projects/projects.controller';
import { TaskController } from '../task/task.controller';
import { NotificationsController } from '../notifications/notifications.controller';

/**
 * Rule: every @Body() is a fully decorated class, or an explicitly documented
 * inline type (metatype Object / Array) validated by hand or by ParseArrayPipe.
 * With whitelist:true an undecorated property is silently stripped.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const sources = walk(join(__dirname, '..')).filter((f) =>
  f.includes(`${'dto'}`),
);

function declaredProperties(className: string): string[] {
  for (const file of sources) {
    const text = readFileSync(file, 'utf8');
    const m = new RegExp(
      `export class ${className}\\b[^{]*\\{([\\s\\S]*?)\\n\\}`,
    ).exec(text);
    if (!m) continue;
    const props: string[] = [];
    for (const line of m[1].split('\n')) {
      const p = /^\s{2}(\w+)[?!]?\s*:/.exec(line);
      if (p) props.push(p[1]);
    }
    return props;
  }
  throw new Error(`source of ${className} not found`);
}

const controllers = [
  AuthController,
  UserController,
  ProjectsController,
  TaskController,
  NotificationsController,
];

describe('@Body() DTOs', () => {
  const bodyClasses = new Set<new () => object>();
  for (const controller of controllers) {
    for (const method of Object.getOwnPropertyNames(controller.prototype)) {
      if (method === 'constructor') continue;
      const args =
        Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) ?? {};
      const types: unknown[] =
        Reflect.getMetadata(
          'design:paramtypes',
          controller.prototype,
          method,
        ) ?? [];
      for (const key of Object.keys(args)) {
        const [paramtype, index] = key.split(':').map(Number);
        if (paramtype !== Number(RouteParamtypes.BODY)) continue;
        const t = types[index] as new () => object;
        if (t && t !== Object && t !== Array && t !== String)
          bodyClasses.add(t);
      }
    }
  }

  it('finds the known body DTOs', () => {
    const names = [...bodyClasses].map((c) => c.name);
    for (const n of [
      'CreateUserDto',
      'UpdateUserDto',
      'LoginEmailDto',
      'CreateProjectDto',
      'UpdateProjectDto',
      'CreateTaskDto',
      'UpdateTaskDto',
      'CreateTaskSubInstanceDto',
    ]) {
      expect(names).toContain(n);
    }
  });

  for (const cls of bodyClasses) {
    it(`${cls.name}: every declared property is decorated`, () => {
      const decorated = new Set(
        getMetadataStorage()
          .getTargetValidationMetadatas(cls, '', false, false)
          .map((m) => m.propertyName),
      );
      const missing = declaredProperties(cls.name).filter(
        (p) => !decorated.has(p),
      );
      expect(missing).toEqual([]);
    });
  }
});
