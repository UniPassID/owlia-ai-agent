import { MigrationInterface, QueryRunner } from 'typeorm';

export class Deployments1763723244407 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE \`user_deployments\` (
                \`id\` binary(16) NOT NULL,
                \`userId\` binary(16) NOT NULL,
                \`chainId\` int NOT NULL,
                \`address\` varbinary(32) NOT NULL,
                \`operator\` varbinary(32) NOT NULL,
                \`guard\` varbinary(32) NOT NULL,
                \`setGuardSignature\` varbinary(128) NULL,
                \`status\` tinyint NOT NULL,
                \`createdAt\` datetime NOT NULL,
                \`updatedAt\` datetime NOT NULL,
                PRIMARY KEY (\`id\`),
                UNIQUE KEY \`user_id_chain_id_uk\` (\`userId\`, \`chainId\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
        DROP TABLE \`user_deployments\`;
    `);
  }
}
