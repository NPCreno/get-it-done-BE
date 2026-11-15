import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

describe('task service size guard (REF-12)', () => {
  it('no src/task/*.service.ts is over 420 lines', () => {
    const files = readdirSync(__dirname).filter((f) =>
      f.endsWith('.service.ts'),
    );
    expect(files.length).toBeGreaterThan(1);
    const over = files
      .map(
        (f) =>
          [
            f,
            readFileSync(join(__dirname, f), 'utf8').split('\n').length,
          ] as const,
      )
      .filter(([, n]) => n > 420)
      .map(([f, n]) => `${f}: ${n} lines`);
    expect(over).toEqual([]);
  });
});
