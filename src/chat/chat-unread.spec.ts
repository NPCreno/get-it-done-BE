import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { unreadRecipients } from './chat-events';
import { MarkReadDto } from './dto/mark-read.dto';

describe('unreadRecipients (FEAT-08a)', () => {
  it('is the owner plus every member, minus the author', () => {
    expect(unreadRecipients('O', ['M', 'N'], 'M')).toEqual(['O', 'N']);
    expect(unreadRecipients('O', ['M', 'N'], 'O')).toEqual(['M', 'N']);
    expect(unreadRecipients('O', ['M'], 'X')).toEqual(['O', 'M']);
  });
  it('lists each user once and skips empty ids', () => {
    expect(unreadRecipients('O', ['M', 'M', 'O', ''], 'N')).toEqual(['O', 'M']);
  });
  it('is empty when the author is alone in the project', () => {
    expect(unreadRecipients('O', [], 'O')).toEqual([]);
  });
});

describe('MarkReadDto (FEAT-08a)', () => {
  const check = async (plain: unknown) => {
    const obj = plainToInstance(MarkReadDto, plain, {
      enableImplicitConversion: false,
    });
    return (await validate(obj, { whitelist: true })).length === 0;
  };
  it('accepts a uuid', async () => {
    expect(
      await check({ message_id: '0b7b4d4e-3c1a-4f7e-9d2a-6b1e2f3a4b5c' }),
    ).toBe(true);
  });
  it('rejects anything else', async () => {
    for (const message_id of [
      undefined,
      null,
      '',
      'not-a-uuid',
      '0b7b4d4e3c1a4f7e9d2a6b1e2f3a4b5c',
      42,
      ['0b7b4d4e-3c1a-4f7e-9d2a-6b1e2f3a4b5c'],
    ]) {
      expect(await check({ message_id })).toBe(false);
    }
  });
});
