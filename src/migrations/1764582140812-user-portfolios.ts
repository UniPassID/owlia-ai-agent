import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserPortfolios1764582140812 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS user_portfolios (
            id binary(16) NOT NULL,
            deployment_id binary(16) NOT NULL,
            data json NOT NULL,
            snap_time DATETIME NOT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE INDEX snapshot_uk (deployment_id ASC, snap_time ASC) VISIBLE
        )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS user_portfolios`);
  }
}
