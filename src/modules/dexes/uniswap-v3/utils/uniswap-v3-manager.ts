import {
  CallReturnType,
  createPublicClient,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  getCreate2Address,
  http,
  keccak256,
  parseAbiParameters,
  PublicClient,
} from 'viem';
import { getChain, NetworkDto } from '../../../../common/dto/network.dto';
import { fallback } from '../../../../common/fallback-transport';
import {
  UniswapV3LiquidityPositionResponseDto,
  UniswapV3PoolInfoResponseDto,
  UniswapV3PositionResponseDto,
  UniswapV3ProtocolBlockResponseDto,
} from '../dto/uniswap-v3.response.dto';
import { UNISWAP_V3_NONFUNGIBLE_POSITION_MANAGER_ABI } from '../../../../abis/uniswap-v3-nonfungible-position-manager.abi';
import { Logger } from '@nestjs/common';
import { UnknownException } from '../../../../common/exceptions/base.exception';
import {
  TokenPriceResponseDto,
  TokenPricesResponseDto,
} from '../../../tracker/dto/token-price.response';
import { TrackerService } from '../../../tracker/tracker.service';
import Decimal from 'decimal.js';
import { UNISWAP_V3_POOL_ABI } from '../../../../abis/uniswap-v3-pool.abi';
import {
  UNISWAP_V3_FACTORY_ADDRESS,
  UNISWAP_V3_INIT_HASH,
  UNISWAP_V3_NONFUNGIBLE_POSITION_MANAGER_ADDRESS,
} from '../../../../common/constants';
import { DexKeyDto } from '../../../tracker/dto/pool-snapshot.dto';

export class UniswapV3Manager {
  nonfungiblePositionManagerAddress: string;
  factorAddress: string;
  initHash: string;

  private readonly logger: Logger = new Logger(UniswapV3Manager.name);
  private readonly client: PublicClient;

  constructor(
    private readonly network: NetworkDto,
    private readonly rpcUrls: string[],
    private readonly trackerService: TrackerService,
  ) {
    this.nonfungiblePositionManagerAddress =
      UNISWAP_V3_NONFUNGIBLE_POSITION_MANAGER_ADDRESS[network];
    this.factorAddress = UNISWAP_V3_FACTORY_ADDRESS[network];
    this.initHash = UNISWAP_V3_INIT_HASH[network];

    this.client = createPublicClient({
      chain: getChain(this.network),
      transport: fallback(this.rpcUrls.map((rpcUrl) => http(rpcUrl))),
    });
  }

