import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

export enum JobStatus {
  PENDING = 'pending',
  SIMULATING = 'simulating',
  APPROVED = 'approved',
  EXECUTING = 'executing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  REJECTED = 'rejected',
}

@Entity('rebalance_jobs')
export class RebalanceJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  trigger: string;

  @Column('json', { nullable: true })
  inputContext: any;

  @Column('json', { nullable: true })
  simulateReport: any;

  @Column('json', { nullable: true })
  execResult: any;

  @Column({
    type: 'enum',
    enum: JobStatus,
    default: JobStatus.PENDING,
  })
  status: JobStatus;

  @Column({ nullable: true })
  errorMessage: string;

  @Column('timestamp', { default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column('timestamp', { default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt: Date;

  @Column('timestamp', { nullable: true })
  completedAt: Date;
}
