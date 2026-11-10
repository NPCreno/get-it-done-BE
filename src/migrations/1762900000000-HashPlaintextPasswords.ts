import { MigrationInterface, QueryRunner } from 'typeorm';
import { rehashPlaintextPasswords } from '../auth/rehash-passwords';

/**
 * DATA-02: user updates used to store a changed password as plaintext. Hash
 * every non-bcrypt value. Runs inside the migration transaction (TypeORM
 * runs all pending migrations in one), so a failure rolls everything back.
 * Logs the count only.
 */
export class HashPlaintextPasswords1762900000000 implements MigrationInterface {
  name = 'HashPlaintextPasswords1762900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    let count: number;
    try {
      count = await rehashPlaintextPasswords(queryRunner);
    } catch {
      // The driver error can contain query parameters (password values): never forward it.
      throw new Error('HashPlaintextPasswords failed; transaction rolled back');
    }
    console.log(`[HashPlaintextPasswords] rehashed ${count} account(s)`);
  }

  public async down(): Promise<void> {
    throw new Error('Irreversible: plaintext passwords are never restored');
  }
}
