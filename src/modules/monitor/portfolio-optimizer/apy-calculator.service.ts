import { Inject, Injectable, Logger } from '@nestjs/common';
import { AgentService } from '../../agent/agent.service';
import {
  ChainId,
  GetLpSimulateRequest,
  GetLpSimulateResponse,
  GetSupplyOpportunitiesResponse,
} from '../../agent/types/mcp.types';
import { APYFunctions } from './types';
import protocolConfig from '../../../config/protocol.config';
import { ConfigType } from '@nestjs/config';
import { TrackerService } from '../../tracker/tracker.service';
import { getNetworkDto } from '../../../common/dto/network.dto';
import { PoolSnapshotCachesListResponseDto } from '../../tracker/dto/pool-snapshot.response.dto';
import Decimal from 'decimal.js';

@Injectable()
export class APYCalculatorService {
  lendingProtocols: string[];

  private readonly logger = new Logger(APYCalculatorService.name);

  constructor(
    private readonly agentService: AgentService,
    private readonly trackerService: TrackerService,
    @Inject(protocolConfig.KEY)
    protocols: ConfigType<typeof protocolConfig>,
  ) {
    this.lendingProtocols = protocols.lendingProtocols || [];
  }

  /**
   * Create APY curve function for supply opportunities with real-time query support
   */
  createSupplyAPYFunctions(
    opp: any,
    baseAmount: number,
    chainId: string,
  ): APYFunctions {
    const baseAPY = this.parseNumber(opp.after?.supplyAPY) || 0;
    const asset = opp.asset;

    const apyCache = new Map<number, number>();
    apyCache.set(baseAmount, baseAPY);

    const syncFn = (amount: number): number => {
      if (amount <= 0) return 0;
      if (apyCache.has(amount)) return apyCache.get(amount)!;
      return this.estimateSupplyAPY(baseAPY, baseAmount, amount);
    };

    const asyncFn = async (amount: number): Promise<number> => {
      if (amount <= 0) return 0;
      if (apyCache.has(amount)) return apyCache.get(amount)!;

      const ratio = amount / baseAmount;
      if (ratio > 0.8 && ratio < 1.2) {
        const estimated = this.estimateSupplyAPY(baseAPY, baseAmount, amount);
        apyCache.set(amount, estimated);
        return estimated;
      }

      this.logger.log(
        `Querying real-time Supply APY for ${asset} at $${amount.toFixed(2)}`,
      );
      const queriedAPY = await this.querySupplyAPYForAmount(
        asset,
        amount,
        chainId,
      );
      if (queriedAPY > 0) {
        this.logger.log(
          `Got real-time APY: ${queriedAPY.toFixed(2)}% ` +
            `(vs estimated: ${this.estimateSupplyAPY(baseAPY, baseAmount, amount).toFixed(2)}%)`,
        );
        apyCache.set(amount, queriedAPY);
        return queriedAPY;
      }

      const estimated = this.estimateSupplyAPY(baseAPY, baseAmount, amount);
      apyCache.set(amount, estimated);
      return estimated;
    };

    return { syncFn, asyncFn };
  }

  /**
   * Create APY curve function for LP opportunities with real-time query support
   */
  createLpAPYFunctions(
    sim: GetLpSimulateResponse,
    baseAmount: number,
    chainId: string,
  ): APYFunctions {
    const baseAPY = this.extractLpApy(sim);
    const poolLiquidity =
      this.parseNumber(sim.pool?.before?.totalLiquidityUSD) || 1000000;
    const poolAddress = sim.pool?.poolAddress || '';
    const currentTick = sim.pool?.position?.currentTick || 0;

    const apyCache = new Map<number, number>();
    apyCache.set(baseAmount, baseAPY);

    const syncFn = (amount: number): number => {
      if (amount <= 0) return 0;
      if (apyCache.has(amount)) return apyCache.get(amount)!;
      return this.estimateLpAPY(baseAPY, poolLiquidity, baseAmount, amount);
    };

    const asyncFn = async (amount: number): Promise<number> => {
      if (amount <= 0) return 0;
      if (apyCache.has(amount)) return apyCache.get(amount)!;

      const ratio = amount / baseAmount;
      if (ratio > 0.8 && ratio < 1.2) {
        const estimated = this.estimateLpAPY(
          baseAPY,
          poolLiquidity,
          baseAmount,
          amount,
        );
        apyCache.set(amount, estimated);
        return estimated;
      }

      this.logger.log(
        `Querying real-time LP APY for pool ${poolAddress.substring(0, 10)}... at $${amount.toFixed(2)}`,
      );
      const queriedAPY = await this.queryLpAPYForAmount(
        poolAddress,
        amount,
        chainId,
        currentTick,
      );
      if (queriedAPY > 0) {
        this.logger.log(
          `Got real-time APY: ${queriedAPY.toFixed(2)}% ` +
            `(vs estimated: ${this.estimateLpAPY(baseAPY, poolLiquidity, baseAmount, amount).toFixed(2)}%)`,
        );
        apyCache.set(amount, queriedAPY);
        return queriedAPY;
      }

      const estimated = this.estimateLpAPY(
        baseAPY,
        poolLiquidity,
        baseAmount,
        amount,
      );
      apyCache.set(amount, estimated);
      return estimated;
    };

    return { syncFn, asyncFn };
  }

