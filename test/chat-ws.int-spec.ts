/** FEAT-05a: the chat WebSocket (origin, auth frame, rooms, live events, kick, expiry). */
import './int-env';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AddressInfo } from 'net';
import request from 'supertest';
import WebSocket from 'ws';
import { createTestApp } from './int-app';
import { bearer, signupAndLogin, TestUser } from './int-auth';
import {
  addMember,
  chatTestLimits,
  createProject,
  sendMessage,
} from './chat-fixtures';

const ORIGIN = 'http://localhost:3000';
const UNAUTHORIZED = 4401;

interface Frame {
  type: string;
  data: any;
}

interface Conn {
  ws: WebSocket;
  frames: Frame[];
  closed: Promise<{ code: number; reason: string }>;
  next(type: string, timeoutMs?: number): Promise<Frame>;
  send(obj: unknown): void;
}

describe('project chat WebSocket (FEAT-05a)', () => {
  let app: INestApplication;
  let port: number;
  let O: TestUser;
  let M: TestUser;
  let S: TestUser;
  let P: string;
  const open: WebSocket[] = [];

  beforeAll(async () => {
    app = await createTestApp(await chatTestLimits());
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;
    O = await signupAndLogin(app, 'wsowner');
    M = await signupAndLogin(app, 'wsmember');
    S = await signupAndLogin(app, 'wsstranger');
    P = await createProject(app, O, 'Live');
    expect((await addMember(app, O, P, M.username)).status).toBe(201);
  }, 90000);

  afterEach(() => {
    for (const ws of open.splice(0)) ws.terminate();
  });

  afterAll(async () => {
    await app?.close();
  });

  const url = () => `ws://127.0.0.1:${port}/api/chat/ws`;

  /** `null` sends no Origin header at all. */
  function connect(origin: string | null = ORIGIN): Promise<Conn> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url(), origin ? { origin } : {});
      open.push(ws);
      const frames: Frame[] = [];
      const waiters: { type: string; resolve: (f: Frame) => void }[] = [];
      ws.on('message', (raw) => {
        // default binaryType 'nodebuffer': every message is one Buffer
        const f = JSON.parse((raw as Buffer).toString('utf8')) as Frame;
        frames.push(f);
        const i = waiters.findIndex((w) => w.type === f.type);
        if (i >= 0) waiters.splice(i, 1)[0].resolve(f);
      });
      const closed = new Promise<{ code: number; reason: string }>((r) =>
        ws.on('close', (code, reason) =>
          r({ code, reason: reason.toString() }),
        ),
      );
      ws.on('unexpected-response', (_req, res) =>
        reject(new Error(`HTTP ${res.statusCode}`)),
      );
      ws.on('error', reject);
      ws.on('open', () =>
        resolve({
          ws,
          frames,
          closed,
          send: (obj) => ws.send(JSON.stringify(obj)),
          next: (type, timeoutMs = 3000) => {
            const seen = frames.find((f) => f.type === type);
            if (seen) {
              frames.splice(frames.indexOf(seen), 1);
              return Promise.resolve(seen);
            }
            return new Promise<Frame>((res, rej) => {
              const t = setTimeout(
                () => rej(new Error(`no ${type} frame`)),
                timeoutMs,
              );
              waiters.push({
                type,
                resolve: (f) => {
                  clearTimeout(t);
                  frames.splice(frames.indexOf(f), 1);
                  res(f);
                },
              });
            });
          },
        }),
      );
    });
  }

  async function authed(u: TestUser): Promise<Conn> {
    const c = await connect();
    c.send({ type: 'auth', token: u.access });
    const ready = await c.next('ready');
    expect(ready.data).toEqual({ user_id: u.user_id });
    return c;
  }

  async function joined(u: TestUser, projectId = P): Promise<Conn> {
    const c = await authed(u);
    c.send({ type: 'join', project_id: projectId });
    expect((await c.next('joined')).data).toEqual({ project_id: projectId });
    return c;
  }

  const quiet = () => new Promise((r) => setTimeout(r, 300));

  it('W1: refuses an upgrade from another origin or with no origin (403)', async () => {
    await expect(connect('https://evil.example.com')).rejects.toThrow(
      'HTTP 403',
    );
    await expect(connect(null)).rejects.toThrow('HTTP 403');
  });

  it('W2: no auth frame within 5 seconds closes with 4401', async () => {
    const c = await connect();
    const started = Date.now();
    const { code } = await c.closed;
    expect(code).toBe(UNAUTHORIZED);
    expect(Date.now() - started).toBeGreaterThanOrEqual(4500);
  }, 10000);

  it('W3: a bad token, a refresh token or a non-auth first frame closes with 4401', async () => {
    for (const first of [
      { type: 'auth', token: 'not-a-jwt' },
      { type: 'auth', token: O.refresh },
      { type: 'auth' },
      { type: 'join', project_id: P },
      'not json',
    ]) {
      const c = await connect();
      c.ws.send(typeof first === 'string' ? first : JSON.stringify(first));
      expect([first, (await c.closed).code]).toEqual([first, UNAUTHORIZED]);
    }
  });

  it('W4: joining a project you are not in gives NOT_FOUND and no events', async () => {
    const c = await authed(S);
    c.send({ type: 'join', project_id: P });
    expect((await c.next('error')).data).toEqual({
      code: 'NOT_FOUND',
      project_id: P,
    });
    c.send({ type: 'join', project_id: 'PRJ-000000000' });
    expect((await c.next('error')).data.code).toBe('NOT_FOUND');
    await sendMessage(app, O, P, 'secret');
    await quiet();
    expect(c.frames.filter((f) => f.type.startsWith('message.'))).toEqual([]);
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('W5: a message posted over REST reaches the room in the REST shape; deletes too', async () => {
    const member = await joined(M);
    const owner = await joined(O);
    const res = await sendMessage(app, O, P, '  hello room  ');
    expect(res.status).toBe(201);
    for (const c of [member, owner]) {
      const created = await c.next('message.created');
      expect(created.data).toEqual(res.body.data);
    }
    const del = await request(app.getHttpServer())
      .delete(`/api/chat/projects/${P}/messages/${res.body.data.id}`)
      .set(bearer(O));
    expect(del.status).toBe(200);
    expect((await member.next('message.deleted')).data).toEqual(del.body.data);
  });

  it('W6: join may follow auth immediately; leave stops events; bad frames get BAD_FRAME', async () => {
    const c = await connect();
    c.send({ type: 'auth', token: M.access });
    c.send({ type: 'join', project_id: P });
    await c.next('ready');
    await c.next('joined');
    c.send({ type: 'shout' });
    expect((await c.next('error')).data).toEqual({ code: 'BAD_FRAME' });
    c.send({ type: 'leave', project_id: P });
    expect((await c.next('left')).data).toEqual({ project_id: P });
    await sendMessage(app, O, P, 'after leave');
    await quiet();
    expect(c.frames.filter((f) => f.type === 'message.created')).toEqual([]);
  });

  it('W7: removal kicks the member out of the room', async () => {
    const K = await signupAndLogin(app, 'wskicked');
    await addMember(app, O, P, K.username);
    const c = await joined(K);
    await sendMessage(app, O, P, 'before removal');
    await c.next('message.created');
    const removed = await request(app.getHttpServer())
      .delete(`/api/chat/projects/${P}/members/${K.user_id}`)
      .set(bearer(O));
    expect(removed.status).toBe(200);
    expect((await c.next('removed')).data).toEqual({ project_id: P });
    await sendMessage(app, O, P, 'after removal');
    await quiet();
    expect(c.frames.filter((f) => f.type === 'message.created')).toEqual([]);
    // and cannot join again
    c.send({ type: 'join', project_id: P });
    expect((await c.next('error')).data.code).toBe('NOT_FOUND');
  });

  it('W8: the socket closes with 4401 when the token expires', async () => {
    const jwt = app.get(JwtService);
    const short = jwt.sign(
      {
        sub: M.user_id,
        type: 'access',
        user: { user_id: M.user_id, role: 'user' },
      },
      { expiresIn: 2 },
    );
    const c = await connect();
    c.send({ type: 'auth', token: short });
    await c.next('ready');
    const { code } = await c.closed;
    expect(code).toBe(UNAUTHORIZED);
  }, 10000);
});
