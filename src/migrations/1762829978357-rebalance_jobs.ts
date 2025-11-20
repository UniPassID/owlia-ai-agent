import { MigrationInterface, QueryRunner } from "typeorm";

export class RebalanceJobs1762829978357 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE \`rebalance_jobs\` 
            CHANGE COLUMN \`userId\` \`deploymentId\` VARCHAR(255) NOT NULL ;
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE \`rebalance_jobs\` 
            CHANGE COLUMN \`deploymentId\` \`userId\` VARCHAR(255) NOT NULL ;
        `);
  }
}