  private async querySupplyAPYForAmount(
    asset: string,
    amount: number,
    chainId: string,
  ): Promise<number> {
    try {
      const result =
        await this.agentService.callMcpTool<GetSupplyOpportunitiesResponse>(
          'get_supply_opportunities',
          {
            chain_id: chainId as ChainId,
            amount,
            protocols: this.lendingProtocols,
          },
        );

      if (result.opportunities && Array.isArray(result.opportunities)) {
        const matchingOpp = result.opportunities.find((o) => o.asset === asset);
        if (matchingOpp) {
          return this.parseNumber(matchingOpp.after?.supplyAPY) || 0;
        }
      }
      return 0;
    } catch (error) {
      this.logger.warn(
        `Failed to query supply APY for ${asset}: ${error.message}`,
      );
      return 0;
    }
  }

  private async queryLpAPYForAmount(
    poolAddress: string,
    amount: number,
    chainId: string,
    currentTick: number,
  ): Promise<number> {
    try {
      const tickLower = Math.trunc(currentTick);
      const tickUpper = tickLower + 1;

      const request: GetLpSimulateRequest = {
        chain_id: chainId as ChainId,
        poolOperation: {
          poolAddress,
          operation: 'add',
          amountUSD: amount,
          tickLower,
          tickUpper,
          timeHorizon: 30,
        },
        priceImpact: false,
        includeIL: true,
      };

      const result = await this.simulateLpWithTrackerBatch([request]);
      const simulations =
        this.normalizeDictionaryResponse<GetLpSimulateResponse>(result);
      if (simulations.length > 0) {
        return this.extractLpApy(simulations[0]);
      }
      return 0;
    } catch (error) {
      this.logger.warn(
        `Failed to query LP APY for ${poolAddress}: ${error.message}`,
      );
      return 0;
    }
  }

