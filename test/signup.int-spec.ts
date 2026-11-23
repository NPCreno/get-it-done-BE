/** BUG-07: a duplicate signup answers 409 with one message and never echoes the email. */
import './int-env';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './int-app';

const TAKEN = 'That email or username is already taken.';
const password = 'passw0rd1';

describe('duplicate signup (BUG-07)', () => {
  let app: INestApplication;
  const signup = (body: Record<string, string>) =>
    request(app.getHttpServer()).post('/api/user/create').send(body);

  // High test limits (createTestApp()), so the signup bucket never trips here.
  beforeAll(async () => {
    app = await createTestApp();
  }, 60000);
  afterAll(async () => {
    await app?.close();
  });

  it('the first signup is 201 with the usual success body', async () => {
    const res = await signup({
      fullname: 'Dup Test',
      username: 'dup_user',
      email: 'dup.user@example.com',
      password,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'success',
      message: 'User created successfully',
    });
    expect(res.body.data.user_id).toEqual(expect.any(String));
    expect(res.body.data).not.toHaveProperty('password');
  });

  it('the same email in other capitals is 409 with the message', async () => {
    const res = await signup({
      fullname: 'Dup Again',
      username: 'dup_user_two',
      email: 'DUP.User@Example.COM',
      password,
    });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      statusCode: 409,
      message: TAKEN,
      error: 'Conflict',
    });
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain(
      'dup.user@example.com',
    );
  });

  it('the same username is 409 with the same message', async () => {
    const res = await signup({
      fullname: 'Dup Name',
      username: 'dup_user',
      email: 'other.person@example.com',
      password,
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(TAKEN);
    const text = JSON.stringify(res.body).toLowerCase();
    expect(text).not.toContain('other.person@example.com');
    expect(text).not.toContain('dup.user@example.com');
    expect(text).not.toContain('key (');
  });

  it('no second account was created', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/user/loginUsername')
      .send({ username: 'dup_user_two', password });
    expect(login.status).toBe(401);
  });
});
