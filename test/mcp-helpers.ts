import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AddressInfo } from 'net';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { bearer, TestUser } from './int-auth';

/** Creates a personal access token through the REST route (the website's JWT). */
export async function createPat(
  app: INestApplication,
  user: TestUser,
  body: Record<string, unknown> = { name: 'test token' },
): Promise<{ id: string; token: string }> {
  const res = await request(app.getHttpServer())
    .post('/api/tokens')
    .set(bearer(user))
    .send(body);
  if (res.status !== 201)
    throw new Error(
      `token create failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  return { id: res.body.data.id, token: res.body.data.token };
}

/** The listening base URL (the SDK client needs real HTTP, not supertest). */
export async function listen(app: INestApplication): Promise<string> {
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

/** An SDK v2 client over Streamable HTTP; 2025-11-25 unless `mode` says otherwise. */
export async function connectMcp(
  base: string,
  token: string,
  mode: 'legacy' | 'auto' = 'legacy',
): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client(
    { name: 'gid-int-test', version: '1.0.0' },
    { versionNegotiation: { mode } },
  );
  await client.connect(transport);
  return client;
}

export interface ToolOutcome {
  isError: boolean;
  text: string;
  data: any;
}

/** Calls a tool; protocol-level rejections become isError outcomes too. */
export async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolOutcome> {
  try {
    const r = await client.callTool({ name, arguments: args });
    const content = (r.content ?? []) as { type: string; text?: string }[];
    return {
      isError: Boolean(r.isError),
      text: content.map((c) => c.text ?? '').join('\n'),
      data: r.structuredContent,
    };
  } catch (e) {
    return { isError: true, text: (e as Error).message, data: undefined };
  }
}

/** A raw JSON-RPC POST to /mcp (2025-11-25 initialize), for status-code checks. */
export function rawInitialize(base: string, headers: Record<string, string>) {
  return fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'raw', version: '1' },
      },
    }),
  });
}
