import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { LoginEmailDto } from './dto/login-dto';
import { isEmailLike, normalizeEmail, trimString } from './identifier';

describe('email normalization (BUG-01)', () => {
  it('trims and lower-cases', () => {
    expect(normalizeEmail('Case@Test.Dev')).toBe('case@test.dev');
    expect(normalizeEmail('  CASE@TEST.DEV \t')).toBe('case@test.dev');
    expect(normalizeEmail('case@test.dev')).toBe('case@test.dev');
  });
  it('an email with surrounding spaces is still email-like', () => {
    expect(isEmailLike(' a@b.co ')).toBe(true);
    expect(isEmailLike('Abc')).toBe(false);
  });
  it('trimString trims strings and leaves anything else alone', () => {
    expect(trimString({ value: ' a@b.co ' })).toBe('a@b.co');
    const obj = { $ne: 1 };
    expect(trimString({ value: obj })).toBe(obj);
    expect(trimString({ value: 5 })).toBe(5);
  });
  it('LoginEmailDto accepts a padded email and keeps the same error for a bad one', () => {
    const ok = plainToInstance(LoginEmailDto, {
      email: ' Case@Test.Dev ',
      password: 'x',
    });
    expect(validateSync(ok)).toHaveLength(0);
    expect(ok.email).toBe('Case@Test.Dev');
    for (const email of ['not-an-email', '   ', 5]) {
      const bad = plainToInstance(LoginEmailDto, { email, password: 'x' });
      const errors = validateSync(bad);
      expect(errors.map((e) => e.constraints)).toEqual([
        { isEmail: 'email must be an email' },
      ]);
    }
  });
});
