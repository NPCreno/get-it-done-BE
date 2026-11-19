import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { TaskController } from '../task/task.controller';
import { NotificationsController } from '../notifications/notifications.controller';
import { ChatController } from '../chat/chat.controller';
import { TokensController } from '../tokens/tokens.controller';
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

type Ctl =
  | typeof TaskController
  | typeof NotificationsController
  | typeof ChatController
  | typeof TokensController;

function routeOf(controller: Ctl, method: string) {
  const handler = Object.getOwnPropertyDescriptor(controller.prototype, method)
    ?.value as object;
  const controllerPath = pathOf(controller, controller.name);
  const methodPath = pathOf(handler, `${controller.name}.${method}`).replace(
    /^\/+|\/+$/g,
    '',
  );
  return {
    path: `/${controllerPath.replace(/^api\//, '')}${methodPath ? `/${methodPath}` : ''}`,
    verb: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod,
  };
}

describe('API_CONTRACT.routes', () => {
  const cases: [
    keyof typeof API_CONTRACT.routes,
    Ctl,
    string,
    RequestMethod,
  ][] = [
    ['taskStatus', TaskController, 'updateTaskStatus', RequestMethod.PATCH],
    [
      'subTaskStatus',
      TaskController,
      'updateSubTaskStatus',
      RequestMethod.PATCH,
    ],
    ['notificationsList', NotificationsController, 'list', RequestMethod.GET],
    ['notificationRead', NotificationsController, 'read', RequestMethod.PATCH],
    [
      'notificationsReadAll',
      NotificationsController,
      'readAll',
      RequestMethod.PATCH,
    ],
    ['chatMembersList', ChatController, 'listMembers', RequestMethod.GET],
    ['chatMemberAdd', ChatController, 'addMember', RequestMethod.POST],
    ['chatMemberRemove', ChatController, 'removeMember', RequestMethod.DELETE],
    ['chatSharedProjects', ChatController, 'sharedProjects', RequestMethod.GET],
    ['chatMessagesList', ChatController, 'listMessages', RequestMethod.GET],
    ['chatMessageSend', ChatController, 'sendMessage', RequestMethod.POST],
    [
      'chatMessageDelete',
      ChatController,
      'deleteMessage',
      RequestMethod.DELETE,
    ],
    ['chatUnread', ChatController, 'unreadCounts', RequestMethod.GET],
    ['chatMarkRead', ChatController, 'markRead', RequestMethod.PUT],
    ['tokensList', TokensController, 'list', RequestMethod.GET],
    ['tokenCreate', TokensController, 'create', RequestMethod.POST],
    ['tokenRevoke', TokensController, 'revoke', RequestMethod.DELETE],
  ];

  it('lists exactly the contract routes', () => {
    expect(Object.keys(API_CONTRACT.routes).sort()).toEqual(
      cases.map(([k]) => k).sort(),
    );
  });

  for (const [key, controller, method, verb] of cases) {
    it(`${key} matches ${controller.name}.${method}`, () => {
      const route = routeOf(controller, method);
      expect(route.path).toBe(API_CONTRACT.routes[key]);
      expect(route.verb).toBe(verb);
    });

    it(`${key} is canonical lowercase apart from :params`, () => {
      const route = API_CONTRACT.routes[key];
      const plain = route.replace(/:\w+/g, '');
      // notif_id style params are removed above; the rest must be lowercase.
      expect(plain).toBe(plain.toLowerCase());
    });
  }
});
