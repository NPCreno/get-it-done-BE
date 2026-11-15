export function newTaskInstanceId(): string {
  const randomNumber = Math.floor(Math.random() * 1_000_000_000); // 0 to 999,999,999
  return 'task-' + randomNumber.toString().padStart(9, '0');
}

export function newTaskTemplateId(): string {
  return `TMP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

export function newTaskSubInstanceId(): string {
  return `subTask-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}
