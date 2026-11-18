import { IsUUID } from 'class-validator';

/** FEAT-08a: the newest message the user has seen in the project. */
export class MarkReadDto {
  @IsUUID()
  message_id!: string;
}
