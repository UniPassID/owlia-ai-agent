import {
  Address,
  Chain,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  maxUint128,
  maxUint256,
  parseAbiParameters,
  WalletClient,
} from 'viem';
import { Logger } from '@nestjs/common';
import { MetaTransactionData } from '@safe-global/types-kit';
import { ERC20_ABI } from '../../../abis/erc-20.abi';
import { AAVE_V3_ABI } from '../../../abis/aave-v3.abi';
import { EULER_V2_VAULT_ABI } from '../../../abis/euler-v2-vault.abi';
import { EULER_V2_EVC_ABI } from '../../../abis/euler-v2-evc.abi';
import { getChain, NetworkDto } from '../../../common/dto/network.dto';
import {
  ActionDto,
  ActionTypeDto,
  BurnActionTypeDto,
  ExecuteRebalancePositionResponseDto,
  MintActionTypeDto,
  RebalancePositionParamsDto,
} from '../dto/rebalance-position.response.dto';
import { VenusV4Service } from '../../dexes/venus-v4/venus-v4.service';
import { EulerV2Service } from '../../dexes/euler-v2/euler-v2.service';
import { AaveV3Service } from '../../dexes/aave-v3/aave-v3.service';
import { AerodromeClService } from '../../dexes/aerodrome-cl/aerodrome-cl.service';
import { UniswapV3Service } from '../../dexes/uniswap-v3/uniswap-v3.service';
import {
  LendingProtocolDto,
  LPProtocolDto,
  RebalancePositionDto,
} from '../dto/rebalance-position.dto';
import {
  AerodromeCLLiquidityPositionResponseDto,
  AerodromeCLPoolInfoResponseDto,
} from '../../dexes/aerodrome-cl/dto/aerodrome-cl.response.dto';
import {
  UniswapV3LiquidityPositionResponseDto,
  UniswapV3PoolInfoResponseDto,
} from '../../dexes/uniswap-v3/dto/uniswap-v3.response.dto';
import Decimal from 'decimal.js';
import { KyberSwapClient } from '../../../common/kyber-swap-client';
import { fallback } from '../../../common/fallback-transport';
import { Account, privateKeyToAccount } from 'viem/accounts';
import { UserService } from '../../user/user.service';
import {
  buildContractSignature,
  EthSafeSignature,
} from '@safe-global/protocol-kit';
import { VENUS_V4_VTOKEN_ABI } from '../../../abis/venus-v4-vtoken.abi';
import { VENUS_V4_COMPTROLLER_ABI } from '../../../abis/venus-v4-comptroller.abi';
import { UNISWAP_V3_NONFUNGIBLE_POSITION_MANAGER_ABI } from '../../../abis/uniswap-v3-nonfungible-position-manager.abi';
import { AERODROME_CL_NONFUNGIBLE_POSITION_MANAGER_ABI } from '../../../abis/aerodrome-cl-nonfungible-position-manager.abi';

export class OwliaGuardManager {
  logger = new Logger(OwliaGuardManager.name);

  #chain: Chain;
  #walletClient: WalletClient;
  #account: Account;

