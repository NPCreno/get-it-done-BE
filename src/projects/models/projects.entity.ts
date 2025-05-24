import { Users } from "src/user/models/user.entity";
import { BeforeInsert, Column, CreateDateColumn, DeleteDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity()
export class Projects{
    @PrimaryGeneratedColumn()
    id: number;

    @Column({unique: true})
    project_id: string;

    @Column({nullable: true})
    title: string;

    @Column({nullable: true})
    description: string;

    @Column({nullable: true})
    color: string;
    
    @Column({ type: 'timestamp', nullable: true })
    due_date: Date;
    
    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;
  
    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;
  
    @DeleteDateColumn({ type: 'timestamp', nullable: true })
    deletedAt: Date;

    @ManyToOne(() => Users, (user) => user.projects, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'user_id' })
    user: Users;

    @Column()
    user_id: string; // Foreign key for relationship (MUST BE EXPLICIT)
}