import { newId } from 'src/common/ids';

export function newTaskInstanceId(): string {
  return newId('task');
}

/** Instances the recurring generator creates (`TaskGeneratorService`). */
export function newGeneratedTaskId(): string {
  return newId('generatedTask');
}

export function newTaskTemplateId(): string {
  return newId('TMP');
}

export function newTaskSubInstanceId(): string {
  return newId('subTask');
}
