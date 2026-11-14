import 'dotenv/config';
import { DataSource } from 'typeorm';
import { formatEnvErrors, validateDatabaseEnv } from './config/env.validation';

// Clear message instead of an obscure ECONNREFUSED when DATABASE_URL is missing or invalid.
const { errors } = validateDatabaseEnv(process.env);
if (errors.length > 0) throw new Error(formatEnvErrors(errors));

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
  // All pending migrations share one transaction: a failure rolls everything back.
  migrationsTransactionMode: 'all',
});
