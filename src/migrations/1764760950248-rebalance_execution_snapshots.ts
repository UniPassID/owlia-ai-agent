import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class RebalanceExecutionSnapshots1764760950248
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'rebalance_execution_snapshots',
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
            isNullable: false,
          },
          {
            name: 'jobId',
            type: 'binary',
            length: '16',
            isNullable: false,
          },
          {
            name: 'txHash',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'txTime',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'accountYieldSummary',
            type: 'json',
            isNullable: true,
          },
          {
            name: 'parsedTransaction',
            type: 'json',
            isNullable: false,
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('rebalance_execution_snapshots');
  }
}
