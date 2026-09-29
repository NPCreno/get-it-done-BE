import 'dotenv/config';
import { DataSource } from 'typeorm';

/**
 * CLI-only connection used to create and apply schema migrations. Runtime
 * configuration remains in AppModule, where automatic synchronization is
 * explicitly limited to local development.
 */
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
});
