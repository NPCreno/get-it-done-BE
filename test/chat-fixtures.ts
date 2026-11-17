import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, TestUser } from './int-auth';

/** High limits for every throttler except the chat ones, which keep their real defaults. */
export async function chatTestLimits() {
  const { THROTTLER_DEFS } = await import('../src/auth/rate-limit/rate-limits');
  return Object.fromEntries(
    THROTTLER_DEFS.filter((d) => !d.name.startsWith('chat-')).map((d) => [
      d.name,
      { limit: 1_000_000 },
    ]),
  );
}

export async function createProject(
  app: INestApplication,
  owner: TestUser,
  title = 'Shared project',
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/projects/create')
    .set(bearer(owner))
    .send({ title, color: '#3366ff', colorLabel: 'Blue' });
  if (res.body?.status !== 'success') {
    throw new Error(`project create failed: ${JSON.stringify(res.body)}`);
  }
  return res.body.data.project_id as string;
}

export function addMember(
  app: INestApplication,
  owner: TestUser,
  projectId: string,
  username: string,
) {
  return request(app.getHttpServer())
    .post(`/api/chat/projects/${projectId}/members`)
    .set(bearer(owner))
    .send({ username });
}

export function sendMessage(
  app: INestApplication,
  user: TestUser,
  projectId: string,
  body: unknown,
) {
  return request(app.getHttpServer())
    .post(`/api/chat/projects/${projectId}/messages`)
    .set(bearer(user))
    .send({ body });
}