  async getUserUniswapV3Portfolio(
    account: string,
    tokenPrices: TokenPricesResponseDto,
  ): Promise<UniswapV3ProtocolBlockResponseDto> {
    const nftBalance = await this.client.readContract({
      address: this.nonfungiblePositionManagerAddress,
      abi: UNISWAP_V3_NONFUNGIBLE_POSITION_MANAGER_ABI,
      functionName: 'balanceOf',
      args: [account],
    });

    let assetUsd = new Decimal(0);
    const debtUsd = new Decimal(0);
    let netUsd = new Decimal(0);
    let claimableUsd = new Decimal(0);
    const positions: UniswapV3PositionResponseDto[] = [];

    if (nftBalance > 0n) {
      const tokenIdRets = await this.client.multicall({
        contracts: Array.from({ length: Number(nftBalance) }, (_, i) => ({
          address: this.nonfungiblePositionManagerAddress,
          abi: UNISWAP_V3_NONFUNGIBLE_POSITION_MANAGER_ABI,
          functionName: 'tokenOfOwnerByIndex',
          args: [account, i],
        })),
      });

      const tokenIds = tokenIdRets.map((ret) => {
        if (ret.status === 'failure') {
          this.logger.error(`got token id failed: ${ret.error}`);
          throw new UnknownException();
        }
        return BigInt(ret.result as string);
      });

      const feesAndPositionsRets = await Promise.all(
        tokenIds
          .map((tokenId) => {
            return [
              this.client.call({
                to: this.nonfungiblePositionManagerAddress,
                data: encodeFunctionData({
                  abi: UNISWAP_V3_NONFUNGIBLE_POSITION_MANAGER_ABI,
                  functionName: 'collect',
                  args: [
                    {
                      tokenId,
                      recipient: account,
                      amount0Max: BigInt('0xfffffffffffffffffffffffffffffff0'),
                      amount1Max: BigInt('0xfffffffffffffffffffffffffffffff0'),
                    },
                  ],
                }),
                account,
              }),
              this.client.readContract({
                address: this.nonfungiblePositionManagerAddress,
                abi: UNISWAP_V3_NONFUNGIBLE_POSITION_MANAGER_ABI,
                functionName: 'positions',
                args: [tokenId],
              }),
            ];
          })
          .flat(),
      );

      let poolAddresses: string[] = [];
      for (let i = 0; i < feesAndPositionsRets.length; i += 2) {
        if (
          feesAndPositionsRets[i] === null ||
          feesAndPositionsRets[i + 1] === null
        ) {
          continue;
        }
        const poolAddress = this.getPoolAddress(
          feesAndPositionsRets[i + 1][2],
          feesAndPositionsRets[i + 1][3],
          feesAndPositionsRets[i + 1][4],
        );
        poolAddresses.push(poolAddress);
      }

      poolAddresses = [...new Set(poolAddresses)];

      const poolTickSpacings = await this.client.multicall({
        contracts: poolAddresses.map((poolAddress) => ({
          address: poolAddress,
          abi: UNISWAP_V3_POOL_ABI,
          functionName: 'tickSpacing',
          args: [],
        })),
      });
      const poolTickSpacingsMap = new Map<string, string>();
      for (let i = 0; i < poolTickSpacings.length; i++) {
        if (poolTickSpacings[i].status === 'failure') {
          this.logger.error(
            `got pool tick spacing failed: ${poolTickSpacings[i].error}`,
          );
          throw new UnknownException();
        }

        poolTickSpacingsMap.set(
          poolAddresses[i],
          poolTickSpacings[i].toString(),
        );
      }

      const rets: {
        uniswapV3Position: Omit<
          UniswapV3PositionResponseDto,
          | 'apy'
          | 'amount0'
          | 'amount1'
          | 'amount0Usd'
          | 'amount1Usd'
          | 'positionUsd'
        >;
        token0InfoWithPrice: TokenPriceResponseDto;
        token1InfoWithPrice: TokenPriceResponseDto;
      }[] = [];
      const liquidityPromises: Promise<CallReturnType>[] = [];
      for (let i = 0; i < feesAndPositionsRets.length; i += 2) {
        if (
          feesAndPositionsRets[i] === null ||
          feesAndPositionsRets[i] === undefined ||
          feesAndPositionsRets[i + 1] === null ||
          feesAndPositionsRets[i + 1] === undefined
        ) {
          continue;
        }
        const feeRet = decodeFunctionResult({
          abi: UNISWAP_V3_NONFUNGIBLE_POSITION_MANAGER_ABI,
          data: (feesAndPositionsRets[i] as CallReturnType)
            .data as `0x${string}`,
          functionName: 'collect',
        });
        const positionRet = {
          nonce: feesAndPositionsRets[i + 1][0],
          operator: feesAndPositionsRets[i + 1][1],
          token0: feesAndPositionsRets[i + 1][2],
          token1: feesAndPositionsRets[i + 1][3],
          fee: feesAndPositionsRets[i + 1][4],
          tickLower: feesAndPositionsRets[i + 1][5],
          tickUpper: feesAndPositionsRets[i + 1][6],
          liquidity: feesAndPositionsRets[i + 1][7],
        };

        if (positionRet.liquidity === 0n) {
          continue;
        }

        const tokenId = tokenIds[i / 2];
        const poolAddress = this.getPoolAddress(
          positionRet.token0,
          positionRet.token1,
          positionRet.fee,
        );
        const token0InfoWithPrice = tokenPrices.tokenPrices.find(
          (tokenPrice) =>
            tokenPrice.network === this.network &&
            tokenPrice.tokenAddress === positionRet.token0,
        );
        const token1InfoWithPrice = tokenPrices.tokenPrices.find(
          (tokenPrice) =>
            tokenPrice.network === this.network &&
            tokenPrice.tokenAddress === positionRet.token1,
        );
        if (token0InfoWithPrice && token1InfoWithPrice) {
          const unclaimedAmount0 = new Decimal(feeRet[0]).div(
            new Decimal(10).pow(token0InfoWithPrice.tokenDecimals),
          );
          const unclaimedAmount0Usd = unclaimedAmount0.mul(
            token0InfoWithPrice.bid,
          );
          const unclaimedAmount1 = new Decimal(feeRet[1]).div(
            new Decimal(10).pow(token1InfoWithPrice.tokenDecimals),
          );
          const unclaimedAmount1Usd = unclaimedAmount1.mul(
            token1InfoWithPrice.bid,
          );
          claimableUsd = claimableUsd
            .add(unclaimedAmount0Usd)
            .add(unclaimedAmount1Usd);
          netUsd = netUsd.add(unclaimedAmount0Usd).add(unclaimedAmount1Usd);
          rets.push({
            uniswapV3Position: {
              tokenId: tokenId.toString(),
              liquidity: positionRet.liquidity.toString(),
              tickSpacing: poolTickSpacingsMap.get(poolAddress) || '0',
              tokensOwed0: unclaimedAmount0.toString(),
              tokensOwed0Usd: unclaimedAmount0Usd.toString(),
              tokensOwed1: unclaimedAmount1.toString(),
              tokensOwed1Usd: unclaimedAmount1Usd.toString(),
              token0: positionRet.token0,
              token1: positionRet.token1,
              fee: positionRet.fee,
              tickLower: positionRet.tickLower.toString(),
              tickUpper: positionRet.tickUpper.toString(),
              poolAddress: poolAddress,
            },
            token0InfoWithPrice,
            token1InfoWithPrice,
          });
          liquidityPromises.push(
            this.client.call({
              to: this.nonfungiblePositionManagerAddress,
              data: encodeFunctionData({
                abi: UNISWAP_V3_NONFUNGIBLE_POSITION_MANAGER_ABI,
                functionName: 'decreaseLiquidity',
                args: [
                  {
                    tokenId: tokenIds[i / 2],
                    liquidity: positionRet.liquidity,
                    amount0Min: 0n,
                    amount1Min: 0n,
                    deadline: BigInt(Math.floor(Date.now() / 1000) + 1000),
                  },
                ],
              }),
              account,
            }),
          );
        }
      }
      const [liquidityRets, poolSnapshotCaches] = await Promise.all([
        Promise.all(liquidityPromises),
        Promise.all(
          poolAddresses.map((poolAddress) =>
            this.trackerService.getPoolSnapshotCaches(
              this.network,
              DexKeyDto.UniswapV3,
              poolAddress,
            ),
          ),
        ),
      ]);

      for (let i = 0; i < liquidityRets.length; i++) {
        const { uniswapV3Position, token0InfoWithPrice, token1InfoWithPrice } =
          rets[i];
        const decreaseLiquidityRet = decodeFunctionResult({
          abi: UNISWAP_V3_NONFUNGIBLE_POSITION_MANAGER_ABI,
          data: (liquidityRets[i] as CallReturnType).data as `0x${string}`,
          functionName: 'decreaseLiquidity',
        });
        const lpAmount0 = new Decimal(decreaseLiquidityRet[0]).div(
          new Decimal(10).pow(token0InfoWithPrice.tokenDecimals),
        );
        const lpAmount0Usd = lpAmount0.mul(token0InfoWithPrice.bid);
        const lpAmount1 = new Decimal(decreaseLiquidityRet[1]).div(
          new Decimal(10).pow(token1InfoWithPrice.tokenDecimals),
        );
        const lpAmount1Usd = lpAmount1.mul(token1InfoWithPrice.bid);
        assetUsd = assetUsd.add(lpAmount0Usd).add(lpAmount1Usd);
        netUsd = netUsd.add(lpAmount0Usd).add(lpAmount1Usd);
        claimableUsd = claimableUsd.add(lpAmount0Usd).add(lpAmount1Usd);

        let apy = '0';
        const caches = poolSnapshotCaches.find((cache) =>
          cache.snapshots.some(
            (snapshot) =>
              snapshot.dexKey === DexKeyDto.UniswapV3 &&
              snapshot.poolAddress === uniswapV3Position.poolAddress,
          ),
        );

        if (caches) {
          const holderAmountSum = caches.currentSnapshot.ticks
            .filter(
              (tick) =>
                BigInt(tick.tick) >= BigInt(uniswapV3Position.tickLower) &&
                BigInt(tick.tick) < BigInt(uniswapV3Position.tickUpper),
            )
            .reduce((acc, tick) => {
              acc = acc
                .add(new Decimal(tick.token0AmountUsd))
                .add(new Decimal(tick.token1AmountUsd));
              return acc;
            }, new Decimal(0));

          if (holderAmountSum.gt(0)) {
            const tradingVolumeSum = caches.snapshots.reduce(
              (acc, snapshot) => {
                snapshot.ticks
                  .filter(
                    (tick) =>
                      BigInt(tick.tick) >=
                        BigInt(uniswapV3Position.tickLower) &&
                      BigInt(tick.tick) < BigInt(uniswapV3Position.tickUpper),
                  )
                  .forEach((tick) => {
                    acc = acc.add(new Decimal(tick.tradingVolume));
                  });
                return acc;
              },
              new Decimal(0),
            );

            apy = tradingVolumeSum
              .mul(caches.currentSnapshot.fee)
              .div(1000000n)
              .mul(60n * 24n * 365n)
              .mul(100)
              .div(holderAmountSum)
              .div(caches.snapshots.length)
              .toString();
          }
        }
        positions.push({
          ...uniswapV3Position,
          amount0: lpAmount0.toString(),
          amount0Usd: lpAmount0Usd.toString(),
          amount1: lpAmount1.toString(),
          amount1Usd: lpAmount1Usd.toString(),
          positionUsd: lpAmount0Usd.add(lpAmount1Usd).toString(),
          apy,
        });
      }
    }
    return {
      id: 'uniswap-v3',
      name: 'Uniswap',
      version: 'v3',
      assetUsd: assetUsd.toString(),
      debtUsd: debtUsd.toString(),
      netUsd: netUsd.toString(),
      claimableUsd: claimableUsd.toString(),
      positions,
    };
  }

