import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('rebalance_execution_snapshots')
export class RebalanceExecutionSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  deploymentId: string;

  @Column()
  jobId: string;

  @Column()
  txHash: string;

  @Column('timestamp', { default: () => 'CURRENT_TIMESTAMP' })
  txTime: Date;

  @Column('json', { nullable: true })
  accountYieldSummary: any | null;

  @Column('json')
  parsedTransaction: any;

  @Column('timestamp', { default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
