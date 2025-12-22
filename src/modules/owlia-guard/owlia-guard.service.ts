import { Inject, Injectable, Logger } from '@nestjs/common';
import { UserService } from '../user/user.service';
import {
  LendingProtocolDto,
  LPProtocolDto,
  RebalancePositionDto,
} from './dto/rebalance-position.dto';
import { NetworkDto } from '../../common/dto/network.dto';
import { OwliaGuardManager } from './utils/owlia-guard-manager';
import { KyberSwapClient } from '../../common/kyber-swap-client';
import {
  ExecuteRebalancePositionResponseDto,
  RebalancePositionParamsDto,
} from './dto/rebalance-position.response.dto';
import { AaveV3Service } from '../dexes/aave-v3/aave-v3.service';
import { AerodromeClService } from '../dexes/aerodrome-cl/aerodrome-cl.service';
import { EulerV2Service } from '../dexes/euler-v2/euler-v2.service';
import { VenusV4Service } from '../dexes/venus-v4/venus-v4.service';
import { UniswapV3Service } from '../dexes/uniswap-v3/uniswap-v3.service';
import { WalletClient } from 'viem';
import privateConfig from '../../config/private.config';
import { ConfigType } from '@nestjs/config';
import blockchainsConfig from '../../config/blockchains.config';
import { TrackerService } from '../tracker/tracker.service';
import Decimal from 'decimal.js';
import {
  CalculateRebalanceCostBatchResponse,
  CalculateRebalanceCostResult,
  CalculateSwapCostBatchRequest,
  ProcessedRebalanceArgs,
  ProtocolType,
  TargetLiquidityPosition,
} from '../agent/types/mcp.types';

@Injectable()
export class OwliaGuardService {
  private readonly logger = new Logger(OwliaGuardService.name);

  private readonly owliaGuardManagers: Record<NetworkDto, OwliaGuardManager>;
  private readonly kyberSwapClient: KyberSwapClient = new KyberSwapClient();
  #walletClient: WalletClient;

  constructor(
    private readonly userService: UserService,
    private readonly aaveV3Service: AaveV3Service,
    private readonly aerodromeCLService: AerodromeClService,
    private readonly eulerV2Service: EulerV2Service,
    private readonly venusV4Service: VenusV4Service,
    private readonly uniswapV3Service: UniswapV3Service,
    private readonly trackerService: TrackerService,
    @Inject(privateConfig.KEY)
    _privateConfig: ConfigType<typeof privateConfig>,
    @Inject(blockchainsConfig.KEY)
    blockchains: ConfigType<typeof blockchainsConfig>,
  ) {
    this.owliaGuardManagers = {
      [NetworkDto.Base]: new OwliaGuardManager(
        NetworkDto.Base,
        this.aaveV3Service,
        this.aerodromeCLService,
        this.eulerV2Service,
        this.venusV4Service,
        this.uniswapV3Service,
        this.kyberSwapClient,
        this.userService,
        _privateConfig.privateKey,
        blockchains.base.rpcUrls,
      ),
    };
  }

  async getRebalancePositionParams(
    dto: RebalancePositionDto,
  ): Promise<RebalancePositionParamsDto> {
    this.logger.log(
      `Getting rebalance position params for Safe: ${dto.safeAddress}`,
    );

    const execParams = await this.owliaGuardManagers[
      dto.network
    ].buildRebalancePositionParams(dto, false);

    return execParams;
  }

  async executeRebalancePosition(
    dto: RebalancePositionDto,
  ): Promise<ExecuteRebalancePositionResponseDto> {
    return this.owliaGuardManagers[dto.network].executeRebalancePosition(dto);
  }

