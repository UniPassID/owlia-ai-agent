import {
  CallReturnType,
  ContractFunctionParameters,
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  getCreate2Address,
  http,
  keccak256,
  parseAbiParameters,
  PublicClient,
} from 'viem';
import { getChain, NetworkDto } from '../../common/dto/network.dto';
import {
  AerodromeCLPositionResponseDto,
  AerodromeCLProtocolBlockResponseDto,
} from '../dto/aerodrome-cl.response.dto';
import { fallback } from '../../common/fallback-transport';
import { AERODROME_CL_NONFUNGIBLE_POSITION_MANAGER_ABI } from '../abis/aerodrome-cl-nonfungible-position-manager.abi';
import Decimal from 'decimal.js';
import { Logger } from '@nestjs/common';
import { UnknownException } from '../../common/exceptions/base.exception';
import { AERODROME_CL_POOL_ABI } from '../abis/aerodrome-cl-pool.abi';
import {
  DexKeyDto,
  TokenPriceResponseDto,
  TokenPricesResponseDto,
  TrackerClient,
} from '../../common/tracker-client';

const FACTORY_ADDRESS: Record<NetworkDto, string | null> = {
  [NetworkDto.Bsc]: null,
  [NetworkDto.Base]: '0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A',
};

const NONFUNGIBLE_POSITION_MANAGER_ADDRESS: Record<NetworkDto, string | null> =
  {
    [NetworkDto.Bsc]: null,
    [NetworkDto.Base]: '0x827922686190790b37229fd06084350E74485b72',
  };

const IMPLEMENTATION_ADDRESS: Record<NetworkDto, string | null> = {
  [NetworkDto.Bsc]: null,
  [NetworkDto.Base]: '0xeC8E5342B19977B4eF8892e02D8DAEcfa1315831',
};

export class AerodromeCLManager {
  nonfungiblePositionManagerAddress: string;
  factorAddress: string;
  implementationAddress: string;

  private readonly client: PublicClient;
  private readonly logger: Logger = new Logger(AerodromeCLManager.name);
  private readonly trackerClient: TrackerClient;

  constructor(
    private readonly network: NetworkDto,
    private readonly rpcUrls: string[],
    private readonly trackerUrl: string,
  ) {
    const nonfungiblePositionManagerAddress =
      NONFUNGIBLE_POSITION_MANAGER_ADDRESS[this.network];
    if (!nonfungiblePositionManagerAddress) {
      throw new Error(
        `Nonfungible position manager address not found for network: ${network}`,
      );
    }
    this.nonfungiblePositionManagerAddress = nonfungiblePositionManagerAddress;

    const factorAddress = FACTORY_ADDRESS[this.network];
    if (!factorAddress) {
      throw new Error(
        `Aerodrome Slipstream factory address not found for network: ${network}`,
      );
    }
    this.factorAddress = factorAddress;

    const implementationAddress = IMPLEMENTATION_ADDRESS[this.network];
    if (!implementationAddress) {
      throw new Error(
        `Aerodrome Slipstream implementation address not found for network: ${network}`,
      );
    }
    this.implementationAddress = implementationAddress;

    this.client = createPublicClient({
      chain: getChain(this.network),
      transport: fallback(this.rpcUrls.map((rpcUrl) => http(rpcUrl))),
    });
    this.trackerClient = new TrackerClient(this.trackerUrl);
  }

