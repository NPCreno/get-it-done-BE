import {Column, CreateDateColumn, DeleteDateColumn, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { TaskInstance } from "./taskInstance.entity";

@Entity()
export class TaskTemplate{
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    user_id: string;

    @Column({nullable: true})
    project_id: string;

    @Column({unique: true})
    taskTemplate_id: string;

    @Column()
    title: string;

    @Column({nullable: true})
    description: string;

    @Column({
    type: 'enum',
    enum: ['Day', 'Week', 'Month'],
    })
    repeat_every: 'Day' | 'Week' | 'Month';

    @Column({ type: 'simple-array', nullable: true })
    repeat_days: string[]; // e.g., ["Monday", "Thursday"]

    @Column({ type: 'timestamp' })
    start_date: Date;

    @Column({ type: 'timestamp', nullable: true })
    end_date: Date;

    //dates
    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;

    @DeleteDateColumn({ type: 'timestamp', nullable: true })
    deletedAt: Date;

    @OneToMany(() => TaskInstance, instance => instance.template)
    instances: TaskInstance[];
}