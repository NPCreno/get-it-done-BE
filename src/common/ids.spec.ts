import { newId } from './ids';
import {
  newGeneratedTaskId,
  newTaskInstanceId,
  newTaskSubInstanceId,
  newTaskTemplateId,
} from 'src/task/task-ids';

const UUID =
  '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

describe('newId (REF-14b)', () => {
  it('is the prefix, a dash and a uuid v4', () => {
    expect(newId('PRJ')).toMatch(new RegExp(`^PRJ-${UUID}$`));
    expect(newId('task')).toMatch(/^task-[0-9a-f-]{36}$/);
  });

  it('gives 10,000 distinct ids', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) ids.add(newId('task'));
    expect(ids.size).toBe(10_000);
  });

  it('keeps each generator prefix', () => {
    expect(newTaskInstanceId()).toMatch(new RegExp(`^task-${UUID}$`));
    expect(newTaskTemplateId()).toMatch(new RegExp(`^TMP-${UUID}$`));
    expect(newTaskSubInstanceId()).toMatch(new RegExp(`^subTask-${UUID}$`));
    expect(newGeneratedTaskId()).toMatch(new RegExp(`^generatedTask-${UUID}$`));
  });
});
