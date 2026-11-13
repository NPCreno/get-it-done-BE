import { UserEntity } from 'src/user/models/user.entity';
import {
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';

/**
 * Ledger of awards already given. Independent of `notifications`, so clearing
 * notifications never allows an award to be given again.
 */
@Entity('user_awards')
export class UserAwardEntity {
  @PrimaryColumn({ name: 'user_id', type: 'varchar' })
  user_id!: string;

  @PrimaryColumn({ name: 'award_key', type: 'varchar', length: 100 })
  award_key!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'user_id' })
  user!: UserEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  created_at!: Date;
}
