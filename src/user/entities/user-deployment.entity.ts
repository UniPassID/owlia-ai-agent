import { Column, Entity, Index } from 'typeorm';

@Index('user_id_chain_id_uk', ['userId', 'chainId'], { unique: true })
@Entity('user_deployments')
export class UserDeployment {
  @Column('binary', { primary: true, name: 'id', length: 16 })
  id: Buffer;

  @Column('binary', { name: 'userId', length: 16 })
  userId: Buffer;

  @Column('int', { name: 'chainId' })
  chainId: number;

  @Column('varbinary', { name: 'address', length: 32 })
  address: Buffer;

  @Column('varbinary', { name: 'operator', length: 32 })
  operator: Buffer;

  @Column('varbinary', { name: 'guard', length: 32 })
  guard: Buffer;

  @Column('varbinary', {
    name: 'setGuardSignature',
    length: 128,
    nullable: true,
  })
  setGuardSignature: Buffer | null;

  @Column('tinyint', { name: 'status' })
  status: UserDeploymentStatus;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  @Column('datetime', { name: 'updatedAt' })
  updatedAt: Date;
}

export enum UserDeploymentStatus {
  Uninitialized = 0,
  PendingDeployment = 1,
  Deployed = 2,
}
