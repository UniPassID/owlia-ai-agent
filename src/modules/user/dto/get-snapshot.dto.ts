import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsInt, Max, Min } from 'class-validator';

export class GetDeploymentSnapshotsDto {
  @ApiProperty({
    description: 'The deployment ID',
    example: 'uuid',
  })
  deploymentId: string;

  @ApiProperty({
    description: 'The start ID',
    example: 'uuid',
  })
  startId: string;

  @ApiProperty({
    description: 'The limit',
    example: 10,
  })
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;

  @ApiProperty({
    description: 'The snapshot timestamps in milliseconds',
    example: ['1716153600000', '1716153600000'],
  })
  @IsArray()
  snapshotTimestampsMs: string[];
}
