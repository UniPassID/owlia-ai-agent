import { Column, Entity, Index } from 'typeorm';
import { ValidatorDto } from '../dto/register-user.dto';

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

  @Column('json', { name: 'oldValidators' })
  oldValidators: ValidatorDto[] | null;

  @Column('json', { name: 'validators' })
  validators: ValidatorDto[];

  @Column('varbinary', {
    name: 'signature',
    length: 128,
  })
  signature: Buffer;

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
  Updating = 3,
  Updated = 4,
}

export function isUserDeploymentDeployed(
  status: UserDeploymentStatus,
): boolean {
  switch (status) {
    case UserDeploymentStatus.Deployed:
    case UserDeploymentStatus.Updated:
    case UserDeploymentStatus.Updating: {
      return true;
    }
    case UserDeploymentStatus.PendingDeployment:
    case UserDeploymentStatus.Uninitialized: {
      return false;
    }
  }
}

export function updateUserDeploymentStatus(
  status: UserDeploymentStatus,
): UserDeploymentStatus {
  switch (status) {
    case UserDeploymentStatus.Uninitialized:
      return UserDeploymentStatus.PendingDeployment;
    case UserDeploymentStatus.Deployed:
    case UserDeploymentStatus.Updated:
      return UserDeploymentStatus.Updating;
    case UserDeploymentStatus.Updating:
    case UserDeploymentStatus.PendingDeployment:
      return status;
  }
}
