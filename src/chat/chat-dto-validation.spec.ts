import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SendMessageDto } from './dto/send-message.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';

/** Same transform/validate options as the global ValidationPipe. */
async function check<T extends object>(cls: new () => T, plain: unknown) {
  const obj = plainToInstance(cls, plain, { enableImplicitConversion: false });
  const errors = await validate(obj, { whitelist: true });
  return { obj, ok: errors.length === 0 };
}

describe('SendMessageDto (U-chat-4)', () => {
  it('trims the body', async () => {
    const r = await check(SendMessageDto, { body: '  hello \n' });
    expect(r.ok).toBe(true);
    expect(r.obj.body).toBe('hello');
  });

  it('accepts 1 and 2,000 characters after trimming', async () => {
    expect((await check(SendMessageDto, { body: 'x' })).ok).toBe(true);
    expect(
      (await check(SendMessageDto, { body: ` ${'x'.repeat(2000)} ` })).ok,
    ).toBe(true);
  });

  it('rejects empty, whitespace-only, too long, non-string and NUL', async () => {
    for (const body of [
      '',
      '   \n\t ',
      'x'.repeat(2001),
      5,
      null,
      undefined,
      ['hi'],
      { a: 1 },
      'a\u0000b',
    ]) {
      expect([body, (await check(SendMessageDto, { body })).ok]).toEqual([
        body,
        false,
      ]);
    }
  });

  it('keeps inner newlines', async () => {
    const r = await check(SendMessageDto, { body: 'line 1\nline 2' });
    expect(r.obj.body).toBe('line 1\nline 2');
  });
});

describe('AddMemberDto and ListMessagesQueryDto (U-chat-5)', () => {
  it('username follows the signup rules', async () => {
    expect((await check(AddMemberDto, { username: 'user_b' })).ok).toBe(true);
    for (const username of ['ab', 'a'.repeat(21), 'has space', 'a@b.co', 5]) {
      expect((await check(AddMemberDto, { username })).ok).toBe(false);
    }
  });

  it('limit is 1..50', async () => {
    expect((await check(ListMessagesQueryDto, { limit: '50' })).ok).toBe(true);
    for (const limit of ['0', '51', 'abc', '1.5']) {
      expect((await check(ListMessagesQueryDto, { limit })).ok).toBe(false);
    }
  });
});
