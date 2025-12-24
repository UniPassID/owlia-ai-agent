import { MigrationInterface, QueryRunner } from 'typeorm';

export class Deployments1766544012337 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
        ALTER TABLE \`user_deployments\`
            ADD COLUMN \`oldValidators\` json NULL after \`guard\`,
            CHANGE COLUMN \`setGuardSignature\` \`signature\` varbinary(128) NOT NULL,
            MODIFY COLUMN \`validators\` json NOT NULL;
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
        ALTER TABLE \`user_deployments\`
            DROP COLUMN \`oldValidators\`,
            CHANGE COLUMN \`signature\` \`setGuardSignature\` varbinary(128) NULL,
            MODIFY COLUMN \`validators\` json NULL;
        `);
  }
}
