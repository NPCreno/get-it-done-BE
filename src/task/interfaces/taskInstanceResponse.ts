import { TaskSubInstanceResponse } from './taskSubInstanceResponse';

/**
 * FEAT-09a additions on every task row (`getTasksByUser`, `getTasksByProj`,
 * `PATCH :task_id/assignee`). `user_id` is the creator.
 */
export interface TaskSharingFields {
  user_id: string;
  creator_username: string | null;
  assignee_id: string | null;
  assignee_username: string | null;
  /** The viewer may delete it: the project owner or the task's creator. */
  can_delete: boolean;
}

/** A row of `getTasksByProj` (raw array). */
export interface TaskProjectRow extends TaskSharingFields {
  id: string;
  task_id: string;
  title: string;
  description: string | null;
  priority: 'Low' | 'Medium' | 'High';
  status: 'Pending' | 'Complete' | 'Overdue';
  due_date: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  project_id: string;
}

/** A row of `getTasksByUser` and of the assignee route. */
export interface TaskInstanceResponse
  extends Omit<TaskProjectRow, 'project_id'> {
  project_id: string | null;
  project_title: string | null;
  project_owner_username: string | null;
  template_id: string | null;
  subInstances: TaskSubInstanceResponse[];
}
