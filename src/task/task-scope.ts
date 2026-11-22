/**
 * FEAT-09a: the two SQL rules every "my tasks" read shares, written once.
 *
 * - Responsible: the person a task counts for, `COALESCE(assignee_id,
 *   user_id)` (`user_id` is the creator). Written exactly like the expression
 *   index `idx_task_responsible`, so the planner can use it.
 * - Accessible: who may see a task at all. No project: only its creator. In a
 *   project: the owner (even after the project is soft-deleted, as before), or
 *   a current member while the project is not deleted.
 *
 * Both are self-contained (subqueries, no joins needed), so any query on
 * `task_instance_entity` can add them. `param` is a named parameter (`:uid`)
 * the caller binds to the viewer's user id.
 */

/** `alias` is a query-builder alias (quoted here) or a raw table alias. */
const col = (alias: string, name: string) => `"${alias}"."${name}"`;

export function responsibleSql(alias: string): string {
  return `COALESCE(${col(alias, 'assignee_id')}, ${col(alias, 'user_id')})`;
}

/** The task's responsible person is the viewer. */
export function responsibleIs(alias: string, param = 'uid'): string {
  return `${responsibleSql(alias)} = :${param}`;
}

export function accessibleTo(alias: string, param = 'uid'): string {
  const projectId = col(alias, 'project_id');
  return `((${projectId} IS NULL AND ${col(alias, 'user_id')} = :${param})
    OR EXISTS (SELECT 1 FROM "project_entity" "ap"
      WHERE "ap"."project_id" = ${projectId}
        AND ("ap"."user_id" = :${param}
          OR ("ap"."deletedAt" IS NULL AND EXISTS (
            SELECT 1 FROM "project_members" "am"
             WHERE "am"."project_id" = ${projectId} AND "am"."user_id" = :${param})))))`;
}

/** "My tasks": responsible for it and still allowed to see it. */
export function myTasks(alias: string, param = 'uid'): string {
  return `${responsibleIs(alias, param)} AND ${accessibleTo(alias, param)}`;
}
