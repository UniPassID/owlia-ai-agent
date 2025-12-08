import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class RebalanceJobs1764760803779 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'rebalance_jobs',
        columns: [
          {
            name: 'id',
            type: 'binary',
            length: '16',
            isPrimary: true,
          },
          {
            name: 'deploymentId',
            type: 'binary',
            length: '16',
          },
          {
            name: 'trigger',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'inputContext',
            type: 'json',
            isNullable: true,
          },
          {
            name: 'simulateReport',
            type: 'json',
            isNullable: true,
          },
          {
            name: 'execResult',
            type: 'json',
            isNullable: true,
          },
          {
            name: 'status',
            type: 'enum',
            enum: [
              'pending',
              'simulating',
              'approved',
              'executing',
              'completed',
              'failed',
              'rejected',
            ],
            default: "'pending'",
          },
          {
            name: 'errorMessage',
            type: 'varchar',
            length: '1000',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'completedAt',
            type: 'timestamp',
            isNullable: true,
          },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('rebalance_jobs');
  }
}
