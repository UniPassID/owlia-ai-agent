import { MigrationInterface, QueryRunner } from "typeorm";

export class UserV2Deployments1762422345191 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
        CREATE TABLE \`user_v2_deployments\` (
            \`id\` varchar(36) NOT NULL,
            \`userId\` varchar(36) NOT NULL,
            \`chainId\` int NOT NULL,
            \`address\` varbinary(32) NOT NULL,
            \`operator\` varbinary(32) NOT NULL,
            \`guard\` varbinary(32) NOT NULL,
            \`setGuardSignature\` varbinary(128) NOT NULL,
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
        DROP TABLE \`user_v2_deployments\`;
    `);
  }
}
