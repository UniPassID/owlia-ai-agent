import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserPolicy } from '../entities/user-policy.entity';
import { RebalanceJob, JobStatus } from '../entities/rebalance-job.entity';
import { User } from '../entities/user.entity';
import { MonitorService } from '../monitor/monitor.service';
import { TriggerRebalanceDto, ExecuteJobDto } from './dto/rebalance.dto';
import { AgentService } from '../agent/agent.service';
import { convertPlanToSteps } from '../utils/plan-to-steps.util';
import { UserService } from './user.service';

@ApiTags('rebalance')
@Controller('rebalance')
export class RebalanceController {
  private readonly logger = new Logger(RebalanceController.name);

  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(UserPolicy)
    private userPolicyRepo: Repository<UserPolicy>,
    @InjectRepository(RebalanceJob)
    private jobRepo: Repository<RebalanceJob>,
    private monitorService: MonitorService,
    private agentService: AgentService,
    private userService: UserService,
  ) {}

  /**
   * Trigger a rebalance job
   */
  @Post('rebalance')
  @ApiOperation({ summary: 'Trigger rebalance', description: 'Trigger a new rebalancing job for a user' })
  @ApiBody({ type: TriggerRebalanceDto })
  @ApiResponse({ status: 200, description: 'Rebalance job triggered successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async triggerRebalance(@Body() dto: TriggerRebalanceDto) {
    try {
      // First verify user exists (using UserService to handle network conversion)
      const user = await this.userService.getUserByAddress(dto.address, dto.network);
      if (!user) {
        this.logger.error(`user not found`)
        throw new HttpException(
          { success: false, error: 'User not found' },
          HttpStatus.NOT_FOUND,
        );
      }

      // Then get policy (optional)
      const policy = await this.userPolicyRepo.findOne({ where: { userId: user.id } });

      // Run precheck to decide if we should trigger
      const precheck = await this.monitorService.evaluateUserPrecheckByAddress(user.address, user.chainId.toString());

      if (!precheck.shouldTrigger) {
        this.logger.log(
          `Skipping manual rebalance trigger for user ${user.address}: precheck indicates no action needed (diff=${precheck.differenceBps.toFixed(2)} bps)`,
        );
        return {
          success: true,
          shouldTrigger: false,
          message: 'Precheck indicates rebalancing is not beneficial at this time.',
        };
      }

      this.logger.log(`Trigger rebalance for user ${user.address}:`);
      this.logger.log(`  - User chainId from DB: ${user.chainId}`);
      this.logger.log(`  - Policy chains: ${policy?.chains ? JSON.stringify(policy.chains) : 'none (null/undefined)'}`);
      this.logger.log(`  - User address: ${user.address}`);

      const job = await this.monitorService.triggerRebalance(
        user,
        policy,
        dto.trigger || 'manual_trigger',
      );

      return {
        success: true,
        shouldTrigger: true,
        jobId: job.id,
        status: job.status,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get job status
   */
  @Get('jobs/:jobId')
  @ApiOperation({ summary: 'Get job status', description: 'Retrieve the status and details of a rebalancing job' })
  @ApiParam({ name: 'jobId', description: 'Job ID', example: '660e8400-e29b-41d4-a716-446655440001' })
  @ApiResponse({ status: 200, description: 'Job retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async getJob(@Param('jobId') jobId: string) {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });

    if (!job) {
      throw new HttpException(
        { success: false, error: 'Job not found' },
        HttpStatus.NOT_FOUND,
      );
    }

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
    const executionResult = plan ? convertPlanToSteps(plan, execResult, job.status) : { title: '', summary: '', steps: [], messageType: 'timeline' as const };

    return { success: true, job, ...executionResult };
  }

  /**
   * Get user's successful jobs by address
   */
  @Get('jobs/address/:address')
  @ApiOperation({ summary: 'Get successful jobs by address', description: 'Retrieve successful rebalancing jobs for a user address with pagination' })
  @ApiParam({ name: 'address', description: 'User wallet address', example: '0x1234567890abcdef1234567890abcdef12345678' })
  @ApiQuery({ name: 'network', required: true, description: 'Blockchain network (name or chain ID)', example: 'base' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (starts from 1)', example: '1' })
  @ApiQuery({ name: 'pageSize', required: false, description: 'Number of items per page (max 100)', example: '20' })
  @ApiResponse({ status: 200, description: 'Jobs retrieved successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getJobsByAddress(
    @Param('address') address: string,
    @Query('network') network: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    // Find user by address (using UserService to handle chainId conversion)
    const user = await this.userService.getUserByAddress(address, network);
    if (!user) {
      throw new HttpException(
        { success: false, error: 'User not found' },
        HttpStatus.NOT_FOUND,
      );
    }

    // Parse pagination params
    const pageNum = page ? parseInt(page) : 1;
    const size = pageSize ? Math.min(parseInt(pageSize), 100) : 20;
    const skip = (pageNum - 1) * size;

    // Get total count
    const total = await this.jobRepo.count({
      where: {
        userId: user.id,
        status: JobStatus.COMPLETED,
      },
    });

    // Get jobs
    const jobs = await this.jobRepo.find({
      where: {
        userId: user.id,
        status: JobStatus.COMPLETED,
      },
      order: { createdAt: 'DESC' },
      skip,
      take: size,
    });

    // Return only steps data
    const jobsData = jobs.map(job => {
      const execResult = job.execResult;

      // If execResult already contains steps (e.g., "no rebalancing needed" case), use it directly
      if (execResult?.steps && execResult?.title && execResult?.summary) {
        return {
          id: job.id,
          createdAt: job.createdAt,
          completedAt: job.completedAt,
          title: execResult.title,
          summary: execResult.summary,
          steps: execResult.steps,
          messageType: execResult.messageType || 'timeline',
        };
      }

      // Otherwise, generate from plan
      const plan = job.simulateReport?.plan;
      const executionResult = plan ? convertPlanToSteps(plan, execResult, job.status) : { title: '', summary: '', steps: [], messageType: 'timeline' as const };

      return {
        id: job.id,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        ...executionResult,
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
