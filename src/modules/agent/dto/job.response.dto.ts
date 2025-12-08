import { ApiProperty } from '@nestjs/swagger';
import { JobStatus } from '../entities/rebalance-job.entity';
import { PaginationResponseDto } from './transaction.response.dto';

export class JobInfoResponseDto {
  @ApiProperty({
    description: 'The job ID',
    example: '123',
  })
  id: string;
  @ApiProperty({
    description: 'The deployment ID',
    example: '123',
  })
  deploymentId: string;
  @ApiProperty({
    description: 'The trigger of the job',
    example: '123',
  })
  trigger: string;
  @ApiProperty({
    description: 'The input context of the job',
  })
  inputContext: any;
  @ApiProperty({
    description: 'The simulate report of the job',
    example: '123',
  })
  simulateReport: any;
  @ApiProperty({
    description: 'The exec result of the job',
    example: '123',
  })
  execResult: any;
  @ApiProperty({
    description: 'The status of the job',
    example: '123',
  })
  status: JobStatus;

  @ApiProperty({
    description: 'The created at of the job',
    example: '2021-01-01T00:00:00.000Z',
  })
  createdAt: Date;
  @ApiProperty({
    description: 'The updated at of the job',
    example: '2021-01-01T00:00:00.000Z',
  })
  updatedAt: Date;
  @ApiProperty({
    description: 'The completed at of the job',
    example: '2021-01-01T00:00:00.000Z',
  })
  completedAt: Date;
}

export class ExecutionStepDto {
  @ApiProperty({
    description: 'The id of the step',
    example: '123',
  })
  id: string;
  @ApiProperty({
    description: 'The content of the step',
    example: 'Rebalance Job Step',
  })
  content: string;

  @ApiProperty({
    description: 'The status of the step',
    enum: ['success', 'pending', 'error'],
  })
  status: 'success' | 'pending' | 'error';
  @ApiProperty({
    description: 'The metadata of the step',
    example: 'Rebalance Job Step Metadata',
  })
  metadata: any;
}

export class JobResponseDto {
  @ApiProperty({
    description: 'The success of the response',
    example: true,
  })
  success: boolean;
  @ApiProperty({
    description: 'The job',
    type: JobInfoResponseDto,
  })
  job: JobInfoResponseDto;
  @ApiProperty({
    description: 'The title of the job',
    example: 'Rebalance Job',
  })
  title: string;
  @ApiProperty({
    description: 'The summary of the job',
    example: 'Rebalance Job Summary',
  })
  summary: string;
  @ApiProperty({
    description: 'The steps of the job',
    example: 'Rebalance Job Steps',
  })
  steps: ExecutionStepDto[];
  @ApiProperty({
    description: 'The message type of the job',
  })
  messageType: 'timeline' | 'simple';
}

export class SingleJobInfoResponseDto {
  @ApiProperty({
    description: 'The job ID',
    example: '123',
  })
  id: string;
  @ApiProperty({
    description: 'The created at of the job',
    example: '2021-01-01T00:00:00.000Z',
  })
  createdAt: Date;
  @ApiProperty({
    description: 'The completed at of the job',
    example: '2021-01-01T00:00:00.000Z',
  })
  completedAt: Date;
  @ApiProperty({
    description: 'The title of the job',
    example: 'Rebalance Job',
  })
  title: string;
  @ApiProperty({
    description: 'The summary of the job',
    example: 'Rebalance Job Summary',
  })
  summary: string;
  @ApiProperty({
    description: 'The steps of the job',
    example: 'Rebalance Job Steps',
  })
  steps: ExecutionStepDto[];
  @ApiProperty({
    description: 'The message type of the job',
    example: 'timeline',
  })
  messageType: 'timeline' | 'simple';
}

export class JobsResponseDto {
  @ApiProperty({
    description: 'The success of the response',
    example: true,
  })
  success: boolean;
  @ApiProperty({
    description: 'The jobs',
    type: [SingleJobInfoResponseDto],
  })
  data: SingleJobInfoResponseDto[];
  @ApiProperty({
    description: 'The pagination of the response',
    type: PaginationResponseDto,
  })
  pagination: PaginationResponseDto;
}