  constructor(
    private readonly network: NetworkDto,
    private readonly aaveV3Service: AaveV3Service,
    private readonly aerodromeCLService: AerodromeClService,
    private readonly eulerV2Service: EulerV2Service,
    private readonly venusV4Service: VenusV4Service,
    private readonly uniswapV3Service: UniswapV3Service,
    private readonly kyberSwapClient: KyberSwapClient,
    private readonly userService: UserService,
    privateKey: string,
    rpcUrls: string[],
  ) {
    this.#chain = getChain(this.network);
    this.#account = privateKeyToAccount(privateKey as `0x${string}`);
    this.#walletClient = createWalletClient({
      chain: this.#chain,
      transport: fallback(rpcUrls.map((rpcUrl) => http(rpcUrl))),
      account: this.#account,
    });
  }

  getAaveV3PoolAddress(): string {
    const address = this.aaveV3Service.getAaveV3PoolAddress(this.network);
    if (!address) {
      throw new Error(
        `Aave V3 pool address not found for network: ${this.network}`,
      );
    }
    return address;
  }

  getVenusV4ComptrollerAddress(): string {
    const address = this.venusV4Service.getVenusV4ComptrollerAddress(
      this.network,
    );
    if (!address) {
      throw new Error(
        `Venus V4 comptroller address not found for network: ${this.network}`,
      );
    }
    return address;
  }

  getEulerV2EVCAddress(): string {
    const address = this.eulerV2Service.getEulerV2EVCAddress(this.network);
    if (!address) {
      throw new Error(
        `Euler V2 EVC address not found for network: ${this.network}`,
      );
    }
    return address;
  }

  getUniswapV3NonFungiblePositionManagerAddress(): string {
    const address =
      this.uniswapV3Service.getUniswapV3NonFungiblePositionManagerAddress(
        this.network,
      );
    if (!address) {
      throw new Error(
        `Uniswap V3 non-fungible position manager address not found for network: ${this.network}`,
      );
    }
    return address;
  }

  getAerodromeCLNonFungiblePositionManagerAddress(): string {
    const address =
      this.aerodromeCLService.getAerodromeCLNonFungiblePositionManagerAddress(
        this.network,
      );
    if (!address) {
      throw new Error(
        `Aerodrome CL non-fungible position manager address not found for network: ${this.network}`,
      );
    }
    return address;
  }

  async buildTransactions(
    address: Address,
    executeParams: RebalancePositionParamsDto,
  ): Promise<MetaTransactionData[]> {
    this.logger.log(`building transactions for address: ${address}`);

    const transactions: MetaTransactionData[] = (
      await Promise.all(
        executeParams.routes.map(async (route) => {
          switch (route.actionType) {
            case ActionTypeDto.Swap: {
              const amount = BigInt(route.amount);
              const approveTxData = encodeFunctionData({
                abi: ERC20_ABI,
                functionName: 'approve',
                args: [route.tokenApprovalAddress as Address, amount],
              });
              const approveTx = {
                data: approveTxData,
                to: route.tokenA as Address,
                value: '0',
              };
              const swapTx = {
                data: route.data,
                to: route.routerAddress as Address,
                value: '0',
              };
              return [approveTx, swapTx];
            }
            case ActionTypeDto.Supply: {
              switch (route.protocol) {
                case LendingProtocolDto.Aave: {
                  const txs: MetaTransactionData[] = [];
                  const amount = BigInt(route.amount);
                  if (amount > 0n) {
                    txs.push({
                      to: route.tokenA,
                      data: encodeFunctionData({
                        abi: ERC20_ABI,
                        functionName: 'approve',
                        args: [
                          this.getAaveV3PoolAddress(),
                          BigInt(route.amount),
                        ],
                      }),
                      value: '0',
                    });
                  }
                  const depositTxData = encodeFunctionData({
                    abi: AAVE_V3_ABI,
                    functionName: 'deposit',
                    args: [route.tokenA, amount, address, 0],
                  });
                  txs.push({
                    data: depositTxData,
                    to: this.getAaveV3PoolAddress(),
                    value: '0',
                  });
                  return txs;
                }
                case LendingProtocolDto.Venus: {
                  const txs: MetaTransactionData[] = [];
                  const amount = BigInt(route.amount);
                  if (amount > 0n) {
                    txs.push({
                      to: route.tokenA,
                      data: encodeFunctionData({
                        abi: ERC20_ABI,
                        functionName: 'approve',
                        args: [route.tokenB, amount],
                      }),
                      value: '0',
                    });
                  }
                  const mintTxData = encodeFunctionData({
                    abi: VENUS_V4_VTOKEN_ABI,
                    functionName: 'mint',
                    args: [amount],
                  });
                  const mintTx = {
                    data: mintTxData,
                    to: route.tokenB,
                    value: '0',
                  };
                  txs.push(mintTx);
                  const enterMarketsTxData = encodeFunctionData({
                    abi: VENUS_V4_COMPTROLLER_ABI,
                    functionName: 'enterMarkets',
                    args: [[route.tokenB]],
                  });

                  const enterMarketsTx = {
                    data: enterMarketsTxData,
                    to: this.getVenusV4ComptrollerAddress(),
                    value: '0',
                  };
                  txs.push(enterMarketsTx);
                  return txs;
                }
                case LendingProtocolDto.Euler: {
                  const txs: MetaTransactionData[] = [];
                  const amount = BigInt(route.amount);
                  if (amount > 0n) {
                    txs.push({
                      to: route.tokenA,
                      data: encodeFunctionData({
                        abi: ERC20_ABI,
                        functionName: 'approve',
                        args: [route.tokenB, amount],
                      }),
                      value: '0',
                    });
                  }
                  const depositTxData = encodeFunctionData({
                    abi: EULER_V2_VAULT_ABI,
                    functionName: 'deposit',
                    args: [amount, address],
                  });

                  const batchTxData = encodeFunctionData({
                    abi: EULER_V2_EVC_ABI,
                    functionName: 'batch',
                    args: [
                      [
                        {
                          targetContract: route.tokenB,
                          onBehalfOfAccount: address,
                          value: 0n,
                          data: depositTxData,
                        },
                      ],
                    ],
                  });
                  const batchTx = {
                    data: batchTxData,
                    to: this.getEulerV2EVCAddress(),
                    value: '0',
                  };
                  txs.push(batchTx);
                  return txs;
                }
              }
            }
            case ActionTypeDto.Withdraw: {
              switch (route.protocol) {
                case LendingProtocolDto.Aave: {
                  const txs: MetaTransactionData[] = [];
                  const amount = BigInt(route.amount);
                  const data = encodeFunctionData({
                    abi: AAVE_V3_ABI,
                    functionName: 'withdraw',
                    args: [route.tokenA, amount, address],
                  });
                  txs.push({
                    data: data,
                    to: this.getAaveV3PoolAddress(),
                    value: '0',
                  });
                  return txs;
                }
                case LendingProtocolDto.Euler: {
                  const txs: MetaTransactionData[] = [];
                  const amount = BigInt(route.amount);
                  const withdrawTxData = encodeFunctionData({
                    abi: EULER_V2_VAULT_ABI,
                    functionName: 'withdraw',
                    args: [amount, address, address],
                  });

                  const batchTxData = encodeFunctionData({
                    abi: EULER_V2_EVC_ABI,
                    functionName: 'batch',
                    args: [
                      [
                        {
                          targetContract: route.tokenA,
                          onBehalfOfAccount: address,
                          value: 0n,
                          data: withdrawTxData,
                        },
                      ],
                    ],
                  });
                  const batchTx = {
                    data: batchTxData,
                    to: this.getEulerV2EVCAddress(),
                    value: '0',
                  };
                  txs.push(batchTx);
                  return txs;
                }
                case LendingProtocolDto.Venus: {
                  const txs: MetaTransactionData[] = [];
                  const amount = BigInt(route.amount);
                  const withdrawTxData = encodeFunctionData({
                    abi: VENUS_V4_VTOKEN_ABI,
                    functionName: 'redeemUnderlying',
                    args: [amount],
                  });
                  const withdrawTx = {
                    data: withdrawTxData,
                    to: route.tokenB,
                    value: '0',
                  };

                  txs.push(withdrawTx);
                  return txs;
                }
              }
            }
            case ActionTypeDto.Borrow: {
              throw new Error('Borrow not supported for Guard');
            }
            case ActionTypeDto.Repay: {
              throw new Error('Repay not supported for Guard');
            }
            case MintActionTypeDto.UniswapV3Mint: {
              const txs: MetaTransactionData[] = [];
              const amount0 = BigInt(route.amount0);
              if (amount0 > 0n) {
                txs.push({
                  data: encodeFunctionData({
                    abi: ERC20_ABI,
                    functionName: 'approve',
                    args: [
                      this.getUniswapV3NonFungiblePositionManagerAddress(),
                      amount0,
                    ],
                  }),
                  to: route.token0,
                  value: '0',
                });
              }
              const amount1 = BigInt(route.amount1);
              if (amount1 > 0n) {
                txs.push({
                  data: encodeFunctionData({
                    abi: ERC20_ABI,
                    functionName: 'approve',
                    args: [
                      this.getUniswapV3NonFungiblePositionManagerAddress(),
                      amount1,
                    ],
                  }),
                  to: route.token1,
                  value: '0',
                });
              }

              const mintTxData = encodeFunctionData({
                abi: UNISWAP_V3_NONFUNGIBLE_POSITION_MANAGER_ABI,
                functionName: 'mint',
                args: [
                  {
                    token0: route.token0,
                    token1: route.token1,
                    fee: route.fee,
                    tickLower: route.tickLower,
                    tickUpper: route.tickUpper,
                    amount0Desired: amount0,
                    amount1Desired: amount1,
                    amount0Min: 0n,
                    amount1Min: 0n,
                    recipient: address,
                    deadline: BigInt(route.deadline),
                  },
                ],
              });
              const mintTx = {
                data: mintTxData,
                to: this.getUniswapV3NonFungiblePositionManagerAddress(),
                value: '0',
              };
              txs.push(mintTx);
              return txs;
            }
            case MintActionTypeDto.AerodromeSlipstreamMint: {
              const txs: MetaTransactionData[] = [];
              const amount0 = BigInt(route.amount0);
              if (amount0 > 0n) {
                txs.push({
                  data: encodeFunctionData({
                    abi: ERC20_ABI,
                    functionName: 'approve',
                    args: [
                      this.getAerodromeCLNonFungiblePositionManagerAddress(),
                      amount0,
                    ],
                  }),
                  to: route.token0,
                  value: '0',
                });
              }
              const amount1 = BigInt(route.amount1);
              if (amount1 > 0n) {
                txs.push({
                  data: encodeFunctionData({
                    abi: ERC20_ABI,
                    functionName: 'approve',
                    args: [
                      this.getAerodromeCLNonFungiblePositionManagerAddress(),
                      amount1,
                    ],
                  }),
                  to: route.token1,
                  value: '0',
                });
              }

              const mintTxData = encodeFunctionData({
                abi: AERODROME_CL_NONFUNGIBLE_POSITION_MANAGER_ABI,
                functionName: 'mint',
                args: [
                  {
                    token0: route.token0,
                    token1: route.token1,
                    tickSpacing: route.tickSpacing,
                    tickLower: route.tickLower,
                    tickUpper: route.tickUpper,
                    amount0Desired: amount0,
                    amount1Desired: amount1,
                    amount0Min: 0n,
                    amount1Min: 0n,
                    recipient: address,
                    deadline: BigInt(route.deadline),
                    sqrtPriceX96: 0n,
                  },
                ],
              });
              const mintTx = {
                data: mintTxData,
                to: this.getAerodromeCLNonFungiblePositionManagerAddress(),
                value: '0',
              };
              txs.push(mintTx);
              return txs;
            }
            case BurnActionTypeDto.UniswapV3Burn: {
              const txs: MetaTransactionData[] = [];
              const decreaseLiquidityTxData = encodeFunctionData({
                abi: UNISWAP_V3_NONFUNGIBLE_POSITION_MANAGER_ABI,
                functionName: 'decreaseLiquidity',
                args: [
                  {
                    tokenId: BigInt(route.tokenId),
                    liquidity: BigInt(route.liquidity),
                    amount0Min: BigInt(route.amount0),
                    amount1Min: BigInt(route.amount1),
                    deadline: BigInt(route.deadline),
                  },
                ],
              });
              const decreaseLiquidityTx = {
                data: decreaseLiquidityTxData,
                to: this.getUniswapV3NonFungiblePositionManagerAddress(),
                value: '0',
              };
              txs.push(decreaseLiquidityTx);
              const collectTxData = encodeFunctionData({
                abi: UNISWAP_V3_NONFUNGIBLE_POSITION_MANAGER_ABI,
                functionName: 'collect',
                args: [
                  {
                    tokenId: BigInt(route.tokenId),
                    recipient: address,
                    amount0Max: maxUint128,
                    amount1Max: maxUint128,
                  },
                ],
              });
              const collectTx = {
                data: collectTxData,
                to: this.getUniswapV3NonFungiblePositionManagerAddress(),
                value: '0',
              };
              txs.push(collectTx);
              return txs;
            }
            case BurnActionTypeDto.AerodromeSlipstreamBurn: {
              const txs: MetaTransactionData[] = [];
              const decreaseLiquidityTxData = encodeFunctionData({
                abi: AERODROME_CL_NONFUNGIBLE_POSITION_MANAGER_ABI,
                functionName: 'decreaseLiquidity',
                args: [
                  {
                    tokenId: BigInt(route.tokenId),
                    liquidity: BigInt(route.liquidity),
                    amount0Min: BigInt(route.amount0),
                    amount1Min: BigInt(route.amount1),
                    deadline: BigInt(route.deadline),
                  },
                ],
              });
              const decreaseLiquidityTx = {
                data: decreaseLiquidityTxData,
                to: this.getAerodromeCLNonFungiblePositionManagerAddress(),
                value: '0',
              };
              txs.push(decreaseLiquidityTx);
              const collectTxData = encodeFunctionData({
                abi: AERODROME_CL_NONFUNGIBLE_POSITION_MANAGER_ABI,
                functionName: 'collect',
                args: [
                  {
                    tokenId: BigInt(route.tokenId),
                    recipient: address,
                    amount0Max: maxUint128,
                    amount1Max: maxUint128,
                  },
                ],
              });
              const collectTx = {
                data: collectTxData,
                to: this.getAerodromeCLNonFungiblePositionManagerAddress(),
                value: '0',
              };
              txs.push(collectTx);
              return txs;
            }
          }
        }),
      )
    ).flat();

    return transactions;
  }

  async buildRebalancePositionParams(
    dto: RebalancePositionDto,
    needSwapData: boolean,
  ): Promise<RebalancePositionParamsDto> {
    const tokens = this.userService.getAllAllowedTokens(this.network);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // 汇总当前总资产（钱包余额 + 借贷供给 + LP 可赎回代币）
    const currentTotalByToken = new Map<string, bigint>();
    const availableByToken = new Map<string, bigint>();

    // 统一的最小精度与归一函数（钱包与借贷一致处理）
    const EFFECTIVE_UNIT_WEI = 10n ** 4n; // 0.01 * 1e18
    const normalizeToEffectiveUnit = (amt: bigint) =>
      amt < EFFECTIVE_UNIT_WEI
        ? 0n
        : (amt / EFFECTIVE_UNIT_WEI) * EFFECTIVE_UNIT_WEI;

    // 1) 钱包余额（与借贷供给一致，按 normalizeToEffectiveUnit 归一处理）
    for (const bal of dto.currentBalances || []) {
      const token = getAddress(bal.token);
      const tokenInfo = tokens.find((t) => t.tokenAddress === token);
      if (!tokenInfo) {
        continue;
      }
      const rawAmt = BigInt(
        new Decimal(bal.amount)
          .mul(10n ** BigInt(tokenInfo.tokenDecimals))
          .floor()
          .toFixed(),
      );
      const amt = normalizeToEffectiveUnit(rawAmt);
      if (amt > 0n) {
        currentTotalByToken.set(
          token,
          (currentTotalByToken.get(token) || 0n) + amt,
        );
        availableByToken.set(token, (availableByToken.get(token) || 0n) + amt);
      }
    }

    // 2) 借贷供给（按 token 汇总总资产；并记录 protocol+token 维度的现有供给）
    const currentSupplyByKey = new Map<string, bigint>();
    for (const pos of dto.currentLendingSupplyPositions || []) {
      const token = getAddress(pos.token);
      const tokenInfo = tokens.find((t) => t.tokenAddress === token);
      if (!tokenInfo) {
        continue;
      }
      const rawAmt = BigInt(
        new Decimal(pos.amount)
          .mul(10n ** BigInt(tokenInfo.tokenDecimals))
          .floor()
          .toString(),
      );
      const amt = normalizeToEffectiveUnit(rawAmt);
      if (amt > 0n) {
        currentTotalByToken.set(
          token,
          (currentTotalByToken.get(token) || 0n) + amt,
        );
      }
      const key = `${pos.protocol}|${token}`;
      if (amt > 0n) {
        currentSupplyByKey.set(key, (currentSupplyByKey.get(key) || 0n) + amt);
      }
    }

    // 3) LP 当前可赎回代币（按每个 current tokenId 计算）
    for (const lp of dto.currentLiquidityPositions || []) {
      const position = await this.getLiquidityPosition(
        lp.protocol,
        BigInt(lp.tokenId),
      );
      const poolAddress = position.poolAddress;
      const poolInfo = await this.getPoolInfo(lp.protocol, poolAddress);
      const { amount0, amount1 } = this.calculateTokenAmounts(
        BigInt(position.liquidity),
        BigInt(poolInfo.sqrtPriceX96),
        position.tickLower,
        position.tickUpper,
        poolInfo.tick,
      );
      currentTotalByToken.set(
        poolInfo.token0,
        (currentTotalByToken.get(poolInfo.token0) || 0n) + amount0,
      );
      currentTotalByToken.set(
        poolInfo.token1,
        (currentTotalByToken.get(poolInfo.token1) || 0n) + amount1,
      );
    }

    // 目标总资产需求
    const targetTotalByToken = new Map<string, bigint>();

    // 4) 目标借贷供给（按 token 汇总总需求；并记录 protocol+token 维度的目标供给）
    const targetSupplyByKey = new Map<string, bigint>();
    for (const pos of dto.targetLendingSupplyPositions || []) {
      const token = pos.token;
      const tokenInfo = tokens.find((t) => t.tokenAddress === token);
      if (!tokenInfo) {
        continue;
      }
      const amt = BigInt(
        new Decimal(pos.amount)
          .mul(10n ** BigInt(tokenInfo.tokenDecimals))
          .floor()
          .toFixed(),
      );
      targetTotalByToken.set(
        token,
        (targetTotalByToken.get(token) || 0n) + amt,
      );
      const key = `${pos.protocol}|${token}`;
      targetSupplyByKey.set(key, (targetSupplyByKey.get(key) || 0n) + amt);
    }

    // 打印 protocol+token 维度的供给现状与目标（便于对账）
    try {
      const serializeMap = (m: Map<string, bigint>) =>
        Array.from(m.entries()).map(([k, v]) => ({
          key: k,
          amount: v.toString(),
        }));
      this.logger.log('Lending supply summary (current vs target)', {
        currentSupplyByKey: serializeMap(currentSupplyByKey),
        targetSupplyByKey: serializeMap(targetSupplyByKey),
      });
    } catch {}

    // 5) 目标 LP 代币需求（按每个目标 LP 的 token0/token1 需求累加）
    type TargetLPInfo = {
      protocol: LPProtocolDto;
      poolId: string;
      token0: Address;
      token1: Address;
      fee: number;
      tickSpacing: number;
      amount0: bigint;
      amount1: bigint;
      tickLower: number;
      tickUpper: number;
    };
    const targetLPs: TargetLPInfo[] = [];

    for (const t of dto.targetLiquidityPositions || []) {
      const poolAddress = t.poolAddress;
      if (!poolAddress) continue;
      const poolInfo = await this.getPoolInfo(t.protocol, poolAddress);
      const token0Info = tokens.find((t) => t.tokenAddress === poolInfo.token0);
      const token1Info = tokens.find((t) => t.tokenAddress === poolInfo.token1);
      if (!token0Info || !token1Info) {
        continue;
      }
      const amount0 = BigInt(
        new Decimal(t.targetAmount0)
          .mul(10n ** BigInt(token0Info.tokenDecimals))
          .floor()
          .toFixed(),
      );
      const amount1 = BigInt(
        new Decimal(t.targetAmount1)
          .mul(10n ** BigInt(token1Info.tokenDecimals))
          .floor()
          .toFixed(),
      );
      targetTotalByToken.set(
        poolInfo.token0,
        (targetTotalByToken.get(poolInfo.token0) || 0n) + amount0,
      );
      targetTotalByToken.set(
        poolInfo.token1,
        (targetTotalByToken.get(poolInfo.token1) || 0n) + amount1,
      );
      targetLPs.push({
        protocol: t.protocol,
        poolId: poolAddress,
        token0: poolInfo.token0,
        token1: poolInfo.token1,
        fee: poolInfo.fee,
        tickSpacing: poolInfo.tickSpacing,
        amount0,
        amount1,
        tickLower: t.targetTickLower,
        tickUpper: t.targetTickUpper,
      });
    }

    const routes: ActionDto[] = [];

    // 顺序一：Burn（优先释放 LP 资金）
    for (const lp of dto.currentLiquidityPositions || []) {
      const [position, poolInfo] = await Promise.all([
        this.getLiquidityPosition(lp.protocol, BigInt(lp.tokenId)),
        this.getPoolInfo(lp.protocol, lp.poolAddress),
      ]);
      const poolId = lp.poolAddress;

      // 估算当前可赎回代币量，并按滑点生成最小值
      const est = this.calculateTokenAmounts(
        BigInt(position.liquidity),
        BigInt(poolInfo.sqrtPriceX96),
        position.tickLower,
        position.tickUpper,
        poolInfo.tick,
      );
      const bps = 100n; // 1%
      const min0 = (est.amount0 * (10000n - bps)) / 10000n;
      const min1 = (est.amount1 * (10000n - bps)) / 10000n;

      // 提前计入可用余额，供后续 mint/supply 使用
      availableByToken.set(
        poolInfo.token0,
        (availableByToken.get(poolInfo.token0) || 0n) + min0,
      );
      availableByToken.set(
        poolInfo.token1,
        (availableByToken.get(poolInfo.token1) || 0n) + min1,
      );

      let actionType;
      switch (lp.protocol) {
        case 'uniswapV3':
          actionType = 'UniswapV3Burn';
          break;
        case 'aerodromeSlipstream':
          actionType = 'AerodromeSlipstreamBurn';
          break;
        default:
          throw new Error(`Unknown protocol: ${lp.protocol}`);
      }
      routes.push({
        actionType,
        poolId,
        tokenId: lp.tokenId,
        amount0: min0.toString(),
        amount1: min1.toString(),
        liquidity: position.liquidity.toString(),
        deadline: deadline.toString(),
      });
    }

    // 顺序二：Withdraw（提取多余借贷供给，按 protocol+token 对比）
    for (const pos of dto.currentLendingSupplyPositions || []) {
      const token = pos.token;
      const tokenInfo = tokens.find((t) => t.tokenAddress === token);
      if (!tokenInfo) {
        continue;
      }
      const currentAmt = normalizeToEffectiveUnit(
        BigInt(
          new Decimal(pos.amount || '0')
            .mul(10n ** BigInt(tokenInfo.tokenDecimals))
            .floor()
            .toString(),
        ),
      );
      const key = `${pos.protocol}|${token}`;
      const targetAmt = targetSupplyByKey.get(key) || 0n; // target 不处理
      if (currentAmt > targetAmt) {
        const withdrawAmount = currentAmt - targetAmt;
        let routeWithdrawAmount = withdrawAmount;

        let tokenA: Address;
        let tokenB: Address;
        switch (pos.protocol) {
          case LendingProtocolDto.Aave: {
            if (new Decimal(routeWithdrawAmount).div(currentAmt).gt(0.99)) {
              routeWithdrawAmount = maxUint256;
            }
            tokenA = token as Address;
            tokenB = '0x0000000000000000000000000000000000000000' as Address;
            break;
          }
          case LendingProtocolDto.Venus: {
            tokenA = token as Address;
            tokenB = '0x0000000000000000000000000000000000000000' as Address;
            break;
          }
          case LendingProtocolDto.Euler: {
            tokenA = token as Address;
            if (!pos.vToken) {
              throw new Error(`Euler vToken not found for token: ${token}`);
            }
            tokenB = pos.vToken as Address;
            break;
          }
        }

        routes.push({
          actionType: ActionTypeDto.Withdraw,
          tokenA,
          tokenB,
          amount: routeWithdrawAmount.toString(),
          data: '0x',
          protocol: pos.protocol,
        });
        availableByToken.set(
          token,
          (availableByToken.get(token) || 0n) + withdrawAmount,
        );
      }
    }

    // 顺序三：根据目标 LP 进行必要的 Swap 以满足 Mint 需求
    const slippage = 0.0005; // 0.05%

    // 计算目标代币需求总量
    const targetTokenAmounts = new Map<string, bigint>();

    // 1) 计算 Supply 目标需求
    for (const pos of dto.targetLendingSupplyPositions || []) {
      const token = pos.token;
      const key = `${pos.protocol}|${token}`;
      const tokenInfo = tokens.find((t) => t.tokenAddress === token);
      if (!tokenInfo) {
        continue;
      }
      const currentAmt = normalizeToEffectiveUnit(
        currentSupplyByKey.get(key) || 0n,
      );
      const targetAmt = BigInt(
        new Decimal(pos.amount || '0')
          .mul(10n ** BigInt(tokenInfo.tokenDecimals))
          .floor()
          .toString(),
      );
      if (targetAmt > currentAmt) {
        const supplyNeed = targetAmt - currentAmt;
        targetTokenAmounts.set(
          token,
          (targetTokenAmounts.get(token) || 0n) + supplyNeed,
        );
      }
    }

    // 2) 计算 Mint 目标需求
    for (const t of targetLPs) {
      targetTokenAmounts.set(
        t.token0,
        (targetTokenAmounts.get(t.token0) || 0n) + t.amount0,
      );
      targetTokenAmounts.set(
        t.token1,
        (targetTokenAmounts.get(t.token1) || 0n) + t.amount1,
      );
    }

    const ensureToken = async (toToken: Address, need: bigint) => {
      if (need <= 0n) return;

      // 检查目标代币是否已有足够余额
      const toKey = toToken;
      const currentToBalance = availableByToken.get(toKey) || 0n;
      const targetAmount = targetTokenAmounts.get(toKey) || 0n;

      // 只允许使用超过目标数量的部分进行 swap
      const availableTo =
        currentToBalance > targetAmount ? currentToBalance - targetAmount : 0n;

      if (availableTo >= need) {
        // 已有足够余额，无需 Swap
        return;
      }

      let remaining = need - availableTo;
      for (const [haveToken, haveAmount] of Array.from(
        availableByToken.entries(),
      )) {
        if (remaining === 0n) break;
        if (haveAmount === 0n) continue;
        if (haveToken === toKey) continue;

        // 只允许 swap 超过目标数量的部分
        const haveTargetAmount = targetTokenAmounts.get(haveToken) || 0n;
        const availableForSwap =
          haveAmount > haveTargetAmount ? haveAmount - haveTargetAmount : 0n;
        if (availableForSwap === 0n) continue;

        const swapIn =
          availableForSwap >= remaining ? remaining : availableForSwap;
        const fromToken = `0x${haveToken.replace(/^0x/, '')}` as Address;

        const swapResult = await this.kyberSwapClient.getSwapRouteV1(
          dto.network,
          fromToken,
          swapIn,
          toToken,
        );

        let swapResultData;
        if (needSwapData) {
          swapResultData = await this.kyberSwapClient.postSwapRouteV1(
            dto.safeAddress,
            dto.network,
            slippage,
            swapResult,
          );
        }

        routes.push({
          actionType: ActionTypeDto.Swap,
          tokenA: fromToken,
          tokenB: toToken,
          amount: swapIn.toString(),
          estimatedOutput: swapResult.routeSummary.amountOut,
          data: swapResultData?.data || '0x',
          routerAddress: swapResult.routerAddress,
          tokenApprovalAddress:
            swapResult.approveTarget || swapResult.routerAddress,
          protocol: LendingProtocolDto.Aave,
        });

        availableByToken.set(
          haveToken,
          (availableByToken.get(haveToken) || 0n) - swapIn,
        );
        // minEstimatedOut = estimatedOutput * (1 - slippage%)
        const slippageFactor = new Decimal(1).minus(
          new Decimal(slippage).div(100),
        );
        const minEstimatedOut = BigInt(
          new Decimal(swapResult.routeSummary.amountOut.toString())
            .mul(slippageFactor)
            .toFixed(0, Decimal.ROUND_FLOOR),
        );
        availableByToken.set(
          toKey,
          (availableByToken.get(toKey) || 0n) + minEstimatedOut,
        );
        remaining -= swapIn;
      }
    };

    // 顺序四：统一为所有目标代币准备余额
    // 计算每个代币的总需求缺口
    const tokenNeeds = new Map<string, bigint>();

    // 1) 计算 Supply 需求缺口
    for (const pos of dto.targetLendingSupplyPositions || []) {
      const token = pos.token;
      const key = `${pos.protocol}|${token}`;
      const currentAmt = normalizeToEffectiveUnit(
        currentSupplyByKey.get(key) || 0n,
      );
      const tokenInfo = tokens.find((t) => t.tokenAddress === token);
      if (!tokenInfo) {
        continue;
      }
      const targetAmt = BigInt(
        new Decimal(pos.amount || '0')
          .mul(10n ** BigInt(tokenInfo.tokenDecimals))
          .floor()
          .toString(),
      );
      if (targetAmt > currentAmt) {
        const supplyNeed = targetAmt - currentAmt;
        tokenNeeds.set(token, (tokenNeeds.get(token) || 0n) + supplyNeed);
      }
    }

    // 2) 计算 Mint 需求缺口
    for (const t of targetLPs) {
      const need0 = t.amount0 - (availableByToken.get(t.token0) || 0n);
      const need1 = t.amount1 - (availableByToken.get(t.token1) || 0n);

      if (need0 > 0n) {
        tokenNeeds.set(t.token0, (tokenNeeds.get(t.token0) || 0n) + need0);
      }
      if (need1 > 0n) {
        tokenNeeds.set(t.token1, (tokenNeeds.get(t.token1) || 0n) + need1);
      }
    }

    // 3) 统一处理所有代币需求
    for (const [token, need] of tokenNeeds.entries()) {
      if (need > 0n) {
        await ensureToken(`0x${token.replace(/^0x/, '')}` as Address, need);
      }
    }

    // 顺序五：按目标 LP 追加 Mint（若凑不齐则按可用余额截断）
    for (const t of targetLPs) {
      const token0 = t.token0;
      const token1 = t.token1;
      const available0 = availableByToken.get(token0) || 0n;
      const available1 = availableByToken.get(token1) || 0n;
      const amount0Use = t.amount0 > available0 ? available0 : t.amount0;
      const amount1Use = t.amount1 > available1 ? available1 : t.amount1;

      if (amount0Use === 0n && amount1Use === 0n) {
        // 没有可用资金，跳过该 Mint
        continue;
      }

      let actionType;
      switch (t.protocol) {
        case LPProtocolDto.UniswapV3:
          actionType = MintActionTypeDto.UniswapV3Mint;
          break;
        case LPProtocolDto.AerodromeSLipstream:
          actionType = MintActionTypeDto.AerodromeSlipstreamMint;
          break;
      }

      routes.push({
        actionType,
        token0: token0,
        token1: token1,
        fee: t.fee,
        tickSpacing: t.tickSpacing,
        poolId: t.poolId,
        tickLower: t.tickLower,
        tickUpper: t.tickUpper,
        amount0: amount0Use.toString(),
        amount1: amount1Use.toString(),
        deadline: deadline.toString(),
      });

      // 扣减已使用余额
      availableByToken.set(
        token0,
        (availableByToken.get(token0) || 0n) - amount0Use,
      );
      availableByToken.set(
        token1,
        (availableByToken.get(token1) || 0n) - amount1Use,
      );
    }

    // 顺序六：Supply（补足目标借贷供给，按 protocol+token 对比）
    for (const pos of dto.targetLendingSupplyPositions || []) {
      const token = pos.token;
      const tokenInfo = tokens.find((t) => t.tokenAddress === token);
      if (!tokenInfo) {
        continue;
      }
      const key = `${pos.protocol}|${token}`;
      const currentAmt = normalizeToEffectiveUnit(
        currentSupplyByKey.get(key) || 0n,
      );
      const targetAmt = BigInt(
        new Decimal(pos.amount || '0')
          .mul(10n ** BigInt(tokenInfo.tokenDecimals))
          .floor()
          .toString(),
      );
      if (targetAmt > currentAmt) {
        const required = targetAmt - currentAmt;
        const token = pos.token.toLowerCase();
        const available = availableByToken.get(token) || 0n;
        const supplyAmount = required > available ? available : required;
        if (supplyAmount === 0n) continue;
        let tokenA: Address;
        let tokenB: Address;
        switch (pos.protocol) {
          case LendingProtocolDto.Aave:
          case LendingProtocolDto.Venus:
            tokenA = token as Address;
            tokenB = '0x0000000000000000000000000000000000000000' as Address;
            break;
          case LendingProtocolDto.Euler:
            tokenA = token as Address;
            if (!pos.vToken) {
              throw new Error(`Euler vToken not found for token: ${token}`);
            }
            tokenB = pos.vToken as Address;
            break;
        }

        routes.push({
          actionType: ActionTypeDto.Supply,
          tokenA,
          tokenB,
          amount: supplyAmount.toString(),
          data: encodeAbiParameters(parseAbiParameters('uint256'), [2n]),
          protocol: pos.protocol,
        });
        availableByToken.set(
          token,
          (availableByToken.get(token) || 0n) - supplyAmount,
        );
      }
    }

    return {
      safe: dto.safeAddress as Address,
      routes,
    };
  }

  async getLiquidityPosition(
    protocol: LPProtocolDto,
    tokenId: bigint,
  ): Promise<
    | AerodromeCLLiquidityPositionResponseDto
    | UniswapV3LiquidityPositionResponseDto
  > {
    switch (protocol) {
      case LPProtocolDto.AerodromeSLipstream: {
        const position = await this.aerodromeCLService.getLiquidityPosition(
          this.network,
          tokenId,
        );
        if (!position) {
          throw new Error(
            `Aerodrome CL not supported for network: ${this.network}`,
          );
        }
        return position;
      }
      case LPProtocolDto.UniswapV3: {
        const position = await this.uniswapV3Service.getLiquidityPosition(
          this.network,
          tokenId,
        );
        if (!position) {
          throw new Error(
            `Uniswap v3 not supported for network: ${this.network}`,
          );
        }
        return position;
      }
    }
  }

  async getPoolInfo(
    protocol: LPProtocolDto,
    poolAddress: string,
  ): Promise<AerodromeCLPoolInfoResponseDto | UniswapV3PoolInfoResponseDto> {
    switch (protocol) {
      case LPProtocolDto.AerodromeSLipstream: {
        const poolInfo = await this.aerodromeCLService.getPoolInfo(
          this.network,
          poolAddress,
        );
        if (!poolInfo) {
          throw new Error(
            `Aerodrome CL not supported for network: ${this.network}`,
          );
        }
        return poolInfo;
      }
      case LPProtocolDto.UniswapV3: {
        const poolInfo = await this.uniswapV3Service.getPoolInfo(
          this.network,
          poolAddress,
        );
        if (!poolInfo) {
          throw new Error(
            `Uniswap v3 not supported for network: ${this.network}`,
          );
        }
        return poolInfo;
      }
    }
  }

  private calculateTokenAmounts(
    liquidity: bigint,
    sqrtPriceX96: bigint,
    tickLower: number,
    tickUpper: number,
    currentTick: number,
  ): { amount0: bigint; amount1: bigint } {
    const Q96 = BigInt(2) ** BigInt(96);

    // Calculate sqrt prices from ticks
    const getSqrtPriceFromTick = (tick: number): bigint => {
      const sqrtPrice = Math.sqrt(1.0001 ** tick);
      return BigInt(Math.floor(sqrtPrice * Number(Q96)));
    };

    const sqrtPriceAX96 = getSqrtPriceFromTick(tickLower);
    const sqrtPriceBX96 = getSqrtPriceFromTick(tickUpper);

    let amount0 = 0n;
    let amount1 = 0n;

    if (currentTick < tickLower) {
      // Current price is below range - all in token0
      amount0 =
        (liquidity * Q96 * (sqrtPriceBX96 - sqrtPriceAX96)) /
        (sqrtPriceBX96 * sqrtPriceAX96);
      amount1 = 0n;
    } else if (currentTick >= tickUpper) {
      // Current price is above range - all in token1
      amount0 = 0n;
      amount1 = (liquidity * (sqrtPriceBX96 - sqrtPriceAX96)) / Q96;
    } else {
      // Current price is in range
      amount0 =
        (liquidity * Q96 * (sqrtPriceBX96 - sqrtPriceX96)) /
        (sqrtPriceBX96 * sqrtPriceX96);
      amount1 = (liquidity * (sqrtPriceX96 - sqrtPriceAX96)) / Q96;
    }

    return { amount0, amount1 };
  }

  async executeRebalancePosition(
    dto: RebalancePositionDto,
  ): Promise<ExecuteRebalancePositionResponseDto> {
    const execParams = await this.buildRebalancePositionParams(dto, true);
    const { safe, wrappedTransaction, operator } =
      await this.userService.getDeploymentSignedTransaction(
        dto.network,
        dto.safeAddress,
      );

    const transactions: MetaTransactionData[] = [];

    let nonce: number | undefined;

    if (wrappedTransaction) {
      nonce = 1;
      transactions.push(wrappedTransaction);
    }

    const rebalanceTxsData = await this.buildTransactions(
      dto.safeAddress,
      execParams,
    );

    const rebalanceSafeTx = await safe.createTransaction({
      transactions: rebalanceTxsData,
      onlyCalls: false,
      options: {
        nonce,
      },
    });

    const signature = await this.#walletClient.signTypedData({
      ...(await this.userService.getTypedData(
        dto.safeAddress,
        safe,
        rebalanceSafeTx,
      )),
      account: this.#account,
    });
    const contractSignature = await buildContractSignature(
      [new EthSafeSignature(operator, signature)],
      operator,
    );

    rebalanceSafeTx.addSignature(contractSignature);
    const rebalanceTx = {
      to: dto.safeAddress,
      data: await safe.getEncodedTransaction(rebalanceSafeTx),
      value: '0',
    };

    transactions.push(rebalanceTx);

    let txHash: string;
    if (wrappedTransaction) {
      const batchTx = await safe.createTransactionBatch(transactions);
      txHash = await this.#walletClient.sendTransaction({
        to: batchTx.to,
        data: batchTx.data as `0x${string}`,
        value: BigInt(batchTx.value),
        chain: this.#chain,
        account: this.#account,
      });
    } else {
      txHash = await this.#walletClient.sendTransaction({
        to: rebalanceTx.to,
        data: rebalanceTx.data as `0x${string}`,
        value: BigInt(rebalanceTx.value),
        chain: this.#chain,
        account: this.#account,
      });
    }

    return {
      txHash,
    };
  }
}
