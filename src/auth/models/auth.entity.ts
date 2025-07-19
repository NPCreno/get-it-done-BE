import { 
    Column, 
    CreateDateColumn, 
    Entity, 
    Index, 
    PrimaryGeneratedColumn 
} from "typeorm";

@Entity()
export class AuthTokenEntity{
    @PrimaryGeneratedColumn()
    id!: number;

    @Column({unique: true})
    token_id!: string;

    @Column()
    user_id!: string;

    @Column({type: 'text'})
    token!: string;

    //dates
    @CreateDateColumn({ type: 'timestamp' })
    createdAt!: Date;
  
    @Column({ type: 'timestamp' })
    expires_at!: Date;

    // security
    @Column()
    is_revoked!: boolean;

    @Column({nullable: true})
    ip_address!: string;

    @Index()
    @Column()
    family_id!: string;
}