  async getLiquidityPosition(
    tokenId: bigint,
  ): Promise<UniswapV3LiquidityPositionResponseDto> {
    const ret = await this.client.readContract({
      address: this.nonfungiblePositionManagerAddress,
      abi: UNISWAP_V3_NONFUNGIBLE_POSITION_MANAGER_ABI,
      functionName: 'positions',
      args: [tokenId],
    });

    const poolAddress = this.getPoolAddress(ret[2], ret[3], ret[4]);

    return {
      poolAddress,
      nonce: ret[0].toString(),
      operator: ret[1],
      token0: ret[2],
      token1: ret[3],
      fee: ret[4],
      tickLower: ret[5],
      tickUpper: ret[6],
      liquidity: ret[7].toString(),
      feeGrowthInside0LastX128: ret[8].toString(),
      feeGrowthInside1LastX128: ret[9].toString(),
      tokensOwed0: ret[10].toString(),
      tokensOwed1: ret[11].toString(),
    };
  }

  getPoolAddress(token0: string, token1: string, fee: number): string {
    const poolAddress = getCreate2Address({
      from: this.factorAddress,
      bytecodeHash: this.initHash as `0x${string}`,
      salt: keccak256(
        encodeAbiParameters(
          parseAbiParameters(['address', 'address', 'uint24']),
          [token0, token1, fee],
        ),
      ),
    });
    return poolAddress;
  }

