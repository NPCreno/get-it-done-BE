import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { SelfParam } from './self-param.guard';
import { AdminOnlyGuard } from './admin-only.guard';

function ctx(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const user = (sub: string, role = 'user') => ({
  sub,
  user: { user_id: sub, role },
});

const run = (guard: { canActivate(c: ExecutionContext): unknown }, r: object) =>
  guard.canActivate(ctx(r as Record<string, unknown>));

describe('SelfParam (G1)', () => {
  const guard = new (SelfParam('user_id'))();

  it('allows when the param equals the token sub', () => {
    expect(run(guard, { user: user('u1'), params: { user_id: 'u1' } })).toBe(
      true,
    );
  });

  it('rejects a different id with the fixed message', () => {
    expect(() =>
      run(guard, { user: user('u1'), params: { user_id: 'u2' } }),
    ).toThrow(new UnauthorizedException('Access denied: Not your data.'));
  });

  it('rejects an admin when allowAdmin is not set', () => {
    expect(() =>
      run(guard, { user: user('u1', 'admin'), params: { user_id: 'u2' } }),
    ).toThrow(UnauthorizedException);
  });

  it('fails closed when the param is missing', () => {
    expect(() => run(guard, { user: user('u1'), params: {} })).toThrow(
      UnauthorizedException,
    );
  });

  it('fails closed when req.user is missing (misordered guard)', () => {
    expect(() => run(guard, { params: { user_id: 'u1' } })).toThrow(
      UnauthorizedException,
    );
  });

  it('does not allow undefined === undefined', () => {
    expect(() => run(guard, { user: { user: {} }, params: {} })).toThrow(
      UnauthorizedException,
    );
  });
});

describe('SelfParam allowAdmin (G2)', () => {
  const guard = new (SelfParam('id', { allowAdmin: true }))();

  it('allows an admin acting on another id', () => {
    expect(run(guard, { user: user('a', 'admin'), params: { id: 'b' } })).toBe(
      true,
    );
  });

  it('rejects a non-admin acting on another id', () => {
    expect(() => run(guard, { user: user('a'), params: { id: 'b' } })).toThrow(
      UnauthorizedException,
    );
  });

  it('allows self', () => {
    expect(run(guard, { user: user('a'), params: { id: 'a' } })).toBe(true);
  });
});

describe('AdminOnlyGuard (G3)', () => {
  const guard = new AdminOnlyGuard();

  it('allows an admin', () => {
    expect(run(guard, { user: user('a', 'admin') })).toBe(true);
  });

  it('rejects a user with the admin-only message', () => {
    expect(() => run(guard, { user: user('a') })).toThrow(
      new UnauthorizedException('Access denied: Admin only.'),
    );
  });

  it('rejects when there is no user', () => {
    expect(() => run(guard, {})).toThrow(UnauthorizedException);
  });
});
