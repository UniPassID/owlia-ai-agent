import { MigrationInterface, QueryRunner } from "typeorm";

export class UsersV21762330118388 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
        CREATE TABLE \`users_v2\` (
            \`id\` varchar(36) NOT NULL,
            \`wallet\` varbinary(32) NOT NULL,
            \`createdAt\` datetime NOT NULL,
            \`updatedAt\` datetime NOT NULL,
            PRIMARY KEY (\`id\`),
            UNIQUE KEY \`wallet_uk\` (\`wallet\`)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`users_v2\``);
  }
}
