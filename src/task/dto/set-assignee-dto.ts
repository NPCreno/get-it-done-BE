import { IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

/**
 * FEAT-09a `PATCH /api/tasks/:task_id/assignee`. Required: a user id (the
 * project owner or a member) or null to unassign.
 */
export class SetAssigneeDto {
  @ValidateIf((o: SetAssigneeDto) => o.assignee_id !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  assignee_id!: string | null;
}
