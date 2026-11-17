import { Injectable } from '@nestjs/common';
import { API_CONTRACT } from 'src/common/api-contract';

/** A connected, authenticated socket as the rooms see it. */
export interface RoomClient {
  readonly userId: string;
  send(frame: string): void;
}

export type ChatServerEvent = (typeof API_CONTRACT.chat.serverEvents)[number];

export function frame(type: ChatServerEvent, data: unknown): string {
  return JSON.stringify({ type, data });
}

/**
 * In-memory rooms, one per project. Correct only while the API runs a single
 * instance (the same assumption as notifications and rate limiting); several
 * instances would need a shared pub/sub.
 */
@Injectable()
export class ChatRoomsService {
  private readonly rooms = new Map<string, Set<RoomClient>>();
  private readonly joined = new Map<RoomClient, Set<string>>();

  /** False when the client is already in the maximum number of rooms. */
  join(projectId: string, client: RoomClient): boolean {
    const mine = this.joined.get(client) ?? new Set<string>();
    if (
      !mine.has(projectId) &&
      mine.size >= API_CONTRACT.chat.maxRoomsPerSocket
    ) {
      return false;
    }
    mine.add(projectId);
    this.joined.set(client, mine);
    const room = this.rooms.get(projectId) ?? new Set<RoomClient>();
    room.add(client);
    this.rooms.set(projectId, room);
    return true;
  }

  leave(projectId: string, client: RoomClient): void {
    const room = this.rooms.get(projectId);
    room?.delete(client);
    if (room && room.size === 0) this.rooms.delete(projectId);
    const mine = this.joined.get(client);
    mine?.delete(projectId);
    if (mine && mine.size === 0) this.joined.delete(client);
  }

  leaveAll(client: RoomClient): void {
    for (const projectId of [...(this.joined.get(client) ?? [])]) {
      this.leave(projectId, client);
    }
  }

  isIn(projectId: string, client: RoomClient): boolean {
    return this.rooms.get(projectId)?.has(client) ?? false;
  }

  broadcast(projectId: string, type: ChatServerEvent, data: unknown): void {
    const room = this.rooms.get(projectId);
    if (!room) return;
    const text = frame(type, data);
    for (const client of room) client.send(text);
  }

  /** A removed member's sockets leave the room and are told so. */
  kick(projectId: string, userId: string): void {
    const room = this.rooms.get(projectId);
    if (!room) return;
    const text = frame('removed', { project_id: projectId });
    for (const client of [...room]) {
      if (client.userId !== userId) continue;
      this.leave(projectId, client);
      client.send(text);
    }
  }

  /** Number of sockets in a room (tests and diagnostics). */
  size(projectId: string): number {
    return this.rooms.get(projectId)?.size ?? 0;
  }
}
