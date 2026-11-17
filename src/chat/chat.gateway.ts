import { Logger, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'http';
import { WebSocket, RawData } from 'ws';
import { API_CONTRACT } from 'src/common/api-contract';
import { verifyAccessToken } from 'src/auth/verify-access-token';
import { ChatAccessService } from './chat-access.service';
import { ChatRoomsService, frame, RoomClient } from './chat-rooms.service';
import { isAllowedOrigin } from './ws-origin';

const C = API_CONTRACT.chat;
export const CHAT_WS_PATH = `/api${C.wsPath}`;
const UNAUTHORIZED = C.closeCodes.unauthorized;
const HEARTBEAT_MS = 25_000;
const MAX_FRAME_BYTES = 8 * 1024;
const MAX_TIMER_MS = 2 ** 31 - 1;

type ErrorCode = (typeof C.errorCodes)[number];

class SocketClient implements RoomClient {
  userId = '';
  authed = false;
  alive = true;
  queue: Promise<void> = Promise.resolve();
  authTimer?: NodeJS.Timeout;
  expiryTimer?: NodeJS.Timeout;

  constructor(readonly ws: WebSocket) {}

  send(text: string): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(text);
  }

  close(code: number, reason: string): void {
    if (
      this.ws.readyState === WebSocket.OPEN ||
      this.ws.readyState === WebSocket.CONNECTING
    ) {
      this.ws.close(code, reason);
    }
  }
}

/**
 * Receive-only chat socket at /api/chat/ws (sending goes through REST).
 * 1. The Origin must be FRONTEND_URL, or the upgrade is refused with 403.
 * 2. The first frame must be {"type":"auth","token"} (never in the URL),
 *    checked like AuthorizeGuard; no valid auth within 5 s, a bad first
 *    frame, or the token expiring closes with 4401.
 * 3. {"type":"join","project_id"} after assertCanChat; {"type":"leave"}.
 * Frames sent are {"type","data"}. Rooms are in memory (one API instance).
 */
@WebSocketGateway({
  path: CHAT_WS_PATH,
  maxPayload: MAX_FRAME_BYTES,
  verifyClient: (
    info: { origin?: string; req: IncomingMessage },
    done: (ok: boolean, code?: number) => void,
  ) => done(isAllowedOrigin(info.origin), 403),
})
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger('ChatGateway');
  private readonly clients = new Map<WebSocket, SocketClient>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor(
    private readonly jwtService: JwtService,
    private readonly access: ChatAccessService,
    private readonly rooms: ChatRoomsService,
  ) {
    // Proxies drop idle sockets, and a vanished client never sends a close.
    this.heartbeat = setInterval(() => this.ping(), HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  handleConnection(ws: WebSocket): void {
    const client = new SocketClient(ws);
    this.clients.set(ws, client);
    client.authTimer = setTimeout(
      () => client.close(UNAUTHORIZED, 'auth timeout'),
      C.authTimeoutMs,
    );
    ws.on('pong', () => (client.alive = true));
    ws.on('message', (data: RawData, isBinary: boolean) => {
      // One frame at a time per socket, so a join never overtakes its auth.
      client.queue = client.queue
        .then(() => this.onFrame(client, data, isBinary))
        .catch((err: unknown) => {
          this.logger.error(
            `frame failed: ${err instanceof Error ? err.message : 'unknown'}`,
          );
          this.sendError(client, 'BAD_FRAME');
        });
    });
  }

  handleDisconnect(ws: WebSocket): void {
    const client = this.clients.get(ws);
    if (!client) return;
    clearTimeout(client.authTimer);
    clearTimeout(client.expiryTimer);
    this.rooms.leaveAll(client);
    this.clients.delete(ws);
  }

  onModuleDestroy(): void {
    clearInterval(this.heartbeat);
    for (const client of this.clients.values()) {
      clearTimeout(client.authTimer);
      clearTimeout(client.expiryTimer);
    }
  }

  private async onFrame(
    client: SocketClient,
    data: RawData,
    isBinary: boolean,
  ): Promise<void> {
    if (client.ws.readyState !== WebSocket.OPEN) return;
    const msg = isBinary ? null : parseFrame(data);
    if (!client.authed) {
      if (msg?.type !== 'auth') {
        return client.close(UNAUTHORIZED, 'auth required');
      }
      return this.authenticate(client, msg.token);
    }
    if (!msg) return this.sendError(client, 'BAD_FRAME');
    const projectId = msg.project_id;
    if (msg.type === 'join' && isProjectId(projectId)) {
      return this.join(client, projectId);
    }
    if (msg.type === 'leave' && isProjectId(projectId)) {
      this.rooms.leave(projectId, client);
      return client.send(frame('left', { project_id: projectId }));
    }
    this.sendError(client, 'BAD_FRAME');
  }

  private async authenticate(
    client: SocketClient,
    token: unknown,
  ): Promise<void> {
    const payload = await verifyAccessToken(this.jwtService, token);
    if (!payload) return client.close(UNAUTHORIZED, 'invalid token');
    clearTimeout(client.authTimer);
    client.authed = true;
    client.userId = payload.sub;
    if (typeof payload.exp === 'number') {
      const ms = Math.min(payload.exp * 1000 - Date.now(), MAX_TIMER_MS);
      client.expiryTimer = setTimeout(
        () => client.close(UNAUTHORIZED, 'token expired'),
        Math.max(0, ms),
      );
    }
    client.send(frame('ready', { user_id: client.userId }));
  }

  /**
   * Checks, joins, then checks again: a removal that commits between the first
   * check and the join is caught by the second check or by the kick.
   */
  private async join(client: SocketClient, projectId: string): Promise<void> {
    if (!(await this.canChat(projectId, client.userId))) {
      return this.sendError(client, 'NOT_FOUND', projectId);
    }
    if (!this.rooms.join(projectId, client)) {
      return this.sendError(client, 'TOO_MANY_ROOMS', projectId);
    }
    if (!(await this.canChat(projectId, client.userId))) {
      this.rooms.leave(projectId, client);
      return this.sendError(client, 'NOT_FOUND', projectId);
    }
    client.send(frame('joined', { project_id: projectId }));
  }

  private async canChat(projectId: string, userId: string): Promise<boolean> {
    try {
      await this.access.assertCanChat(projectId, userId);
      return true;
    } catch (err) {
      if (err instanceof NotFoundException) return false;
      throw err;
    }
  }

  private sendError(
    client: SocketClient,
    code: ErrorCode,
    projectId?: string,
  ): void {
    client.send(
      frame(
        'error',
        projectId === undefined ? { code } : { code, project_id: projectId },
      ),
    );
  }

  private ping(): void {
    for (const client of this.clients.values()) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;
      if (!client.alive) {
        client.ws.terminate();
        continue;
      }
      client.alive = false;
      client.ws.ping();
    }
  }
}

interface Frame {
  type?: unknown;
  token?: unknown;
  project_id?: unknown;
}

function parseFrame(data: RawData): Frame | null {
  try {
    const text = Array.isArray(data)
      ? Buffer.concat(data).toString('utf8')
      : Buffer.isBuffer(data)
        ? data.toString('utf8')
        : Buffer.from(data).toString('utf8');
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      return null;
    return parsed;
  } catch {
    return null;
  }
}

function isProjectId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 100;
}