  async getPoolInfo(
    poolAddress: string,
  ): Promise<UniswapV3PoolInfoResponseDto> {
    const [
      slot0Result,
      token0Result,
      token1Result,
      feeResult,
      tickSpacingResult,
    ] = await this.client.multicall({
      contracts: [
        {
          address: poolAddress,
          abi: UNISWAP_V3_POOL_ABI,
          functionName: 'slot0',
        },
        {
          address: poolAddress,
          abi: UNISWAP_V3_POOL_ABI,
          functionName: 'token0',
        },
        {
          address: poolAddress,
          abi: UNISWAP_V3_POOL_ABI,
          functionName: 'token1',
        },
        {
          address: poolAddress,
          abi: UNISWAP_V3_POOL_ABI,
          functionName: 'fee',
        },
        {
          address: poolAddress,
          abi: UNISWAP_V3_POOL_ABI,
          functionName: 'tickSpacing',
        },
      ],
    });

    if (slot0Result.status === 'failure') {
      this.logger.error(`got slot0 failed: ${slot0Result.error}`);
      throw new UnknownException();
    }
    if (token0Result.status === 'failure') {
      this.logger.error(`got token0 failed: ${token0Result.error}`);
      throw new UnknownException();
    }
    if (token1Result.status === 'failure') {
      this.logger.error(`got token1 failed: ${token1Result.error}`);
      throw new UnknownException();
    }
    if (feeResult.status === 'failure') {
      this.logger.error(`got fee failed: ${feeResult.error}`);
      throw new UnknownException();
    }
    if (tickSpacingResult.status === 'failure') {
      this.logger.error(`got tickSpacing failed: ${tickSpacingResult.error}`);
      throw new UnknownException();
    }

    const [sqrtPriceX96, tick] = slot0Result.result;
    const token0 = token0Result.result;
    const token1 = token1Result.result;
    const fee = feeResult.result;
    const tickSpacing = tickSpacingResult.result;

    return {
      sqrtPriceX96: sqrtPriceX96.toString(),
      tick,
      token0,
      token1,
      fee,
      tickSpacing,
    };
  }
}
