import 'reflect-metadata';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { ExecutionContext } from '@nestjs/common';
import { CurrentUser } from './current-user.decorator';

describe('CurrentUser (G4)', () => {
  it("returns the token's user claim", () => {
    class C {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      m(@CurrentUser() _u: unknown) {}
    }
    const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, C, 'm') as Record<
      string,
      { factory: (d: unknown, c: ExecutionContext) => unknown }
    >;
    const { factory } = Object.values(meta)[0];
    const claim = { user_id: 'u1', role: 'admin' };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { sub: 'u1', user: claim } }),
      }),
    } as unknown as ExecutionContext;
    expect(factory(undefined, ctx)).toBe(claim);
  });
});
