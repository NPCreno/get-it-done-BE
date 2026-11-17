import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  ChatAccessService,
  decideAccess,
  PROJECT_NOT_FOUND,
} from './chat-access.service';

const row = (owner_id: string, is_member: boolean) => ({
  project_id: 'PRJ-1',
  owner_id,
  is_member,
});

describe('decideAccess (U-chat-1)', () => {
  it('the owner can chat and is the owner', () => {
    expect(decideAccess(row('o', false), 'o')).toEqual({
      project_id: 'PRJ-1',
      owner_id: 'o',
      isOwner: true,
    });
  });

  it('a member can chat but is not the owner', () => {
    expect(decideAccess(row('o', true), 'm').isOwner).toBe(false);
  });

  it('a stranger and a missing project are the same 404', () => {
    const stranger = () => decideAccess(row('o', false), 's');
    const missing = () => decideAccess(undefined, 's');
    expect(stranger).toThrow(new NotFoundException(PROJECT_NOT_FOUND));
    expect(missing).toThrow(new NotFoundException(PROJECT_NOT_FOUND));
  });

  it('fails closed for an empty user id and a non-boolean member flag', () => {
    expect(() => decideAccess(row('', true), '')).toThrow(NotFoundException);
    expect(() =>
      decideAccess({ ...row('o', true), is_member: 'true' as never }, 'm'),
    ).toThrow(NotFoundException);
  });
});

describe('ChatAccessService.assertCanChat (U-chat-2)', () => {
  const service = (rows: unknown[]) => {
    const query = jest.fn().mockResolvedValue(rows);
    const ds = { manager: { query } } as unknown as DataSource;
    return { svc: new ChatAccessService(ds), query };
  };

  it('asks for a non-deleted project and the caller membership only', async () => {
    const { svc, query } = service([row('o', true)]);
    await expect(svc.assertCanChat('PRJ-1', 'm')).resolves.toMatchObject({
      isOwner: false,
    });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('"deletedAt" IS NULL');
    expect(params).toEqual(['PRJ-1', 'm']);
  });

  it('404 when no row comes back (deleted, missing)', async () => {
    const { svc } = service([]);
    await expect(svc.assertCanChat('PRJ-1', 'o')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('assertOwner: owner passes, member is 403, stranger is 404', async () => {
    await expect(
      service([row('o', false)]).svc.assertOwner('PRJ-1', 'o'),
    ).resolves.toMatchObject({ isOwner: true });
    await expect(
      service([row('o', true)]).svc.assertOwner('PRJ-1', 'm'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service([row('o', false)]).svc.assertOwner('PRJ-1', 's'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
