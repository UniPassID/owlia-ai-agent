import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DocService } from './docs.service';
import { AskQuestionDto, QuestionResponseDto } from './dto/agent.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../user/entities/user.entity';
import { JobStatus, RebalanceJob } from './entities/rebalance-job.entity';
import { RebalanceExecutionSnapshot } from './entities/rebalance-execution-snapshot.entity';
import { UserService } from '../user/user.service';
import { ApiOk } from '../../common/dto/response.dto';
import { TransactionsResponseDto } from './dto/transaction.response.dto';
import { GetTransactionsDto } from './dto/transaction.dto';
import { UserDeploymentStatus } from '../user/entities/user-deployment.entity';
import {
  JobNotFoundException,
  DeploymentNotFoundException,
} from '../../common/exceptions/base.exception';
import {
  ExecutionStepDto,
  JobInfoResponseDto,
  JobResponseDto,
  JobsResponseDto,
  SingleJobInfoResponseDto,
} from './dto/job.response.dto';
import { parse as uuidParse, stringify as uuidStringify } from 'uuid';
import { convertPlanToSteps } from '../monitor/utils/plan-to-steps.util';
import { GetJobsDto } from './dto/job.dto';

@ApiTags('Agent')
@Controller({
  path: 'agent',
  version: '1',
})
export class AgentController {
  constructor(
    private readonly docService: DocService,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(RebalanceJob)
    private jobRepo: Repository<RebalanceJob>,
    @InjectRepository(RebalanceExecutionSnapshot)
    private snapshotRepo: Repository<RebalanceExecutionSnapshot>,
    private userService: UserService,
  ) {}

