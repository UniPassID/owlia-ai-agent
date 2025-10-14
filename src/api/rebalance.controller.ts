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
import { UpdatePolicyDto, TriggerRebalanceDto, ExecuteJobDto } from './dto/rebalance.dto';
import { AgentService } from '../agent/agent.service';

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
  @Get('positions/:userId')
  @ApiOperation({ summary: 'Get user positions', description: 'Fetch user DeFi positions across chains using AI agent' })
  @ApiParam({ name: 'userId', description: 'User ID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @ApiQuery({ name: 'chains', required: false, description: 'Comma-separated chain list', example: 'ethereum,base' })
  @ApiResponse({ status: 200, description: 'Positions retrieved successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getPositions(
    @Param('userId') userId: string,
    @Query('chains') chains?: string,
  ) {
    try {
      // First verify user exists
      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (!user) {
        throw new HttpException(
          { success: false, error: 'User not found' },
          HttpStatus.NOT_FOUND,
        );
      }

      // Then get policy (optional)
      const policy = await this.userPolicyRepo.findOne({ where: { userId } });

      // Use chain from query param or user's chainId
      const chainList = chains ? chains.split(',') : [user.chainId];

      // Use agent to fetch positions via MCP
      const result = await this.agentService.runRebalanceAgent({
        userId,
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
   * Preview rebalance (simulate without executing)
   */
  @Post('preview')
  @ApiOperation({ summary: 'Preview rebalance', description: 'Simulate rebalancing without executing to see potential outcomes' })
  @ApiBody({ type: TriggerRebalanceDto })
  @ApiResponse({ status: 200, description: 'Preview generated successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async previewRebalance(@Body() dto: TriggerRebalanceDto) {
    try {
      // First verify user exists
      const user = await this.userRepo.findOne({ where: { id: dto.userId } });
      if (!user) {
        throw new HttpException(
          { success: false, error: 'User not found' },
          HttpStatus.NOT_FOUND,
        );
      }

      // Then get policy (optional)
      const policy = await this.userPolicyRepo.findOne({ where: { userId: dto.userId } });

      const chains = policy?.chains || [user.chainId];
      this.logger.log(`Preview rebalance for user ${dto.userId}:`);
      this.logger.log(`  - User chainId from DB: ${user.chainId}`);
      this.logger.log(`  - Policy chains: ${policy?.chains ? JSON.stringify(policy.chains) : 'none (null/undefined)'}`);
      this.logger.log(`  - Final chains to use: ${JSON.stringify(chains)}`);
      this.logger.log(`  - User address: ${user.address}`);

      const result = await this.agentService.runRebalanceAgent({
        userId: dto.userId,
        userAddress: user.address,
        jobId: 'preview-' + Date.now(),
        userPolicy: {
          chains,
          assetWhitelist: policy?.assetWhitelist || [],
          minAprLiftBps: policy?.minAprLiftBps || 50,
          minNetUsd: policy ? Number(policy.minNetUsd) : 10,
          minHealthFactor: policy ? Number(policy.minHealthFactor) : 1.5,
          maxSlippageBps: policy?.maxSlippageBps || 100,
          maxGasUsd: policy ? Number(policy.maxGasUsd) : 50,
          maxPerTradeUsd: policy ? Number(policy.maxPerTradeUsd) : 10000,
        },
        trigger: dto.trigger || 'manual_preview',
      });

      return {
        success: true,
        preview: result.data,
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
      const user = await this.userRepo.findOne({ where: { id: dto.userId } });
      if (!user) {
        throw new HttpException(
          { success: false, error: 'User not found' },
          HttpStatus.NOT_FOUND,
        );
      }

      // Then get policy (optional)
      const policy = await this.userPolicyRepo.findOne({ where: { userId: dto.userId } });

      this.logger.log(`Trigger rebalance for user ${dto.userId}:`);
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

    return { success: true, job };
  }

  /**
   * Get user's job history
   */
  @Get('jobs/user/:userId')
  @ApiOperation({ summary: 'Get user job history', description: 'Retrieve the list of rebalancing jobs for a user' })
  @ApiParam({ name: 'userId', description: 'User ID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @ApiQuery({ name: 'limit', required: false, description: 'Maximum number of jobs to return', example: '50' })
  @ApiResponse({ status: 200, description: 'Jobs retrieved successfully' })
  async getUserJobs(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
  ) {
    const jobs = await this.jobRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit ? parseInt(limit) : 50,
    });

    return { success: true, jobs };
  }

  /**
   * Execute an approved job manually
   */
  @Post('execute')
  @ApiOperation({ summary: 'Execute approved job', description: 'Manually execute an approved rebalancing job' })
  @ApiBody({ type: ExecuteJobDto })
  @ApiResponse({ status: 200, description: 'Job executed successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - job not approved or no plan found' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async executeJob(@Body() dto: ExecuteJobDto) {
    try {
      const job = await this.jobRepo.findOne({ where: { id: dto.jobId } });

      if (!job) {
        throw new HttpException(
          { success: false, error: 'Job not found' },
          HttpStatus.NOT_FOUND,
        );
      }

      if (job.status !== 'approved') {
        throw new HttpException(
          { success: false, error: 'Job must be approved before execution' },
          HttpStatus.BAD_REQUEST,
        );
      }

      const plan = job.simulateReport?.plan;
      if (!plan) {
        throw new HttpException(
          { success: false, error: 'No execution plan found' },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Get user address from input context
      const inputContext = typeof job.inputContext === 'string'
        ? JSON.parse(job.inputContext)
        : job.inputContext;
      const userAddress = inputContext?.userAddress;

      const result = await this.agentService.executeRebalance(
        job.userId,
        plan,
        job.id,
        userAddress,
      );

      job.execResult = result;
      job.status = result.success ? JobStatus.COMPLETED : JobStatus.FAILED;
      job.completedAt = new Date();
      await this.jobRepo.save(job);

      return {
        success: true,
        result,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