  /**
   * Local LP simulation using tracker snapshots, adapted from MCP simulate().
   * Accepts a batch of requests and returns an array of simulations, so callers
   * can continue to use normalizeDictionaryResponse just like MCP batch API.
   */
  async simulateLpWithTrackerBatch(
    requests: GetLpSimulateRequest[],
  ): Promise<GetLpSimulateResponse[]> {
    const simulations: GetLpSimulateResponse[] = [];

    for (const request of requests) {
      const op = request.poolOperation;

      if (!op) {
        throw new Error('No pool operation provided');
      }

      const poolAddress = op.poolAddress;

      // Get latest pool snapshots for pool metadata
      const network = getNetworkDto(Number(request.chain_id));
      const cachesList: PoolSnapshotCachesListResponseDto =
        await this.trackerService.getPoolSnapshotCachesList(network);

      const poolSnapshots: Record<
        string,
        (typeof cachesList.latestSnapshots)[number]
      > = {};
      for (const latest of cachesList.latestSnapshots) {
        const snap = latest.currentSnapshot;
        if (!snap?.poolAddress) continue;
        poolSnapshots[snap.poolAddress] = latest;
      }

      const pool = poolSnapshots[poolAddress];

      if (!pool) {
        simulations.push({
          timestamp: Date.now(),
          summary: {
            totalLiquidityUSD: 0,
            totalExpectedAPY: 0,
            totalExpectedDailyReturn: 0,
          },
          pool: {
            protocol: 'uniswap',
            poolAddress: op.poolAddress,
            inputAmountUSD: op.amountUSD,
            position: {
              currentTick: 0,
              inRange: false,
              token0Amount: 0,
              token1Amount: 0,
            },
            before: {
              totalLiquidityUSD: 0,
              apy: 0,
              tvl: 0,
            },
            after: {
              totalLiquidityUSD: 0,
              estimatedAPY: 0,
              tvl: 0,
              yourShare: 0,
            },
          },
        });
        continue;
      }

      const tickLower = BigInt(op.tickLower ?? -887272);
      const tickUpper = BigInt(op.tickUpper ?? 887272);

      const latestSnapshot = pool.currentSnapshot;

      // Calculate beforeAPY and afterAPY using historical snapshots
      const timeMinutes = op.timeHorizon ?? 30;
      const amountUsd = op.amountUSD.toString();

      const snapshots = pool.snapshots
        ? [...pool.snapshots]
            .sort((a, b) => {
              return (
                new Date(b.timestampMs).getTime() -
                new Date(a.timestampMs).getTime()
              );
            })
            .slice(0, timeMinutes)
        : [];

      // Get the most recent snapshot's fee
      const latestSnapshotForFee = snapshots[0] || latestSnapshot;
      // Fee in basis points (e.g., 100 = 0.01% = 1 bps, 500 = 0.05%, 3000 = 0.3%, 10000 = 1%)
      const feeBps = latestSnapshotForFee
        ? parseFloat(latestSnapshotForFee.fee)
        : 3000;
      const feeRate = feeBps / 1000000; // Convert basis points to decimal (e.g., 100 bps -> 0.01, 3000 bps -> 0.3)

      const currentTickBigInt = BigInt(latestSnapshot.currentTick);
      const isInRange =
        currentTickBigInt >= tickLower && currentTickBigInt < tickUpper;

      // Calculate current TVL in the tick range
      const ticksInRange = latestSnapshot.ticks.filter(
        (t) => BigInt(t.tick) >= tickLower && BigInt(t.tick) < tickUpper,
      );

      const currentTVL = ticksInRange.reduce((acc, t) => {
        return acc
          .plus(new Decimal(t.token0AmountUsd))
          .plus(new Decimal(t.token1AmountUsd));
      }, new Decimal(0));

      const tvlAfter = currentTVL.plus(amountUsd);

      // Calculate total volume from historical snapshots
      const allTicksWithVolumes = snapshots.flatMap((s) =>
        s.ticks.filter(
          (t) => BigInt(t.tick) >= tickLower && BigInt(t.tick) < tickUpper,
        ),
      );

      const totalVolume = allTicksWithVolumes.reduce((acc, t) => {
        return acc.plus(new Decimal(t.tradingVolume || '0'));
      }, new Decimal(0));

      // Calculate fees earned from volume
      const totalFees = totalVolume.mul(feeRate);

      // APY = (fees / liquidity) * (365 * 24 * 60 / time_minutes) * 100 (to get percentage)
      const beforeApy = currentTVL.gt(0)
        ? totalFees
            .div(currentTVL)
            .mul(365 * 24 * 60)
            .div(timeMinutes)
            .mul(100)
            .toNumber()
        : 0;

      // Only calculate afterAPY if current tick is in range
      const apy =
        isInRange && tvlAfter.gt(0)
          ? totalFees
              .div(tvlAfter)
              .mul(365 * 24 * 60)
              .div(timeMinutes)
              .mul(100)
              .toNumber()
          : 0;

      const currentTick = parseInt(latestSnapshot.currentTick);

      // Calculate current price from sqrtPriceX96 if available, otherwise fallback to tick
      let currentPrice: number;
      if (latestSnapshot.currentPrice) {
        try {
          const sqrtPriceX96 = BigInt(latestSnapshot.currentPrice);
          const Q96 = BigInt(2) ** BigInt(96);

          const priceX192 = sqrtPriceX96 * sqrtPriceX96;
          const Q192 = Q96 * Q96;

          const scaleFactor = BigInt(10) ** BigInt(18);
          const scaledPrice = (priceX192 * scaleFactor) / Q192;
          currentPrice = Number(scaledPrice) / 1e18;
        } catch {
          currentPrice = Math.pow(1.0001, currentTick);
        }
      } else {
        currentPrice = Math.pow(1.0001, currentTick);
      }

      const inRange =
        currentTick >= Number(tickLower) && currentTick < Number(tickUpper);

      // Calculate TVL from the snapshot ticks
      let tvl = 0;
      if (latestSnapshot && latestSnapshot.ticks) {
        tvl = latestSnapshot.ticks.reduce((sum, tick) => {
          return (
            sum +
            parseFloat(tick.token0AmountUsd) +
            parseFloat(tick.token1AmountUsd)
          );
        }, 0);
      }

      // Calculate new TVL after operation
      let newTvl = tvl;
      if (op.operation === 'add') {
        newTvl = tvl + op.amountUSD;
      } else {
        newTvl = Math.max(0, tvl - op.amountUSD);
      }

      const yourShare = newTvl > 0 ? (op.amountUSD / newTvl) * 100 : 0;

      const dailyReturn = op.amountUSD * (apy / 365);

      let token0AmountUSD = 0;
      let token1AmountUSD = 0;

      const priceLower = Math.pow(1.0001, Number(tickLower));
      const priceUpper = Math.pow(1.0001, Number(tickUpper));

      if (inRange) {
        const sqrtPrice = Math.sqrt(currentPrice);
        const sqrtPriceLower = Math.sqrt(priceLower);
        const sqrtPriceUpper = Math.sqrt(priceUpper);

        const valueInToken0 = (sqrtPrice - sqrtPriceLower) / sqrtPrice;
        const valueInToken1 = (sqrtPriceUpper - sqrtPrice) * sqrtPrice;

        const totalValue = valueInToken0 + valueInToken1;

        if (totalValue > 0) {
          const token1Ratio = valueInToken1 / totalValue;
          token0AmountUSD = op.amountUSD * token1Ratio;
          token1AmountUSD = op.amountUSD * (1 - token1Ratio);
        } else {
          token0AmountUSD = op.amountUSD / 2;
          token1AmountUSD = op.amountUSD / 2;
        }
      } else if (currentTick < Number(tickLower)) {
        token0AmountUSD = op.amountUSD;
        token1AmountUSD = 0;
      } else {
        token0AmountUSD = 0;
        token1AmountUSD = op.amountUSD;
      }

      const token0Amount = token0AmountUSD;
      const token1Amount = token1AmountUSD;

      simulations.push({
        timestamp: Date.now(),
        summary: {
          totalLiquidityUSD: op.amountUSD,
          totalExpectedAPY: apy,
          totalExpectedDailyReturn: dailyReturn,
          requiredTokens: {
            token0: {
              amount: token0Amount,
              amountUSD: token0AmountUSD,
              percentage: (token0AmountUSD / op.amountUSD) * 100,
            },
            token1: {
              amount: token1Amount,
              amountUSD: token1AmountUSD,
              percentage: (token1AmountUSD / op.amountUSD) * 100,
            },
          },
        },
        pool: {
          protocol: (latestSnapshot as any).dexKey || 'uniswap',
          poolAddress: latestSnapshot.poolAddress,
          inputAmountUSD: op.amountUSD,
          position: {
            tickLower: op.tickLower,
            tickUpper: op.tickUpper,
            currentTick,
            inRange,
            priceRange: {
              lower: priceLower,
              upper: priceUpper,
              current: currentPrice,
            },
            token0Amount,
            token1Amount,
          },
          before: {
            totalLiquidityUSD: tvl,
            apy: beforeApy,
            tvl,
          },
          after: {
            totalLiquidityUSD: newTvl,
            estimatedAPY: apy,
            tvl: newTvl,
            yourShare,
          },
        },
      });
    }

    return simulations;
  }