  async getAerodromeCLAccountPortfolio(
    account: string,
    tokenPrices: TokenPricesResponseDto,
  ): Promise<AerodromeCLProtocolBlockResponseDto> {
    const nftBalance = await this.client.readContract({
      address: this.nonfungiblePositionManagerAddress,
      abi: AERODROME_CL_NONFUNGIBLE_POSITION_MANAGER_ABI,
      functionName: 'balanceOf',
      args: [account],
    });

    let assetUsd = new Decimal(0);
    const debtUsd = new Decimal(0);
    let netUsd = new Decimal(0);
    let claimableUsd = new Decimal(0);
    const positions: AerodromeCLPositionResponseDto[] = [];

    if (nftBalance > 0n) {
      const tokenIdContracts: ContractFunctionParameters[] = [];
      for (let i = 0; i < nftBalance; i++) {
        tokenIdContracts.push({
          address: this.nonfungiblePositionManagerAddress,
          abi: AERODROME_CL_NONFUNGIBLE_POSITION_MANAGER_ABI,
          functionName: 'tokenOfOwnerByIndex',
          args: [account, i],
        });
      }

      const tokenIdRets = await this.client.multicall({
        contracts: tokenIdContracts,
      });

      const tokenIds = tokenIdRets.map((ret) => {
        if (ret.status !== 'success') {
          this.logger.error(`got token of owner by index failed: ${ret.error}`);
          throw new UnknownException();
        }
        return BigInt(ret.result as string);
      });

      const feesAndPositionsRets = await Promise.all(
        tokenIds.flatMap((tokenId) => {
          return [
            this.client.call({
              account,
              to: this.nonfungiblePositionManagerAddress,
              data: encodeFunctionData({
                abi: AERODROME_CL_NONFUNGIBLE_POSITION_MANAGER_ABI,
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
            }),
            this.client.readContract({
              address: this.nonfungiblePositionManagerAddress,
              abi: AERODROME_CL_NONFUNGIBLE_POSITION_MANAGER_ABI,
              functionName: 'positions',
              args: [tokenId],
            }),
          ];
        }),
      );
      const rets: {
        aerodromeClPosition: Omit<
          AerodromeCLPositionResponseDto,
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
      const creationCode = [
        '0x3d602d80600a3d3981f3363d3d373d3d3d363d73', // https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/proxy/Clones.sol#L110
        this.implementationAddress.replace(/0x/, ''),
        '5af43d82803e903d91602b57fd5bf3', // https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/proxy/Clones.sol#L108
      ].join('');
      const salt = keccak256(creationCode as `0x${string}`);

      let poolAddresses: string[] = [];
      for (let i = 0; i < feesAndPositionsRets.length; i += 2) {
        if (
          feesAndPositionsRets[i] === null ||
          feesAndPositionsRets[i + 1] === null
        ) {
          continue;
        }
        const poolAddress = getCreate2Address({
          from: this.factorAddress,
          salt: salt,
          bytecodeHash: keccak256(
            encodeAbiParameters(
              parseAbiParameters(['address', 'address', 'int24']),
              [
                feesAndPositionsRets[i + 1][2],
                feesAndPositionsRets[i + 1][3],
                feesAndPositionsRets[i + 1][4],
              ],
            ),
          ),
        });
        poolAddresses.push(poolAddress);
      }

      poolAddresses = [...new Set(poolAddresses)];

      const poolFees = await this.client.multicall({
        contracts: poolAddresses.map((poolAddress) => ({
          address: poolAddress,
          abi: AERODROME_CL_POOL_ABI,
          functionName: 'fee',
          args: [],
        })),
      });
      const poolFeesMap = new Map<string, string>();
      for (let i = 0; i < poolFees.length; i++) {
        poolFeesMap.set(poolAddresses[i], poolFees[i].toString());
      }

      for (let i = 0; i < feesAndPositionsRets.length; i += 2) {
        if (
          feesAndPositionsRets[i] === null ||
          feesAndPositionsRets[i + 1] === null
        ) {
          continue;
        }
        const feeRet = {
          amount0: feesAndPositionsRets[i][0],
          amount1: feesAndPositionsRets[i][1],
        };
        const positionRet = {
          nonce: feesAndPositionsRets[i + 1][0],
          operator: feesAndPositionsRets[i + 1][1],
          token0: feesAndPositionsRets[i + 1][2],
          token1: feesAndPositionsRets[i + 1][3],
          tickSpacing: feesAndPositionsRets[i + 1][4],
          tickLower: feesAndPositionsRets[i + 1][5],
          tickUpper: feesAndPositionsRets[i + 1][6],
          liquidity: feesAndPositionsRets[i + 1][7],
        };

        if (positionRet.liquidity === 0n) {
          continue;
        }

        const tokenId = tokenIds[i / 2];
        const poolAddress = getCreate2Address({
          from: this.factorAddress,
          salt: salt,
          bytecode: encodeAbiParameters(
            parseAbiParameters(['address', 'address', 'int24']),
            [positionRet.token0, positionRet.token1, positionRet.tickSpacing],
          ),
        });
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
          const unclaimedAmount0 = new Decimal(feeRet.amount0).div(
            new Decimal(10).pow(token0InfoWithPrice.tokenDecimals),
          );
          const unclaimedAmount0Usd = unclaimedAmount0.mul(
            token0InfoWithPrice.bid,
          );
          const unclaimedAmount1 = new Decimal(feeRet.amount1).div(
            new Decimal(10).pow(token1InfoWithPrice.tokenDecimals),
          );
          const unclaimedAmount1Usd = unclaimedAmount1.mul(
            token1InfoWithPrice.bid,
          );
          netUsd = netUsd.add(unclaimedAmount0Usd).add(unclaimedAmount1Usd);
          claimableUsd = claimableUsd
            .add(unclaimedAmount0Usd)
            .add(unclaimedAmount1Usd);
          rets.push({
            aerodromeClPosition: {
              token0: positionRet.token0,
              token1: positionRet.token1,
              tickSpacing: positionRet.tickSpacing,
              tickLower: positionRet.tickLower,
              tickUpper: positionRet.tickUpper,
              tokenId: tokenId.toString(),
              poolAddress,
              fee: poolFeesMap.get(poolAddress) || '0',
              tokensOwed0: unclaimedAmount0.toString(),
              tokensOwed0Usd: unclaimedAmount0Usd.toString(),
              tokensOwed1: unclaimedAmount1.toString(),
              tokensOwed1Usd: unclaimedAmount1Usd.toString(),
              liquidity: positionRet.liquidity.toString(),
            },
            token0InfoWithPrice,
            token1InfoWithPrice,
          });

          liquidityPromises.push(
            this.client.call({
              account,
              to: this.nonfungiblePositionManagerAddress,
              data: encodeFunctionData({
                abi: AERODROME_CL_NONFUNGIBLE_POSITION_MANAGER_ABI,
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
            }),
          );
        }
      }
      const [liquidityRets, poolSnapshotCaches] = await Promise.all([
        Promise.all(liquidityPromises),
        Promise.all(
          poolAddresses.map((poolAddress) =>
            this.trackerClient.getPoolSnapshotCaches(
              this.network,
              DexKeyDto.AerodromeCL,
              poolAddress,
            ),
          ),
        ),
      ]);

      for (let i = 0; i < liquidityRets.length; i++) {
        const {
          aerodromeClPosition,
          token0InfoWithPrice,
          token1InfoWithPrice,
        } = rets[i];
        const decreaseLiquidityRet = {
          amount0: liquidityRets[i][0],
          amount1: liquidityRets[i][1],
        };
        const lpAmount0 = new Decimal(decreaseLiquidityRet.amount0).div(
          new Decimal(10).pow(token0InfoWithPrice.tokenDecimals),
        );
        const lpAmount0Usd = lpAmount0.mul(token0InfoWithPrice.bid);
        const lpAmount1 = new Decimal(decreaseLiquidityRet.amount1).div(
          new Decimal(10).pow(token1InfoWithPrice.tokenDecimals),
        );
        const lpAmount1Usd = lpAmount1.mul(token1InfoWithPrice.bid);
        assetUsd = assetUsd.add(lpAmount0Usd).add(lpAmount1Usd);
        netUsd = netUsd.add(lpAmount0Usd).add(lpAmount1Usd);
        claimableUsd = claimableUsd.add(lpAmount0Usd).add(lpAmount1Usd);
        const caches = poolSnapshotCaches.find((cache) =>
          cache.snapshots.some(
            (snapshot) =>
              snapshot.dexKey === DexKeyDto.AerodromeCL &&
              snapshot.poolAddress === aerodromeClPosition.poolAddress,
          ),
        );

        let apy = '0';
        if (caches) {
          const holderAmountSum = caches.currentSnapshot.ticks
            .filter(
              (tick) =>
                BigInt(tick.tick) >= BigInt(aerodromeClPosition.tickLower) &&
                BigInt(tick.tick) < BigInt(aerodromeClPosition.tickUpper),
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
                        BigInt(aerodromeClPosition.tickLower) &&
                      BigInt(tick.tick) < BigInt(aerodromeClPosition.tickUpper),
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
          ...aerodromeClPosition,
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
      id: 'aerodrome-cl',
      name: 'Aerodrome',
      version: 'v2',
      assetUsd: assetUsd.toString(),
      debtUsd: debtUsd.toString(),
      netUsd: netUsd.toString(),
      claimableUsd: claimableUsd.toString(),
      positions,
    };
  }
}
