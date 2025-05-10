import { BeforeInsert, Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity()
export class Users{
    @PrimaryGeneratedColumn()
    id: number;
    
    @Column()
    firstname: string;

    @Column()
    lastname: string;

    @Column({unique: true})
    username: string;

    @Column({unique: true})
    email: string;

    @BeforeInsert()
    emailToLowerCase() {
        this.email = this.email.toLowerCase(); // Convert the email to lowercase before saving to the database
    }

    @Column()
    password: string;

    @Column()
    tier: string;
    
    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;
  
    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;
  
    @DeleteDateColumn({ type: 'timestamp', nullable: true })
    deletedAt: Date;

    @Column({ type: 'timestamp', nullable: true })
    premiumExpiry: Date;

}