import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from 'src/user/models/user.entity';

@Entity()
export class AuthTokenEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  token_id!: string;

  @Index()
  @Column()
  user_id!: string;

  /** REF-14c: migration TemplateAndTokenForeignKeys. The code reads user_id. */
  @ManyToOne(() => UserEntity, {
    onDelete: 'CASCADE',
    createForeignKeyConstraints: true,
  })
  @JoinColumn({
    name: 'user_id',
    referencedColumnName: 'user_id',
    foreignKeyConstraintName: 'FK_auth_token_user',
  })
  user?: UserEntity;

  /** sha256 hex of the refresh token (legacy rows: bcrypt hash, starts with `$2`). */
  @Column({ type: 'text' })
  token!: string;

  //dates
  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @Column({ type: 'timestamp' })
  expires_at!: Date;

  // security
  @Column()
  is_revoked!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  revoked_at!: Date | null;

  @Column({ type: 'varchar', nullable: true })
  replaced_by_token_id!: string | null;

  /** AES-GCM encrypted replacement refresh token, kept only for the grace window. */
  @Column({ type: 'text', nullable: true })
  replay_ciphertext!: string | null;

  @Column({ default: false })
  remember_me!: boolean;

  @Column({ type: 'varchar', nullable: true })
  ip_address!: string | null;

  @Index()
  @Column()
  family_id!: string;
}
