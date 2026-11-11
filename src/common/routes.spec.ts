import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { TaskController } from '../task/task.controller';
import { API_CONTRACT } from './api-contract';

/**
 * Ties the paths the FE calls (API_CONTRACT.routes) to the real controller
 * routes, and pins the canonical lowercase form.
 */
function pathOf(target: object, what: string): string {
  const p: unknown = Reflect.getMetadata(PATH_METADATA, target);
  if (typeof p !== 'string') {
    throw new Error(
      `${what}: PATH_METADATA must be a string, got ${JSON.stringify(p)}`,
    );
  }
  return p;
}

function routeOf(method: keyof TaskController) {
  const handler = Object.getOwnPropertyDescriptor(
    TaskController.prototype,
    method,
  )?.value as object;
  const controllerPath = pathOf(TaskController, 'TaskController');
  const methodPath = pathOf(handler, `TaskController.${String(method)}`);
  return {
    path: `/${controllerPath.replace(/^api\//, '')}/${methodPath}`,
    verb: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod,
  };
}

describe('API_CONTRACT.routes', () => {
  const cases: [keyof typeof API_CONTRACT.routes, keyof TaskController][] = [
    ['taskStatus', 'updateTaskStatus'],
    ['subTaskStatus', 'updateSubTaskStatus'],
  ];

  it('lists exactly the status routes', () => {
    expect(Object.keys(API_CONTRACT.routes).sort()).toEqual(
      cases.map(([k]) => k).sort(),
    );
  });

  for (const [key, method] of cases) {
    it(`${key} matches TaskController.${method} (PATCH)`, () => {
      const { path, verb } = routeOf(method);
      expect(path).toBe(API_CONTRACT.routes[key]);
      expect(verb).toBe(RequestMethod.PATCH);
    });

    it(`${key} is canonical lowercase apart from :params`, () => {
      const route = API_CONTRACT.routes[key];
      expect(route.replace(/:\w+/g, '')).toBe(
        route.replace(/:\w+/g, '').toLowerCase(),
      );
    });
  }
});
