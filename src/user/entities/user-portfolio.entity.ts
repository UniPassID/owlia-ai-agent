import { Column, Entity, Index } from 'typeorm';

@Index('snapshot_uk', ['deploymentId', 'snapTime'], { unique: true })
@Entity('user_portfolios')
export class UserPortfolio {
  @Column('binary', { primary: true, name: 'id', length: 16 })
  id: Buffer;

  @Column('binary', { name: 'deploymentId', length: 16 })
  deploymentId: Buffer;

  @Column('json', { name: 'data' })
  data: any;

  @Column('datetime', { name: 'snapTime' })
  snapTime: Date;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  @Column('datetime', { name: 'updatedAt' })
  updatedAt: Date;
}
