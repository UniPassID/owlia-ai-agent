import { MigrationInterface, QueryRunner, Table } from "typeorm";

export class InitialSchema1760094539307 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Create users table
        await queryRunner.createTable(
            new Table({
                name: 'users',
                columns: [
                    {
                        name: 'id',
                        type: 'varchar',
                        length: '36',
                        isPrimary: true,
                        generationStrategy: 'uuid',
                        isGenerated: true,
                    },
                    {
                        name: 'address',
                        type: 'varchar',
                        length: '255',
                    },
                    {
                        name: 'safeOwner',
                        type: 'varchar',
                        length: '255',
                    },
                    {
                        name: 'activationTxHash',
                        type: 'varchar',
                        length: '255',
                    },
                    {
                        name: 'chainId',
                        type: 'int',
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
                ],
            }),
            true,
        );

        // Create user_policies table
        await queryRunner.createTable(
            new Table({
                name: 'user_policies',
                columns: [
                    {
                        name: 'userId',
                        type: 'varchar',
                        length: '255',
                        isPrimary: true,
                    },
                    {
                        name: 'chains',
                        type: 'json',
                        isNullable: true,
                    },
                    {
                        name: 'assetWhitelist',
                        type: 'json',
                        isNullable: true,
                    },
                    {
                        name: 'minAprLiftBps',
                        type: 'int',
                        default: 0,
                    },
                    {
                        name: 'minNetUsd',
                        type: 'decimal',
                        precision: 18,
                        scale: 2,
                        default: 0,
                    },
                    {
                        name: 'minHealthFactor',
                        type: 'decimal',
                        precision: 5,
                        scale: 2,
                        default: 1.5,
                    },
                    {
                        name: 'maxSlippageBps',
                        type: 'int',
                        default: 100,
                    },
                    {
                        name: 'maxGasUsd',
                        type: 'decimal',
                        precision: 18,
                        scale: 2,
                        default: 10,
                    },
                    {
                        name: 'maxPerTradeUsd',
                        type: 'decimal',
                        precision: 18,
                        scale: 2,
                        default: 10000,
                    },
                    {
                        name: 'autoEnabled',
                        type: 'boolean',
                        default: false,
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
                ],
            }),
            true,
        );

        // Create rebalance_jobs table
        await queryRunner.createTable(
            new Table({
                name: 'rebalance_jobs',
                columns: [
                    {
                        name: 'id',
                        type: 'varchar',
                        length: '36',
                        isPrimary: true,
                        generationStrategy: 'uuid',
                    },
                    {
                        name: 'userId',
                        type: 'varchar',
                        length: '255',
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
                        enum: ['pending', 'simulating', 'approved', 'executing', 'completed', 'failed', 'rejected'],
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
        await queryRunner.dropTable('user_policies');
        await queryRunner.dropTable('users');
    }

}
