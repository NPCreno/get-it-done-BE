/** BUG-07: a duplicate signup is a 409 with one message; nothing leaks or logs the email. */
import {
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { of } from 'rxjs';
import { Repository } from 'typeorm';
import { AuthService } from 'src/auth/auth.service';
import { UserEntity } from './models/user.entity';
import {
  SIGNUP_FAILED_MESSAGE,
  SIGNUP_TAKEN_MESSAGE,
  UserService,
} from './user.service';

const EMAIL = 'taken.person@example.com';
const USERNAME = 'taken_person';
const dto = {
  fullname: 'Taken Person',
  username: USERNAME,
  email: EMAIL,
  password: 'passw0rd1',
};

function serviceThatFailsWith(error: unknown) {
  const repo = {
    create: (x: Partial<UserEntity>) => x,
    save: jest.fn().mockRejectedValue(error),
  } as unknown as Repository<UserEntity>;
  const auth = {
    hashPassword: () => of('$2b$12$hash'),
  } as unknown as AuthService;
  return new UserService(repo, auth);
}

/** Every argument any logger method received, as one string. */
function logged(spies: jest.SpyInstance[]): string {
  return JSON.stringify(spies.flatMap((s) => s.mock.calls));
}

describe('UserService.createUser errors (BUG-07)', () => {
  let spies: jest.SpyInstance[];
  beforeEach(() => {
    spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) =>
      jest.spyOn(Logger.prototype, m).mockImplementation(() => undefined),
    );
    spies.push(jest.spyOn(console, 'error').mockImplementation(() => {}));
    spies.push(jest.spyOn(console, 'log').mockImplementation(() => {}));
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['email', `Key (email)=(${EMAIL}) already exists.`],
    ['username', `Key (username)=(${USERNAME}) already exists.`],
  ])(
    'a 23505 on %s is a ConflictException with the one message',
    async (_, detail) => {
      const svc = serviceThatFailsWith({
        code: '23505',
        detail,
        message: 'duplicate key value violates unique constraint',
      });
      const err: unknown = await svc.createUser(dto).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toBe(SIGNUP_TAKEN_MESSAGE);
      expect(SIGNUP_TAKEN_MESSAGE).toBe(
        'That email or username is already taken.',
      );
      const text = logged(spies);
      expect(text).toContain('signup duplicate');
      expect(text).not.toContain(EMAIL);
      expect(text).not.toContain(USERNAME);
      expect(text).not.toContain('Key (');
    },
  );

  it('any other error is a 500 with no database text', async () => {
    const svc = serviceThatFailsWith({
      code: '23502',
      detail: `Failing row contains (${EMAIL})`,
      message: 'null value in column "fullname" violates not-null constraint',
    });
    const err: unknown = await svc.createUser(dto).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InternalServerErrorException);
    const body = JSON.stringify(
      (err as InternalServerErrorException).getResponse(),
    );
    expect(body).toContain(SIGNUP_FAILED_MESSAGE);
    expect(body).not.toContain('null value');
    expect(body).not.toContain(EMAIL);
    const text = logged(spies);
    expect(text).toContain('signup failed');
    expect(text).toContain('23502');
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain('Failing row');
  });

  it('an error without a code is a 500 too', async () => {
    const svc = serviceThatFailsWith(
      new Error(`connect ECONNREFUSED ${EMAIL}`),
    );
    const err: unknown = await svc.createUser(dto).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InternalServerErrorException);
    expect((err as Error).message).toBe(SIGNUP_FAILED_MESSAGE);
    expect(logged(spies)).not.toContain(EMAIL);
  });
});