  @Post('ask')
  @ApiOperation({ summary: 'Ask a question based on Owlia documentation' })
  @ApiResponse({
    status: 200,
    description: 'Question answered successfully',
    type: QuestionResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async askQuestion(@Body() dto: AskQuestionDto): Promise<QuestionResponseDto> {
    const answer = await this.docService.answerWithDocs(
      dto.question,
      dto.systemPrompt,
    );

    return {
      question: dto.question,
      answer,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get parsed rebalance transactions for a user
   */
  @Get('txs')
  @ApiOk(TransactionsResponseDto)
  async getTransactions(
    @Query()
    {
      address,
      network,
      page: pageParam,
      pageSize: pageSizeParam,
    }: GetTransactionsDto,
  ): Promise<TransactionsResponseDto> {
    // If network is provided, use UserService to get user by address and network
    const deployment = await this.userService.getDeploymentByAddress(
      address,
      network,
    );

    if (
      !deployment ||
      deployment.status === UserDeploymentStatus.Uninitialized
    ) {
      throw new DeploymentNotFoundException(network, address);
    }

    const page = Math.max(pageParam || 1, 1);
    const requestedPageSize = pageSizeParam || 20;
    const pageSize = Math.min(Math.max(requestedPageSize, 1), 100);
    const skip = (page - 1) * pageSize;

    const [snapshots, total] = await this.snapshotRepo.findAndCount({
      where: { deploymentId: deployment.id },
      order: { txTime: 'DESC' },
      skip,
      take: pageSize,
    });

    const data = snapshots.map((snapshot) => ({
      jobId: uuidStringify(snapshot.jobId),
      txHash: snapshot.txHash,
      txTime: snapshot.txTime,
      accountYieldSummary: snapshot.accountYieldSummary,
      parsedTransaction: snapshot.parsedTransaction,
    }));

    return {
      success: true,
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * Get job status
   */
  @Get('jobs/:jobId')
  @ApiOk(JobResponseDto)
  async getJob(@Param('jobId') jobId: string): Promise<JobResponseDto> {
    const jobEntity = await this.jobRepo.findOne({
      where: { id: Buffer.from(uuidParse(jobId)) },
    });

    if (!jobEntity) {
      throw new JobNotFoundException(jobId);
    }

    const job: JobInfoResponseDto = {
      id: uuidStringify(jobEntity.id),
      deploymentId: uuidStringify(jobEntity.deploymentId),
      trigger: jobEntity.trigger,
      inputContext: jobEntity.inputContext,
      simulateReport: jobEntity.simulateReport,
      execResult: jobEntity.execResult,
      status: jobEntity.status,
      createdAt: jobEntity.createdAt,
      updatedAt: jobEntity.updatedAt,
      completedAt: jobEntity.completedAt,
    };

    // Convert plan to execution steps
    const execResult = job.execResult;

    // If execResult already contains steps (e.g., "no rebalancing needed" case), use it directly
    if (execResult?.steps && execResult?.title && execResult?.summary) {
      return {
        success: true,
        job,
        title: execResult.title,
        summary: execResult.summary,
        steps: execResult.steps,
        messageType: execResult.messageType || 'timeline',
      };
    }

    // Otherwise, generate from plan
    const plan = job.simulateReport?.plan;
    const executionResult = plan
      ? convertPlanToSteps(plan, execResult, job.status)
      : { title: '', summary: '', steps: [], messageType: 'timeline' as const };

    return {
      success: true,
      job,
      title: executionResult.title,
      summary: executionResult.summary,
      steps: executionResult.steps.map((step) => ({
        id: step.id,
        content: step.content,
        status: step.status,
        metadata: step.metadata,
      })),
      messageType: executionResult.messageType,
    };
  }

  /**
   * Get user's successful jobs by address
   */
  @Get('jobs')
  @ApiOk(JobsResponseDto)
  async getJobsByAddress(
    @Query()
    { address, network, page: pageParam, pageSize: pageSizeParam }: GetJobsDto,
  ): Promise<JobsResponseDto> {
    // Find user by address (using UserService to handle chainId conversion)
    const deployment = await this.userService.getDeploymentByAddress(
      address,
      network,
    );
    if (!deployment) {
      throw new DeploymentNotFoundException(network, address);
    }

    // Parse pagination params
    const pageNum = pageParam || 1;
    const size = pageSizeParam ? Math.min(pageSizeParam, 100) : 20;
    const skip = (pageNum - 1) * size;

    // Get total count
    const total = await this.jobRepo.count({
      where: {
        deploymentId: deployment.id,
        status: JobStatus.COMPLETED,
      },
    });

    // Get jobs
    const jobs = await this.jobRepo.find({
      where: {
        deploymentId: deployment.id,
        status: JobStatus.COMPLETED,
      },
      order: { createdAt: 'DESC' },
      skip,
      take: size,
    });

    // Return only steps data
    const jobsData: SingleJobInfoResponseDto[] = jobs.map((job) => {
      const execResult = job.execResult;

      // If execResult already contains steps (e.g., "no rebalancing needed" case), use it directly
      if (execResult?.steps && execResult?.title && execResult?.summary) {
        return {
          id: uuidStringify(job.id),
          createdAt: job.createdAt,
          completedAt: job.completedAt,
          title: execResult.title as string,
          summary: execResult.summary as string,
          steps: execResult.steps as ExecutionStepDto[],
          messageType: execResult.messageType || 'timeline',
        };
      }

      // Otherwise, generate from plan
      const plan = job.simulateReport?.plan;
      const executionResult = plan
        ? convertPlanToSteps(plan, execResult, job.status)
        : {
            title: '',
            summary: '',
            steps: [],
            messageType: 'timeline' as const,
          };

      return {
        id: uuidStringify(job.id),
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        title: executionResult.title as string,
        summary: executionResult.summary as string,
        steps: executionResult.steps as ExecutionStepDto[],
        messageType: executionResult.messageType as 'timeline' | 'simple',
      };
    });

    return {
      success: true,
      data: jobsData,
      pagination: {
        page: pageNum,
        pageSize: size,
        total,
        totalPages: Math.ceil(total / size),
      },
    };
  }
}
