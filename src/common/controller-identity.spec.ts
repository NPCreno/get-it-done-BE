import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * REF-11 rule: a controller never reads req.user, never compares ids by hand
 * and never checks a role. Use @AuthUserId(), @CurrentUser(), SelfParam(...)
 * or AdminOnlyGuard. The one comparison lives in self-param.guard.ts.
 */
const RULES: { name: string; re: RegExp }[] = [
  {
    name: 'hand comparison of ids',
    re: /(user_id|userId|\bid)\s*!==|!==\s*(user_id|userId|\bid)\b/,
  },
  { name: 'direct identity read', re: /req(uest)?(\[['"]user['"]\]|\.user\b)/ },
  { name: 'role check', re: /\.role\s*[!=]==/ },
];

export function findViolations(
  file: string,
  text: string,
): { file: string; line: number; rule: string }[] {
  const out: { file: string; line: number; rule: string }[] = [];
  text.split('\n').forEach((line, i) => {
    for (const r of RULES) {
      if (r.re.test(line)) out.push({ file, line: i + 1, rule: r.name });
    }
  });
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

describe('controller identity rule (G5)', () => {
  it('no controller reads req.user, compares ids or checks roles', () => {
    const files = walk(join(__dirname, '..'));
    expect(files.length).toBeGreaterThan(0);
    const violations = files.flatMap((f) =>
      findViolations(f, readFileSync(f, 'utf8')),
    );
    const message = violations
      .map(
        (v) =>
          `${v.file}:${v.line} ${v.rule}: use @AuthUserId(), @CurrentUser(), SelfParam or AdminOnlyGuard`,
      )
      .join('\n');
    expect(message).toBe('');
  });

  it('the scanner detects each forbidden pattern', () => {
    const bad = [
      'if (x.user_id !== user_id) {',
      "const t = req['user'];",
      'const u = req.user.user;',
      "if (tokenUser.user.role !== 'admin') {",
    ];
    for (const line of bad) {
      expect(findViolations('f.ts', line)).toHaveLength(1);
    }
    expect(findViolations('f.ts', 'return this.s.get(userId);')).toHaveLength(
      0,
    );
  });
});
