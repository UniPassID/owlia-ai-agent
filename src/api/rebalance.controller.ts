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
  ) {}

  /**
   * Get user positions (via Agent)
   */
  @Get('positions/:address')
  @ApiOperation({ summary: 'Get user positions', description: 'Fetch user DeFi positions across chains using AI agent' })
  @ApiParam({ name: 'address', description: 'User wallet address', example: '0x1234567890abcdef1234567890abcdef12345678' })
  @ApiQuery({ name: 'networks', required: false, description: 'Comma-separated network list', example: 'ethereum,base' })
  @ApiResponse({ status: 200, description: 'Positions retrieved successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getPositions(
    @Param('address') address: string,
    @Query('networks') networks?: string,
  ) {
    try {
      // First verify user exists
      const user = await this.userRepo.findOne({ where: { address } });
      if (!user) {
        throw new HttpException(
          { success: false, error: 'User not found' },
          HttpStatus.NOT_FOUND,
        );
      }

      // Then get policy (optional)
      const policy = await this.userPolicyRepo.findOne({ where: { userId: user.id } });

      // Use network from query param or user's chainId
      const chainList = networks ? networks.split(',') : [user.chainId];

      // Use agent to fetch positions via MCP
      const result = await this.agentService.runRebalanceAgent({
        userId: user.id,
        userAddress: user.address,
        jobId: 'query-positions-' + Date.now(),
        userPolicy: {
          chains: chainList,
          assetWhitelist: policy?.assetWhitelist || [],
          minAprLiftBps: policy?.minAprLiftBps || 50,
          minNetUsd: policy ? Number(policy.minNetUsd) : 10,
          minHealthFactor: policy ? Number(policy.minHealthFactor) : 1.5,
          maxSlippageBps: policy?.maxSlippageBps || 100,
          maxGasUsd: policy ? Number(policy.maxGasUsd) : 50,
          maxPerTradeUsd: policy ? Number(policy.maxPerTradeUsd) : 10000,
        },
        trigger: 'fetch_positions',
      });

      return {
        success: true,
        data: result.data,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

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
      // First verify user exists
      const user = await this.userRepo.findOne({ where: { address: dto.address } });
      if (!user) {
        throw new HttpException(
          { success: false, error: 'User not found' },
          HttpStatus.NOT_FOUND,
        );
      }

      // Then get policy (optional)
      const policy = await this.userPolicyRepo.findOne({ where: { userId: user.id } });

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
    const plan = job.simulateReport?.plan;
    const execResult = job.execResult;
    const executionResult = plan ? convertPlanToSteps(plan, execResult, job.status) : { title: '', summary: '', steps: [] };

    return { success: true, job, ...executionResult };
  }

  /**
   * Get user's successful jobs by address
   */
  @Get('jobs/address/:address')
  @ApiOperation({ summary: 'Get successful jobs by address', description: 'Retrieve successful rebalancing jobs for a user address with pagination' })
  @ApiParam({ name: 'address', description: 'User wallet address', example: '0x1234567890abcdef1234567890abcdef12345678' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (starts from 1)', example: '1' })
  @ApiQuery({ name: 'pageSize', required: false, description: 'Number of items per page (max 100)', example: '20' })
  @ApiResponse({ status: 200, description: 'Jobs retrieved successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getJobsByAddress(
    @Param('address') address: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    // Find user by address
    const user = await this.userRepo.findOne({ where: { address } });
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
      const plan = job.simulateReport?.plan;
      const execResult = job.execResult;
      const executionResult = plan ? convertPlanToSteps(plan, execResult, job.status) : { title: '', summary: '', steps: [] };

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