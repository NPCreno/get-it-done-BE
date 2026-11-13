import { ProjectEntity } from 'src/projects/models/projects.entity';
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  fullname!: string;

  @Column({ unique: true })
  user_id!: string;

  @Column({ unique: true })
  username!: string;

  @Column({ unique: true })
  email!: string;

  @BeforeInsert()
  emailToLowerCase() {
    this.email = this.email.toLowerCase(); // Convert the email to lowercase before saving to the database
  }

  @Column()
  password!: string;

  // Preferences
  @Column({ nullable: true })
  enableNotifications!: string;

  @Column({ nullable: true })
  theme!: string;

  @Column({ nullable: true })
  soundFx!: string;

  //role & permissions
  @Column()
  tier!: string;

  @Column({ nullable: true })
  role!: string;

  @Column({ nullable: true })
  status!: string;

  //dates
  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamp', nullable: true })
  deletedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  premiumExpiry!: Date;

  // security
  @Column({ type: 'timestamp', nullable: true })
  lastLoginAt!: Date;

  @Column({ nullable: true })
  loginAttempts!: number;

  /**
   * Cumulative completions: +1 on a real transition to Complete, never
   * decreased. Hidden from entity reads so API responses do not change.
   */
  @Column({
    name: 'lifetime_completed_count',
    type: 'integer',
    default: 0,
    select: false,
  })
  lifetimeCompletedCount!: number;

  @OneToMany(() => ProjectEntity, (project) => project.user)
  projects!: ProjectEntity[];
}
