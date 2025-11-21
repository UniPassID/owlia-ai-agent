import { ApiProperty } from '@nestjs/swagger';
import { IsArray } from 'class-validator';

export class DeploymentSnapshotResponseDto {
  @ApiProperty({
    description: 'The ID of the deployment snapshot',
    example: 'uuid',
  })
  id: string;

  @ApiProperty({
    description: 'The deployment ID of the deployment snapshot',
    example: 'uuid',
  })
  deploymentId: string;

  @ApiProperty({
    description: 'The underlying net worth of the deployment snapshot',
    example: '100.10',
  })
  underlyingNetWorth: string;

  @ApiProperty({
    description: 'The underlying deposit worth of the deployment snapshot',
    example: '100.10',
  })
  underlyingDepositWorth: string;

  @ApiProperty({
    description: 'The timestamp in milliseconds of the deployment snapshot',
    example: '1716153600000',
  })
  timestampMs: string;
}

export class DeploymentSnapshotsResponseDto {
  @ApiProperty({
    description: 'The deployment snapshots',
    type: [DeploymentSnapshotResponseDto],
  })
  @IsArray()
  snapshots: DeploymentSnapshotResponseDto[];
}
