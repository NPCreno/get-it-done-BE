import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn } from "typeorm";

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

    @Column()
    password: string;

    @Column()
    tier: string;
}