  async getRebalanceCost(dto: RebalancePositionDto) {
    try {
      this.logger.log(`Get rebalance cost for dto: ${JSON.stringify(dto)}`);

      const [params, tokenInfoWithPrices] = await Promise.all([
        this.getRebalancePositionParams(dto),
        this.trackerService.tokenPrices({
          tokens: this.userService
            .getAllAllowedTokens(dto.network)
            .map((token) => ({
              network: dto.network,
              tokenAddress: token.tokenAddress,
            })),
        }),
      ]);
      this.logger.log(
        `ExecuteParams (batch) for getRebalanceCost: ${JSON.stringify(params)}`,
      );
      const fee = params.routes
        .map((action) => {
          if (action.actionType === 'Swap') {
            const inputToken = action.tokenA;
            const outputToken = action.tokenB;
            const inputTokenInfo = tokenInfoWithPrices.tokenPrices.find(
              (t) => t.tokenAddress === inputToken,
            );
            const outputTokenInfo = tokenInfoWithPrices.tokenPrices.find(
              (t) => t.tokenAddress === outputToken,
            );

            if (!inputTokenInfo || !outputTokenInfo) {
              throw new Error(
                `Token info not found for token: ${inputToken} or ${outputToken}`,
              );
            }

            if (action.estimatedOutput === undefined) {
              throw new Error(
                `Estimated output not found for action: ${JSON.stringify(action)}`,
              );
            }

            // Get ask price for input token (cost to buy/acquire input token)
            const inputTokenAskPrice = inputTokenInfo.ask;
            const inputTokenDecimals = inputTokenInfo.tokenDecimals;
            const inputTokenAmount = new Decimal(action.amount).div(
              new Decimal(10).pow(inputTokenDecimals),
            );

            // Get bid price for output token (value received when selling output token)
            const outputTokenBidPrice = outputTokenInfo.bid;
            const outputTokenDecimals = outputTokenInfo.tokenDecimals;
            const outputTokenAmount = new Decimal(action.estimatedOutput).div(
              new Decimal(10).pow(outputTokenDecimals),
            );

            // Swap cost = amountIn * ask_inputToken - amountOut * bid_outputToken
            const swapCost = inputTokenAmount
              .mul(inputTokenAskPrice)
              .sub(outputTokenAmount.mul(outputTokenBidPrice));

            const inputTokenSymbol = inputTokenInfo.tokenSymbol;
            const outputTokenSymbol = outputTokenInfo.tokenSymbol;

            this.logger.log(
              `safe: ${dto.safeAddress}, ${inputTokenSymbol} -> ${outputTokenSymbol}, ` +
                `input: ${inputTokenAmount.toFixed()} @ ask=${inputTokenAskPrice}, ` +
                `output: ${outputTokenAmount.toFixed()} @ bid=${outputTokenBidPrice}, ` +
                `swap_cost: ${swapCost.toFixed()} USDC`,
            );
            return swapCost;
          } else {
            return new Decimal(0);
          }
        })
        .reduce((acc, curr) => acc.add(curr), new Decimal(0));
      params.routes = params.routes.map((action) => {
        if ((action as any).data) {
          (action as any).data = '0x';
        }
        return action;
      });
      return {
        fee: fee.toFixed(),
        details: params,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get rebalance cost: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Calculate rebalance cost for a batch of processed args without using MCP.
   * This is used by monitor service for swap cost estimation cache.
   */
  async getRebalanceCostFromProcessedArgsBatch(
    payload: CalculateSwapCostBatchRequest,
  ): Promise<CalculateRebalanceCostBatchResponse> {
    const results: CalculateRebalanceCostBatchResponse = {};

    if (
      !payload?.processed_args_batch ||
      payload.processed_args_batch.length === 0
    ) {
      return results;
    }

    await Promise.all(
      payload.processed_args_batch.map(async (args, index) => {
        const key = index.toString();
        try {
          const dto = this.convertProcessedArgsToRebalanceDto(args);
          const cost = await this.getRebalanceCost(dto);
          results[key] = cost as unknown as CalculateRebalanceCostResult;
        } catch (error) {
          this.logger.error(
            `Failed to calculate rebalance cost for batch index ${index}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          results[key] = undefined;
        }
      }),
    );

    return results;
  }

  /**
   * Helper: convert internal ProcessedRebalanceArgs into OwliaGuard RebalancePositionDto
   */
  private convertProcessedArgsToRebalanceDto(
    args: ProcessedRebalanceArgs,
  ): RebalancePositionDto {
    const network = args.network as NetworkDto;

    const mapLendingProtocol = (protocol: ProtocolType): LendingProtocolDto => {
      switch (protocol) {
        case 'aave':
          return LendingProtocolDto.Aave;
        case 'euler':
          return LendingProtocolDto.Euler;
        case 'venus':
          return LendingProtocolDto.Venus;
        default:
          return LendingProtocolDto.Aave;
      }
    };

    const mapLpProtocol = (
      protocol: TargetLiquidityPosition['protocol'],
    ): LPProtocolDto => {
      if (protocol === 'uniswapV3') return LPProtocolDto.UniswapV3;
      if (protocol === 'aerodromeSlipstream')
        return LPProtocolDto.AerodromeSLipstream;
      // Fallback
      return LPProtocolDto.UniswapV3;
    };

    const currentLendingSupplyPositions =
      args.currentLendingSupplyPositions?.map((p) => ({
        protocol: mapLendingProtocol(p.protocol),
        token: p.token,
        vToken: p.vToken,
        amount: p.amount,
      })) ?? [];

    const targetLendingSupplyPositions =
      args.targetLendingSupplyPositions?.map((p) => ({
        protocol: mapLendingProtocol(p.protocol),
        token: p.token,
        vToken: p.vToken,
        amount: p.amount,
      })) ?? [];

    const currentLiquidityPositions =
      args.currentLiquidityPositions?.map((p) => ({
        protocol: mapLpProtocol(p.protocol),
        tokenId: p.tokenId,
        poolAddress: p.poolAddress,
      })) ?? [];

    const targetLiquidityPositions =
      args.targetLiquidityPositions?.map((p) => ({
        protocol: mapLpProtocol(p.protocol),
        targetTickLower: p.targetTickLower,
        targetTickUpper: p.targetTickUpper,
        targetAmount0: p.targetAmount0,
        targetAmount1: p.targetAmount1,
        poolAddress: p.poolAddress,
      })) ?? [];

    return {
      network,
      safeAddress: args.safeAddress,
      operator: args.operator,
      wallet: args.wallet,
      currentBalances: args.currentBalances,
      currentLendingSupplyPositions,
      currentLiquidityPositions,
      targetLiquidityPositions,
      targetLendingSupplyPositions,
    };
  }
}