  private estimateSupplyAPY(
    baseAPY: number,
    baseAmount: number,
    targetAmount: number,
  ): number {
    if (targetAmount <= baseAmount) return baseAPY;
    const decayRate = 0.05;
    const ratio = targetAmount / baseAmount;
    const decayedAPY = baseAPY * Math.exp(-decayRate * (ratio - 1));
    return Math.max(decayedAPY, baseAPY * 0.5);
  }

  private estimateLpAPY(
    baseAPY: number,
    poolLiquidity: number,
    baseAmount: number,
    targetAmount: number,
  ): number {
    if (targetAmount <= 0) return 0;
    const newLiquidity = poolLiquidity + targetAmount;
    const liquidityRatio = poolLiquidity / newLiquidity;
    const scaledAPY = baseAPY * liquidityRatio * (baseAmount / targetAmount);
    return Math.max(scaledAPY, baseAPY * 0.3);
  }

  extractLpApy(simulation: GetLpSimulateResponse | null | undefined): number {
    if (!simulation) return 0;

    const candidateValues = [
      this.parseNumber(simulation.pool?.after?.estimatedAPY),
      this.parseNumber((simulation.pool?.after as any)?.afterAPY),
      this.parseNumber((simulation as any)?.afterAPY),
      this.parseNumber(simulation.summary?.totalExpectedAPY),
      this.parseNumber(simulation.pool?.before?.apy),
    ];

    for (const candidate of candidateValues) {
      if (candidate !== null) return candidate;
    }
    return 0;
  }

  parseNumber(value: any): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const sanitized = value.replace(/[%,$]/g, '').trim();
      const parsed = Number(sanitized);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return null;
  }

  private normalizeDictionaryResponse<T>(data: any): T[] {
    if (!data) return [];
    if (Array.isArray(data)) return data as T[];
    if (typeof data === 'object') {
      const entries = Object.entries(data).filter(
        ([key]) => key !== '_dataSource',
      );
      if (entries.length === 0) return [];
      entries.sort((a, b) => {
        const aNum = Number(a[0]);
        const bNum = Number(b[0]);
        const aIsNum = !Number.isNaN(aNum);
        const bIsNum = !Number.isNaN(bNum);
        if (aIsNum && bIsNum) return aNum - bNum;
        if (aIsNum) return -1;
        if (bIsNum) return 1;
        return a[0].localeCompare(b[0]);
      });
      return entries.map(([, value]) => value as T);
    }
    return [];
  }
}
