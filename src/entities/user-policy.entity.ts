import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('user_policies')
export class UserPolicy {
  @PrimaryColumn()
  userId: string;

  @Column('json', { nullable: true })
  chains: string[];

  @Column('json', { nullable: true })
  assetWhitelist: string[];

  @Column('int', { default: 0 })
  minAprLiftBps: number;

  @Column('decimal', { precision: 18, scale: 2, default: 0 })
  minNetUsd: number;

  @Column('decimal', { precision: 5, scale: 2, default: 1.5 })
  minHealthFactor: number;

  @Column('int', { default: 100 })
  maxSlippageBps: number;

  @Column('decimal', { precision: 18, scale: 2, default: 10 })
  maxGasUsd: number;

  @Column('decimal', { precision: 18, scale: 2, default: 10000 })
  maxPerTradeUsd: number;

  @Column('boolean', { default: false })
  autoEnabled: boolean;

  @Column('timestamp', { default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column('timestamp', { default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
