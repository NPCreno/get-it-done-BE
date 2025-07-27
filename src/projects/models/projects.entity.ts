import { TaskInstanceEntity } from "src/task/models/taskInstance.entity";
import { UserEntity } from "src/user/models/user.entity";
import { Column, CreateDateColumn, DeleteDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity()
export class ProjectEntity{
    @PrimaryGeneratedColumn()
    id!: number;

    @Column({unique: true})
    project_id!: string;

    @Column({nullable: true})
    title!: string;

    @Column({nullable: true})
    description!: string;

    @Column({nullable: true})
    color!: string;

    @Column({nullable: true})
    colorLabel!: string;
    
    @Column({ type: 'timestamp', nullable: true })
    due_date!: Date;
    
    @CreateDateColumn({ type: 'timestamp' })
    createdAt!: Date;
  
    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt!: Date;
  
    @DeleteDateColumn({ type: 'timestamp', nullable: true })
    deletedAt!: Date;

    @ManyToOne(() => UserEntity, (user) => user.projects, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'user_id' })
    user!: UserEntity;

    @Column()
    user_id!: string; 

    @OneToMany(() => TaskInstanceEntity, (taskInstance) => taskInstance.project)
    taskInstances!: TaskInstanceEntity[];
}