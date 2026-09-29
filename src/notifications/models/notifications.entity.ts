import { UserEntity } from "src/user/models/user.entity";
import { 
    Column, 
    CreateDateColumn, 
    DeleteDateColumn, 
    Entity, 
    Index, 
    JoinColumn, 
    ManyToOne, 
    PrimaryGeneratedColumn, 
    UpdateDateColumn 
} from "typeorm";

@Entity('notifications')
export class NotificationsEntity{
    @PrimaryGeneratedColumn()
     id!: number;

     @Index()
     @Column({ unique: true })
     notif_id!: string;
   
     @Index()
     @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
     @JoinColumn({ name: 'user_id', referencedColumnName: 'user_id' })
     user!: UserEntity;
   
     @Column({
        type: 'enum',
        enum: ['achievement', 'milestone', 'streak', 'levelUp', 'reward', 'taskDue'],
      })
      type!: 'achievement' | 'milestone' | 'streak' | 'levelUp' | 'reward' | 'taskDue';

     @Column()
     title!: string;
   
     @Column({ nullable: true })
     message!: string;

     @Index()
     @Column()
     read!: boolean;

     @Column({ type: 'enum', enum: ['acknowledge', 'complete', 'claim'], nullable: true })
     actionType?: 'acknowledge' | 'complete' | 'claim';
     
     @Column({ nullable: true })
     actionTarget?: string;

     @Column('simple-json', { nullable: true })
     metadata?: Record<string, any>;
   
     @Index()
     @CreateDateColumn({ type: 'timestamp' })
     createdAt!: Date;
   
     @UpdateDateColumn({ type: 'timestamp' })
     updatedAt!: Date;
   
     @DeleteDateColumn({ type: 'timestamp', nullable: true })
     deletedAt!: Date;
}