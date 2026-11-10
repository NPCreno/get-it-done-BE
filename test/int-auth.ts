import { INestApplication } from '@nestjs/common';
import request from 'supertest';

export interface TestUser {
  username: string;
  email: string;
  password: string;
  user_id: string;
  access: string;
  refresh: string;
}

/** Signs up and logs in through the real HTTP endpoints. */
export async function signupAndLogin(app: INestApplication, name: string): Promise<TestUser> {
  const username = `user_${name}`;
  const email = `${name}@example.com`;
  const password = 'passw0rd1';
  const created = await request(app.getHttpServer())
    .post('/api/user/create')
    .send({ fullname: `Test ${name}`, username, email, password });
  if (created.status >= 300 || created.body.status !== 'success') {
    throw new Error(`signup failed: ${created.status} ${JSON.stringify(created.body)}`);
  }
  const login = await request(app.getHttpServer()).post('/api/user/loginUsername').send({ username, password });
  if (login.status >= 300) throw new Error(`login failed: ${login.status}`);
  return {
    username,
    email,
    password,
    user_id: created.body.data.user_id,
    access: login.body.data.access_token,
    refresh: login.body.data.refresh_token,
  };
}

export const bearer = (u: TestUser) => ({ Authorization: `Bearer ${u.access}` });
