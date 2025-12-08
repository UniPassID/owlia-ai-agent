import { Entity, Column } from 'typeorm';

@Entity('rebalance_execution_snapshots')
export class RebalanceExecutionSnapshot {
  @Column('binary', { primary: true, name: 'id', length: 16 })
  id: Buffer;

  @Column('binary', { name: 'deploymentId', length: 16 })
  deploymentId: Buffer;

  @Column('binary', { name: 'jobId', length: 16 })
  jobId: Buffer;

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
