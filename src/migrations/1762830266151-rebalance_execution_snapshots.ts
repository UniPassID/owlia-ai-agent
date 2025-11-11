import { MigrationInterface, QueryRunner } from "typeorm";

export class RebalanceExecutionSnapshots1762830266151
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
           ALTER TABLE \`rebalance_execution_snapshots\` 
            CHANGE COLUMN \`userId\` \`deploymentId\` VARCHAR(255) NOT NULL ;
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE \`rebalance_execution_snapshots\` 
            CHANGE COLUMN \`deploymentId\` \`userId\` VARCHAR(255) NOT NULL ;
        `);
  }
}
