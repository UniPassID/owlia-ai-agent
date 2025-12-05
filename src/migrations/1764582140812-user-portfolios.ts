import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserPortfolios1764582140812 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS user_portfolios (
            id binary(16) NOT NULL,
            deploymentId binary(16) NOT NULL,
            data json NOT NULL,
            snapTime DATETIME NOT NULL,
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE INDEX snapshot_uk (deploymentId ASC, snapTime ASC) VISIBLE
        )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS user_portfolios`);
  }
}
