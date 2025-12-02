import { Injectable, Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import { getRpcUrl } from '../config/rpc.config';
import { lookupTokenSymbol, lookupTokenDecimals } from '../agent/token-utils';
import {
  RebalanceAction,
  RebalanceActionType,
  Protocol,
  TokenAmount,
  ParsedTransaction,
  EventSignature,
  PositionTrackingSummary,
  LendingPositionSummary,
} from './types/transaction-parser.types';
import {
  trackPositionFlows,
  formatPositionTracking,
  trackLendingPositions,
  formatLendingPositions,
} from './position-tracker';

@Injectable()
export class TransactionParserService {
  private readonly logger = new Logger(TransactionParserService.name);

  // Event signatures for different protocols
  // NOTE: Use full ABI definitions with 'indexed' keywords for accurate parsing
  private readonly EVENT_SIGNATURES: EventSignature[] = [
    // Uniswap V3 NonfungiblePositionManager
    // topic0: 0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f
    {
      name: 'IncreaseLiquidity',
      signature: 'IncreaseLiquidity(uint256 indexed tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)',
      protocol: Protocol.UNISWAP_V3,
      actionType: RebalanceActionType.ADD_LIQUIDITY,
      abi: {
        anonymous: false,
        inputs: [
          { indexed: true, name: 'tokenId', type: 'uint256' },
          { indexed: false, name: 'liquidity', type: 'uint128' },
          { indexed: false, name: 'amount0', type: 'uint256' },
          { indexed: false, name: 'amount1', type: 'uint256' },
        ],
        name: 'IncreaseLiquidity',
        type: 'event',
      },
    },
    // topic0: 0x26f6a048ee9138f2c0ce266f322cb99228e8d619ae2bff30c67f8dcf9d2377b4
    {
      name: 'DecreaseLiquidity',
      signature: 'DecreaseLiquidity(uint256 indexed tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)',
      protocol: Protocol.UNISWAP_V3,
      actionType: RebalanceActionType.REMOVE_LIQUIDITY,
      abi: {
        anonymous: false,
        inputs: [
          { indexed: true, name: 'tokenId', type: 'uint256' },
          { indexed: false, name: 'liquidity', type: 'uint128' },
          { indexed: false, name: 'amount0', type: 'uint256' },
          { indexed: false, name: 'amount1', type: 'uint256' },
        ],
        name: 'DecreaseLiquidity',
        type: 'event',
      },
    },

    // Uniswap V3 Pool events (direct pool interaction)
    // topic0: 0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c
    {
      name: 'Burn',
      signature: 'Burn(address indexed owner,int24 indexed tickLower,int24 indexed tickUpper,uint128 amount,uint256 amount0,uint256 amount1)',
      protocol: Protocol.UNISWAP_V3,
      actionType: RebalanceActionType.POOL_BURN,
      abi: {
        anonymous: false,
        inputs: [
          { indexed: true, name: 'owner', type: 'address' },
          { indexed: true, name: 'tickLower', type: 'int24' },
          { indexed: true, name: 'tickUpper', type: 'int24' },
          { indexed: false, name: 'amount', type: 'uint128' },
          { indexed: false, name: 'amount0', type: 'uint256' },
          { indexed: false, name: 'amount1', type: 'uint256' },
        ],
        name: 'Burn',
        type: 'event',
      },
    },
    {
      name: 'Mint',
      signature: 'Mint(address sender,address indexed owner,int24 indexed tickLower,int24 indexed tickUpper,uint128 amount,uint256 amount0,uint256 amount1)',
      protocol: Protocol.UNISWAP_V3,
      actionType: RebalanceActionType.POOL_MINT,
      abi: {
        anonymous: false,
        inputs: [
          { indexed: false, name: 'sender', type: 'address' },
          { indexed: true, name: 'owner', type: 'address' },
          { indexed: true, name: 'tickLower', type: 'int24' },
          { indexed: true, name: 'tickUpper', type: 'int24' },
          { indexed: false, name: 'amount', type: 'uint128' },
          { indexed: false, name: 'amount0', type: 'uint256' },
          { indexed: false, name: 'amount1', type: 'uint256' },
        ],
        name: 'Mint',
        type: 'event',
      },
    },
    // topic0: 0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0
    {
      name: 'Collect',
      signature: 'Collect(address indexed owner,address recipient,int24 indexed tickLower,int24 indexed tickUpper,uint128 amount0,uint128 amount1)',
      protocol: Protocol.UNISWAP_V3,
      actionType: RebalanceActionType.POOL_COLLECT,
      abi: {
        anonymous: false,
        inputs: [
          { indexed: true, name: 'owner', type: 'address' },
          { indexed: false, name: 'recipient', type: 'address' },
          { indexed: true, name: 'tickLower', type: 'int24' },
          { indexed: true, name: 'tickUpper', type: 'int24' },
          { indexed: false, name: 'amount0', type: 'uint128' },
          { indexed: false, name: 'amount1', type: 'uint128' },
        ],
        name: 'Collect',
        type: 'event',
      },
    },

    // OKX Router Swap
    {
      name: 'OrderRecord',
      signature: 'OrderRecord(address,address,address,uint256,uint256)',
      protocol: Protocol.OKX_ROUTER,
      actionType: RebalanceActionType.SWAP,
      abi: {
        anonymous: false,
        inputs: [
          { indexed: false, name: 'fromToken', type: 'address' },
          { indexed: false, name: 'toToken', type: 'address' },
          { indexed: false, name: 'sender', type: 'address' },
          { indexed: false, name: 'fromAmount', type: 'uint256' },
          { indexed: false, name: 'returnAmount', type: 'uint256' },
        ],
        name: 'OrderRecord',
        type: 'event',
      },
    },

    // KyberSwap Meta Aggregation RouterV2 Swap
    {
      name: 'Swapped',
      signature: 'Swapped(address,address,address,address,uint256,uint256)',
      protocol: Protocol.KYBERSWAP_ROUTER,
      actionType: RebalanceActionType.SWAP,
      abi: {
        anonymous: false,
        inputs: [
          { indexed: false, name: 'sender', type: 'address' },
          { indexed: false, name: 'srcToken', type: 'address' },
          { indexed: false, name: 'dstToken', type: 'address' },
          { indexed: false, name: 'dstReceiver', type: 'address' },
          { indexed: false, name: 'spentAmount', type: 'uint256' },
          { indexed: false, name: 'returnAmount', type: 'uint256' },
        ],
        name: 'Swapped',
        type: 'event',
      },
    },

    // Aave
    {
      name: 'Supply',
      signature: 'Supply(address indexed reserve,address user,address indexed onBehalfOf,uint256 amount,uint16 indexed referralCode)',
      protocol: Protocol.AAVE,
      actionType: RebalanceActionType.SUPPLY,
      abi: {
        anonymous: false,
        inputs: [
          { indexed: true, name: 'reserve', type: 'address' },
          { indexed: false, name: 'user', type: 'address' },
          { indexed: true, name: 'onBehalfOf', type: 'address' },
          { indexed: false, name: 'amount', type: 'uint256' },
          { indexed: true, name: 'referralCode', type: 'uint16' },
        ],
        name: 'Supply',
        type: 'event',
      },
    },
    {
      name: 'Withdraw',
      signature: 'Withdraw(address indexed reserve,address indexed user,address indexed to,uint256 amount)',
      protocol: Protocol.AAVE,
      actionType: RebalanceActionType.WITHDRAW,
      abi: {
        anonymous: false,
        inputs: [
          { indexed: true, name: 'reserve', type: 'address' },
          { indexed: true, name: 'user', type: 'address' },
          { indexed: true, name: 'to', type: 'address' },
          { indexed: false, name: 'amount', type: 'uint256' },
        ],
        name: 'Withdraw',
        type: 'event',
      },
    },
    {
      name: 'Borrow',
      signature: 'Borrow(address indexed reserve,address user,address indexed onBehalfOf,uint256 amount,uint256 borrowRateMode,uint256 borrowRate,uint16 indexed referralCode)',
      protocol: Protocol.AAVE,
      actionType: RebalanceActionType.BORROW,
      abi: {
        anonymous: false,
        inputs: [
          { indexed: true, name: 'reserve', type: 'address' },
          { indexed: false, name: 'user', type: 'address' },
          { indexed: true, name: 'onBehalfOf', type: 'address' },
          { indexed: false, name: 'amount', type: 'uint256' },
          { indexed: false, name: 'borrowRateMode', type: 'uint256' },
          { indexed: false, name: 'borrowRate', type: 'uint256' },
          { indexed: true, name: 'referralCode', type: 'uint16' },
        ],
        name: 'Borrow',
        type: 'event',
      },
    },
    {
      name: 'Repay',
      signature: 'Repay(address indexed reserve,address indexed user,address indexed repayer,uint256 amount,bool useATokens)',
      protocol: Protocol.AAVE,
      actionType: RebalanceActionType.REPAY,
      abi: {
        anonymous: false,
        inputs: [
          { indexed: true, name: 'reserve', type: 'address' },
          { indexed: true, name: 'user', type: 'address' },
          { indexed: true, name: 'repayer', type: 'address' },
          { indexed: false, name: 'amount', type: 'uint256' },
          { indexed: false, name: 'useATokens', type: 'bool' },
        ],
        name: 'Repay',
        type: 'event',
      },
    },
    // Euler
    {
      name: 'Deposit',
      signature: 'Deposit(address indexed sender,address indexed owner,uint256 assets,uint256 shares)',
      protocol: Protocol.EULER,
      actionType: RebalanceActionType.SUPPLY,
      abi: {
        anonymous: false,
        inputs: [
          { indexed: true, name: 'sender', type: 'address' },
          { indexed: true, name: 'owner', type: 'address' },
          { indexed: false, name: 'assets', type: 'uint256' },
          { indexed: false, name: 'shares', type: 'uint256' },
        ],
        name: 'Deposit',
        type: 'event',
      },
    },
    {
      name: 'Withdraw',
      signature: 'Withdraw(address indexed sender,address indexed receiver,address indexed owner,uint256 assets,uint256 shares)',
      protocol: Protocol.EULER,
      actionType: RebalanceActionType.WITHDRAW,
      abi: {
        anonymous: false,
        inputs: [
          { indexed: true, name: 'sender', type: 'address' },
          { indexed: true, name: 'receiver', type: 'address' },
          { indexed: true, name: 'owner', type: 'address' },
          { indexed: false, name: 'assets', type: 'uint256' },
          { indexed: false, name: 'shares', type: 'uint256' },
        ],
        name: 'Withdraw',
        type: 'event',
      },
    },
    // Venus
    {
      name: 'Mint',
      signature: 'Mint(address minter,uint256 mintAmount,uint256 mintTokens)',
      protocol: Protocol.VENUS,
      actionType: RebalanceActionType.SUPPLY,
      abi: {
        anonymous: false,
        inputs: [
          { indexed: false, name: 'minter', type: 'address' },
          { indexed: false, name: 'mintAmount', type: 'uint256' },
          { indexed: false, name: 'mintTokens', type: 'uint256' },
        ],
        name: 'Mint',
        type: 'event',
      },
    },
    {
      name: 'Redeem',
      signature: 'Redeem(address redeemer,uint256 redeemAmount,uint256 redeemTokens)',
      protocol: Protocol.VENUS,
      actionType: RebalanceActionType.WITHDRAW,
      abi: {
        anonymous: false,
        inputs: [
          { indexed: false, name: 'redeemer', type: 'address' },
          { indexed: false, name: 'redeemAmount', type: 'uint256' },
          { indexed: false, name: 'redeemTokens', type: 'uint256' },
        ],
        name: 'Redeem',
        type: 'event',
      },
    },
    {
      name: 'Borrow',
      signature: 'Borrow(address borrower,uint256 borrowAmount,uint256 accountBorrows,uint256 totalBorrows)',
      protocol: Protocol.VENUS,
      actionType: RebalanceActionType.BORROW,
      abi: {
        anonymous: false,
        inputs: [
          { indexed: false, name: 'borrower', type: 'address' },
          { indexed: false, name: 'borrowAmount', type: 'uint256' },
          { indexed: false, name: 'accountBorrows', type: 'uint256' },
          { indexed: false, name: 'totalBorrows', type: 'uint256' },
        ],
        name: 'Borrow',
        type: 'event',
      },
    },
    {
      name: 'RepayBorrow',
      signature: 'RepayBorrow(address payer,address borrower,uint256 repayAmount,uint256 accountBorrows,uint256 totalBorrows)',
      protocol: Protocol.VENUS,
      actionType: RebalanceActionType.REPAY,
      abi: {
        anonymous: false,
        inputs: [
          { indexed: false, name: 'payer', type: 'address' },
          { indexed: false, name: 'borrower', type: 'address' },
          { indexed: false, name: 'repayAmount', type: 'uint256' },
          { indexed: false, name: 'accountBorrows', type: 'uint256' },
          { indexed: false, name: 'totalBorrows', type: 'uint256' },
        ],
        name: 'RepayBorrow',
        type: 'event',
      },
    },
  ];

  // Generate topic0 from event signatures (using ABI if available)
  private readonly EVENT_TOPICS: Map<string, EventSignature> = new Map(
    this.EVENT_SIGNATURES.map((sig) => {
      // If ABI is provided, use it to calculate the correct topic0
      let topic0: string;
      if (sig.abi) {
        const iface = new ethers.Interface([sig.abi]);
        const fragment = iface.getEvent(sig.name);
        topic0 = fragment!.topicHash;
      } else {
        // Fallback to signature string
        topic0 = ethers.id(sig.signature);
      }
      return [topic0, sig];
    }),
  );

  private readonly poolTokenCache = new Map<string, { token0: string; token1: string }>();

  /**
   * Parse a rebalance transaction by hash
   * @param txHash Transaction hash
   * @param chainId Chain ID (optional, defaults to '8453' for Base)
   */
  async parseTransaction(txHash: string, chainId: string = '8453'): Promise<ParsedTransaction> {
    try {
      this.logger.log(`Parsing transaction ${txHash} on chain ${chainId}`);

      // Get RPC URL
      const rpcUrl = getRpcUrl(chainId);
      if (!rpcUrl) {
        throw new Error(`No RPC URL configured for chain ${chainId}`);
      }

      // Create provider
      const provider = new ethers.JsonRpcProvider(rpcUrl);

      // Fetch transaction receipt
      const receipt = await provider.getTransactionReceipt(txHash);
      if (!receipt) {
        throw new Error(`Transaction ${txHash} not found`);
      }

      // Get block to extract timestamp
      const block = await provider.getBlock(receipt.blockNumber);
      const timestamp = block?.timestamp;

      this.logger.log(`Found ${receipt.logs.length} logs in transaction`);

      // Parse logs to extract rebalance actions
      const actions: RebalanceAction[] = [];
      const allLogs = receipt.logs;

      for (let i = 0; i < allLogs.length; i++) {
        const log = allLogs[i];
        const action = await this.parseLog(log, i, provider, allLogs);
        if (action) {
          actions.push(action);
        }
      }

      this.logger.log(`Parsed ${actions.length} rebalance actions from transaction`);

      // Enrich tokens with symbol and formatted amounts
      const enrichedActions = actions.map(action => ({
        ...action,
        tokens: action.tokens.map(token => this.enrichToken(token, chainId)),
      }));

      // Log detailed rebalance path for AI agent
      this.logRebalancePath(enrichedActions);

      return {
        transactionHash: txHash,
        blockNumber: receipt.blockNumber,
        timestamp,
        actions: enrichedActions,
        rawLogs: receipt.logs.map((log) => ({
          address: log.address,
          topics: log.topics,
          data: log.data,
          index: log.index,
        })),
      };
    } catch (error) {
      this.logger.error(`Error parsing transaction ${txHash}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Parse a single log entry
   */
  private async parseLog(
    log: ethers.Log,
    eventIndex: number,
    provider: ethers.Provider,
    allLogs: readonly ethers.Log[],
  ): Promise<RebalanceAction | null> {
    const topic0 = log.topics[0];
    const eventSig = this.EVENT_TOPICS.get(topic0);

    if (!eventSig) {
      // Unknown event, skip
      return null;
    }

    this.logger.debug(`Parsing ${eventSig.name} event from ${eventSig.protocol}`);

    try {
      const action = await this.parseEventByType(log, eventSig, eventIndex, provider, allLogs);
      return action;
    } catch (error) {
      this.logger.warn(`Failed to parse ${eventSig.name} event: ${error.message}`);
      return null;
    }
  }

  /**
   * Parse event based on type
   */
  private async parseEventByType(
    log: ethers.Log,
    eventSig: EventSignature,
    eventIndex: number,
    provider: ethers.Provider,
    allLogs: readonly ethers.Log[],
  ): Promise<RebalanceAction | null> {
    // For events with indexed parameters that don't match the signature,
    // we need to manually decode or use flexible decoding
    let decoded: ethers.LogDescription | null = null;

    // Use ABI if available, otherwise fallback to signature string
    const abiDef = eventSig.abi || `event ${eventSig.signature}`;
    const iface = new ethers.Interface([abiDef]);
    decoded = iface.parseLog({
      topics: log.topics as string[],
      data: log.data,
    });

    if (!decoded) {
      return null;
    }

    let tokens: TokenAmount[] = [];
    let metadata: Record<string, any> = {};
    let tokenId: string | undefined;
    let tickLower: number | undefined;
    let tickUpper: number | undefined;

    // Parse based on action type and protocol
    switch (eventSig.actionType) {
      case RebalanceActionType.ADD_LIQUIDITY:
      case RebalanceActionType.REMOVE_LIQUIDITY:
      case RebalanceActionType.POOL_MINT:
      case RebalanceActionType.POOL_BURN:
      case RebalanceActionType.POOL_COLLECT: {
        const result = await this.parseLiquidityEvent(log, decoded, eventSig, provider, allLogs, eventIndex);
        tokens = result.tokens;
        tokenId = result.tokenId;
        tickLower = result.tickLower;
        tickUpper = result.tickUpper;
        break;
      }

      case RebalanceActionType.SWAP:
        tokens = await this.parseSwapEvent(log, decoded, eventSig, provider);
        break;

      case RebalanceActionType.SUPPLY:
      case RebalanceActionType.WITHDRAW:
      case RebalanceActionType.BORROW:
      case RebalanceActionType.REPAY:
        tokens = await this.parseLendingEvent(log, decoded, eventSig, provider);
        break;

      default:
        this.logger.warn(`Unknown action type: ${eventSig.actionType}`);
        return null;
    }

    return {
      type: eventSig.actionType,
      protocol: eventSig.protocol,
      tokens,
      metadata,
      eventIndex,
      logIndex: log.index,
      tokenId,
      contractAddress: log.address, // Contract that emitted the event
      tickLower,
      tickUpper,
    };
  }

  /**
   * Get token symbol and decimals from token-utils
   */
  private getTokenInfo(tokenAddress: string, chainId: string): { symbol?: string; decimals?: number } {
    const symbol = lookupTokenSymbol(tokenAddress, chainId);
    const decimals = symbol ? lookupTokenDecimals(symbol, chainId) : null;

    return {
      symbol: symbol || undefined,
      decimals: decimals || undefined,
    };
  }

  /**
   * Format amount with decimals
   */
  private formatAmount(amount: string, decimals?: number): string | undefined {
    if (!decimals) return undefined;
    try {
      return ethers.formatUnits(amount, decimals);
    } catch {
      return undefined;
    }
  }

  /**
   * Log detailed rebalance path for AI agent to understand the transaction flow
   * Groups related actions (e.g., POOL_BURN + REMOVE_LIQUIDITY + POOL_COLLECT)
   */
  private logRebalancePath(actions: RebalanceAction[]): void {
    if (actions.length === 0) return;

    this.logger.log('=== REBALANCE PATH ===');

    let stepNumber = 1;
    let i = 0;

    while (i < actions.length) {
      const action = actions[i];

      // Check if this is a remove liquidity group (POOL_BURN + REMOVE_LIQUIDITY + [POOL_COLLECT])
      if (action.type === RebalanceActionType.POOL_BURN && i + 1 < actions.length) {
        const nextAction = actions[i + 1];
        if (nextAction.type === RebalanceActionType.REMOVE_LIQUIDITY) {
          // Check if there's a POOL_COLLECT after
          const collectAction = i + 2 < actions.length && actions[i + 2].type === RebalanceActionType.POOL_COLLECT
            ? actions[i + 2]
            : null;

          const tokenId = action.tokenId || nextAction.tokenId;
          const tokenIdStr = tokenId ? ` (tokenId: ${tokenId})` : '';

          if (collectAction) {
            // Calculate actual fees: POOL_COLLECT amount - POOL_BURN amount
            const collectTokens = collectAction.tokens;
            const burnTokens = action.tokens;

            const liquidityParts: string[] = [];
            const feeParts: string[] = [];
            const totalParts: string[] = [];

            collectTokens.forEach((collectToken, idx) => {
              const burnToken = burnTokens[idx];
              const collectAmount = parseFloat(collectToken.amountFormatted || '0');
              const burnAmount = parseFloat(burnToken?.amountFormatted || '0');
              const feeAmount = collectAmount - burnAmount;

              const symbol = collectToken.symbol || 'TOKEN';

              // Liquidity amount (from POOL_BURN)
              liquidityParts.push(`${this.formatTokenAmount(burnToken?.amountFormatted || '0')} ${symbol}`);

              // Fee amount
              if (feeAmount > 0.000001) {
                feeParts.push(`${this.formatTokenAmount(feeAmount.toString())} ${symbol}`);
              } else {
                feeParts.push(`0 ${symbol}`);
              }

              // Total amount (from POOL_COLLECT)
              totalParts.push(`${this.formatTokenAmount(collectToken.amountFormatted || '0')} ${symbol}`);
            });

            const liquidityStr = liquidityParts.join(' + ');
            const feeStr = feeParts.join(' + ');
            const totalStr = totalParts.join(' + ');

            // Build pool name from token symbols
            const poolSymbols = collectTokens.map(t => t.symbol || 'TOKEN');
            const poolName = poolSymbols.length >= 2 ? `${poolSymbols[0]}/${poolSymbols[1]}` : poolSymbols.join('/');

            // Add tick range info if available
            const tickInfo = (action.tickLower !== undefined && action.tickUpper !== undefined)
              ? ` at ticks [${action.tickLower}, ${action.tickUpper}]`
              : '';

            this.logger.log(
              `Step ${stepNumber}: Remove liquidity from ${this.formatProtocolName(action.protocol)} ${poolName}${tokenIdStr}${tickInfo} - ` +
              `Liquidity: ${liquidityStr}, Fee: ${feeStr}, Total: ${totalStr}`
            );

            i += 3; // Skip POOL_BURN, REMOVE_LIQUIDITY, and POOL_COLLECT
          } else {
            const burnTokens = action.tokens
              .map(t => `${this.formatTokenAmount(t.amountFormatted)} ${t.symbol || 'TOKEN'}`)
              .join(' + ');
            this.logger.log(
              `Step ${stepNumber}: Remove liquidity from ${this.formatProtocolName(action.protocol)}: ${burnTokens}${tokenIdStr}`
            );
            i += 2; // Skip POOL_BURN and REMOVE_LIQUIDITY
          }

          stepNumber++;
          continue;
        }
      }

      // Check if this is an add liquidity group (POOL_MINT + ADD_LIQUIDITY)
      if (action.type === RebalanceActionType.POOL_MINT && i + 1 < actions.length) {
        const nextAction = actions[i + 1];
        if (nextAction.type === RebalanceActionType.ADD_LIQUIDITY) {
          const mintTokens = action.tokens
            .map(t => `${this.formatTokenAmount(t.amountFormatted)} ${t.symbol || 'TOKEN'}`)
            .join(' + ');
          const tokenId = nextAction.tokenId || action.tokenId;
          const tokenIdStr = tokenId ? ` (tokenId: ${tokenId})` : '';
          const tickInfo = (action.tickLower !== undefined && action.tickUpper !== undefined)
            ? ` at ticks [${action.tickLower}, ${action.tickUpper}]`
            : '';

          // Build pool name from token symbols
          const poolSymbols = action.tokens.map(t => t.symbol || 'TOKEN');
          const poolName = poolSymbols.length >= 2 ? `${poolSymbols[0]}/${poolSymbols[1]}` : poolSymbols.join('/');

          this.logger.log(
            `Step ${stepNumber}: Add liquidity to ${this.formatProtocolName(action.protocol)} ${poolName}: ${mintTokens}${tokenIdStr}${tickInfo}`
          );

          i += 2; // Skip POOL_MINT and ADD_LIQUIDITY
          stepNumber++;
          continue;
        }
      }

      // Handle standalone POOL_COLLECT (if not already handled above)
      if (action.type === RebalanceActionType.POOL_COLLECT) {
        const feeTokens = action.tokens
          .filter(t => parseFloat(t.amountFormatted || '0') > 0)
          .map(t => `${this.formatTokenAmount(t.amountFormatted)} ${t.symbol || 'TOKEN'}`)
          .join(' + ');

        if (feeTokens) {
          const tokenId = action.tokenId ? ` (tokenId: ${action.tokenId})` : '';
          this.logger.log(
            `Step ${stepNumber}: Collect fees from ${this.formatProtocolName(action.protocol)}: ${feeTokens}${tokenId}`
          );
          stepNumber++;
        }
        i++;
        continue;
      }

      // For all other actions, log them individually
      const actionDesc = this.describeAction(action);
      this.logger.log(`Step ${stepNumber}: ${actionDesc}`);
      stepNumber++;
      i++;
    }

    this.logger.log('=== END REBALANCE PATH ===');
  }

  /**
   * Format token amount for display (with proper precision)
   */
  private formatTokenAmount(amountFormatted: string | undefined): string {
    if (!amountFormatted) return '?';
    const num = parseFloat(amountFormatted);
    if (isNaN(num)) return amountFormatted;

    // For very small amounts, show more decimals
    if (num < 0.01) {
      return num.toFixed(6);
    }
    // For normal amounts, show 2 decimals
    return num.toFixed(2);
  }

  /**
   * Generate human-readable description of a rebalance action
   */
  private describeAction(action: RebalanceAction): string {
    const protocol = this.formatProtocolName(action.protocol);

    switch (action.type) {
      case RebalanceActionType.REMOVE_LIQUIDITY:
      case RebalanceActionType.POOL_BURN: {
        const tokens = action.tokens
          .map(t => `${t.amountFormatted || '?'} ${t.symbol || 'TOKEN'}`)
          .join(' + ');
        const tokenId = action.tokenId ? ` (tokenId: ${action.tokenId})` : '';
        return `Remove liquidity from ${protocol}: ${tokens}${tokenId}`;
      }

      case RebalanceActionType.POOL_COLLECT: {
        const tokens = action.tokens
          .map(t => `${t.amountFormatted || '?'} ${t.symbol || 'TOKEN'}`)
          .join(' + ');
        const tokenId = action.tokenId ? ` (tokenId: ${action.tokenId})` : '';
        return `Collect fees from ${protocol}: ${tokens}${tokenId}`;
      }

      case RebalanceActionType.SWAP: {
        if (action.tokens.length >= 2) {
          const tokenIn = action.tokens[0];
          const tokenOut = action.tokens[1];
          const amountIn = this.formatTokenAmount(tokenIn.amountFormatted);
          const amountOut = this.formatTokenAmount(tokenOut.amountFormatted);
          return `Swap ${amountIn} ${tokenIn.symbol || 'TOKEN'} to ${amountOut} ${tokenOut.symbol || 'TOKEN'} via ${protocol}`;
        }
        return `Swap via ${protocol}`;
      }

      case RebalanceActionType.ADD_LIQUIDITY:
      case RebalanceActionType.POOL_MINT: {
        const tokens = action.tokens
          .map(t => `${t.amountFormatted || '?'} ${t.symbol || 'TOKEN'}`)
          .join(' + ');
        const tokenId = action.tokenId ? ` (tokenId: ${action.tokenId})` : '';
        const tickInfo = (action.tickLower !== undefined && action.tickUpper !== undefined)
          ? ` at ticks [${action.tickLower}, ${action.tickUpper}]`
          : '';
        return `Add liquidity to ${protocol}: ${tokens}${tokenId}${tickInfo}`;
      }

      case RebalanceActionType.SUPPLY: {
        const token = action.tokens[0];
        const amount = token?.amountFormatted || '?';
        const symbol = token?.symbol || 'TOKEN';
        const vault = action.contractAddress ? ` (vault: ${action.contractAddress.slice(0, 10)}...)` : '';
        return `Supply ${amount} ${symbol} to ${protocol}${vault}`;
      }

      case RebalanceActionType.WITHDRAW: {
        const token = action.tokens[0];
        const amount = token?.amountFormatted || '?';
        const symbol = token?.symbol || 'TOKEN';
        const vault = action.contractAddress ? ` (vault: ${action.contractAddress.slice(0, 10)}...)` : '';
        return `Withdraw ${amount} ${symbol} from ${protocol}${vault}`;
      }

      case RebalanceActionType.BORROW: {
        const token = action.tokens[0];
        const amount = token?.amountFormatted || '?';
        const symbol = token?.symbol || 'TOKEN';
        return `Borrow ${amount} ${symbol} from ${protocol}`;
      }

      case RebalanceActionType.REPAY: {
        const token = action.tokens[0];
        const amount = token?.amountFormatted || '?';
        const symbol = token?.symbol || 'TOKEN';
        return `Repay ${amount} ${symbol} to ${protocol}`;
      }

      default:
        return `Unknown action: ${action.type}`;
    }
  }

  /**
   * Format protocol name for display
   */
  private formatProtocolName(protocol: Protocol): string {
    const protocolMap: Record<Protocol, string> = {
      [Protocol.UNISWAP_V2]: 'Uniswap V2',
      [Protocol.UNISWAP_V3]: 'Uniswap V3',
      [Protocol.AERODROME]: 'Aerodrome',
      [Protocol.OKX_ROUTER]: 'OKX',
      [Protocol.KYBERSWAP_ROUTER]: 'KyberSwap',
      [Protocol.AAVE]: 'Aave',
      [Protocol.EULER]: 'Euler',
      [Protocol.VENUS]: 'Venus',
    };
    return protocolMap[protocol] || protocol;
  }

  /**
   * Enrich token with symbol and formatted amount
   */
  private enrichToken(token: TokenAmount, chainId: string): TokenAmount {
    const info = this.getTokenInfo(token.token, chainId);
    return {
      ...token,
      symbol: info.symbol,
      decimals: info.decimals,
      amountFormatted: this.formatAmount(token.amount, info.decimals),
    };
  }

  /**
   * Parse liquidity events (Mint/Burn for Uniswap V2/Aerodrome)
   * Returns tokens array, optional tokenId, and tick range
   */
  private async parseLiquidityEvent(
    log: ethers.Log,
    decoded: ethers.LogDescription,
    eventSig: EventSignature,
    provider: ethers.Provider,
    allLogs: readonly ethers.Log[],
    eventIndex: number,
  ): Promise<{ tokens: TokenAmount[]; tokenId?: string; tickLower?: number; tickUpper?: number }> {
    const tokens: TokenAmount[] = [];
    let tokenId: string | undefined;
    let tickLower: number | undefined;
    let tickUpper: number | undefined;

    if (eventSig.protocol === Protocol.UNISWAP_V3) {
      // For V3, we need to handle different event types
      if (eventSig.name === 'IncreaseLiquidity' || eventSig.name === 'DecreaseLiquidity') {
        // IncreaseLiquidity(uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
        // DecreaseLiquidity(uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
        tokenId = decoded.args[0].toString(); // Extract tokenId
        const amount0Raw = decoded.args[2];
        const amount1Raw = decoded.args[3];
        const amount0 = BigInt(amount0Raw !== undefined ? amount0Raw.toString() : '0');
        const amount1 = BigInt(amount1Raw !== undefined ? amount1Raw.toString() : '0');

        const resolvedTokens = await this.resolveTokensFromNearbyPoolEvents(
          amount0,
          amount1,
          eventIndex,
          allLogs,
          provider,
          eventSig.name === 'IncreaseLiquidity' ? 'Mint' : 'Burn',
        );

        this.appendTokensWithFallback(tokens, resolvedTokens, amount0, amount1);
      } else if (eventSig.name === 'Mint') {
        // Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 liquidity, uint256 amount0, uint256 amount1)
        // indexed params are in topics, non-indexed in data
        // args array includes all params in order
        const tickLowerRaw = (decoded.args as any)?.tickLower ?? decoded.args?.[2];
        const tickUpperRaw = (decoded.args as any)?.tickUpper ?? decoded.args?.[3];
        const amount0Raw = (decoded.args as any)?.amount0 ?? decoded.args?.[5];
        const amount1Raw = (decoded.args as any)?.amount1 ?? decoded.args?.[6];

        tickLower = tickLowerRaw !== undefined ? Number(tickLowerRaw) : undefined;
        tickUpper = tickUpperRaw !== undefined ? Number(tickUpperRaw) : undefined;

        const amount0 = BigInt(amount0Raw !== undefined ? amount0Raw.toString() : '0');
        const amount1 = BigInt(amount1Raw !== undefined ? amount1Raw.toString() : '0');

        const resolvedTokens = await this.buildPoolTokenAmounts(log.address, amount0, amount1, provider);
        this.appendTokensWithFallback(tokens, resolvedTokens, amount0, amount1);
      } else if (eventSig.name === 'Burn') {
        // Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 liquidity, uint256 amount0, uint256 amount1)
        // indexed params are in topics, non-indexed in data
        // args array includes all params in order
        const tickLowerRaw = (decoded.args as any)?.tickLower ?? decoded.args?.[1];
        const tickUpperRaw = (decoded.args as any)?.tickUpper ?? decoded.args?.[2];
        const amount0Raw = (decoded.args as any)?.amount0 ?? decoded.args?.[4];
        const amount1Raw = (decoded.args as any)?.amount1 ?? decoded.args?.[5];

        tickLower = tickLowerRaw !== undefined ? Number(tickLowerRaw) : undefined;
        tickUpper = tickUpperRaw !== undefined ? Number(tickUpperRaw) : undefined;

        const amount0 = BigInt(amount0Raw !== undefined ? amount0Raw.toString() : '0');
        const amount1 = BigInt(amount1Raw !== undefined ? amount1Raw.toString() : '0');

        const resolvedTokens = await this.buildPoolTokenAmounts(log.address, amount0, amount1, provider);
        this.appendTokensWithFallback(tokens, resolvedTokens, amount0, amount1);
      } else if (eventSig.name === 'Collect') {
        // Collect(address indexed owner, address indexed recipient, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount0, uint128 amount1)
        // indexed params are in topics, non-indexed in data
        // args array includes all params in order
        const tickLowerRaw = (decoded.args as any)?.tickLower ?? decoded.args?.[2];
        const tickUpperRaw = (decoded.args as any)?.tickUpper ?? decoded.args?.[3];
        const amount0Raw = (decoded.args as any)?.amount0 ?? decoded.args?.[4];
        const amount1Raw = (decoded.args as any)?.amount1 ?? decoded.args?.[5];

        tickLower = tickLowerRaw !== undefined ? Number(tickLowerRaw) : undefined;
        tickUpper = tickUpperRaw !== undefined ? Number(tickUpperRaw) : undefined;

        const amount0 = BigInt(amount0Raw !== undefined ? amount0Raw.toString() : '0');
        const amount1 = BigInt(amount1Raw !== undefined ? amount1Raw.toString() : '0');

        const resolvedTokens = await this.buildPoolTokenAmounts(log.address, amount0, amount1, provider);
        this.appendTokensWithFallback(tokens, resolvedTokens, amount0, amount1);
      }
    }

    return { tokens, tokenId, tickLower, tickUpper };
  }

  private appendTokensWithFallback(
    target: TokenAmount[],
    resolvedTokens: TokenAmount[] | null,
    amount0: bigint,
    amount1: bigint,
  ): void {
    if (resolvedTokens && resolvedTokens.length === 2) {
      target.push(...resolvedTokens);
      return;
    }

    target.push(
      {
        token: 'UNKNOWN_TOKEN0',
        amount: amount0.toString(),
      },
      {
        token: 'UNKNOWN_TOKEN1',
        amount: amount1.toString(),
      },
    );
  }

  private async getPoolTokenAddresses(
    poolAddress: string,
    provider: ethers.Provider,
  ): Promise<{ token0: string; token1: string } | null> {
    const cacheKey = poolAddress.toLowerCase();
    const cached = this.poolTokenCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const poolContract = new ethers.Contract(
      poolAddress,
      ['function token0() view returns (address)', 'function token1() view returns (address)'],
      provider,
    );

    try {
      const [token0, token1] = await Promise.all([poolContract.token0(), poolContract.token1()]);
      const tokens = { token0, token1 };
      this.poolTokenCache.set(cacheKey, tokens);
      return tokens;
    } catch {
      return null;
    }
  }

  private async buildPoolTokenAmounts(
    poolAddress: string,
    amount0: bigint,
    amount1: bigint,
    provider: ethers.Provider,
  ): Promise<TokenAmount[] | null> {
    const tokenAddresses = await this.getPoolTokenAddresses(poolAddress, provider);
    if (!tokenAddresses) {
      return null;
    }

    return [
      {
        token: tokenAddresses.token0,
        amount: amount0.toString(),
      },
      {
        token: tokenAddresses.token1,
        amount: amount1.toString(),
      },
    ];
  }

  private async resolveTokensFromNearbyPoolEvents(
    targetAmount0: bigint,
    targetAmount1: bigint,
    eventIndex: number,
    allLogs: readonly ethers.Log[],
    provider: ethers.Provider,
    poolEventName: 'Mint' | 'Burn',
  ): Promise<TokenAmount[] | null> {
    const poolEventSig = this.EVENT_SIGNATURES.find(
      (sig) => sig.protocol === Protocol.UNISWAP_V3 && sig.name === poolEventName,
    );
    if (!poolEventSig?.abi) {
      return null;
    }

    const iface = new ethers.Interface([poolEventSig.abi]);
    const fragment = iface.getEvent(poolEventName);
    if (!fragment) {
      return null;
    }

    const topic0 = fragment.topicHash;
    const indices = Array.from({ length: allLogs.length }, (_, idx) => idx).sort((a, b) => {
      const diff = Math.abs(a - eventIndex) - Math.abs(b - eventIndex);
      return diff !== 0 ? diff : a - b;
    });

    for (const idx of indices) {
      if (idx === eventIndex) {
        continue;
      }

      const candidate = allLogs[idx];
      if (!candidate.topics.length || candidate.topics[0] !== topic0) {
        continue;
      }

      let decodedCandidate: ethers.LogDescription;
      try {
        decodedCandidate = iface.parseLog({
          topics: candidate.topics as string[],
          data: candidate.data,
        });
      } catch {
        continue;
      }

      const amount0Raw =
        (decodedCandidate.args as any)?.amount0 ??
        decodedCandidate.args?.[poolEventName === 'Mint' ? 5 : 4];
      const amount1Raw =
        (decodedCandidate.args as any)?.amount1 ??
        decodedCandidate.args?.[poolEventName === 'Mint' ? 6 : 5];

      if (amount0Raw === undefined || amount1Raw === undefined) {
        continue;
      }

      const amount0 = BigInt(amount0Raw.toString());
      const amount1 = BigInt(amount1Raw.toString());

      if (amount0 !== targetAmount0 || amount1 !== targetAmount1) {
        continue;
      }

      const resolved = await this.buildPoolTokenAmounts(candidate.address, amount0, amount1, provider);
      if (resolved) {
        return resolved;
      }
    }

    return null;
  }

  /**
   * Parse swap events
   */
  private async parseSwapEvent(
    log: ethers.Log,
    decoded: ethers.LogDescription,
    eventSig: EventSignature,
    provider: ethers.Provider,
  ): Promise<TokenAmount[]> {
    const tokens: TokenAmount[] = [];

    // OKX Router OrderRecord event
    if (eventSig.protocol === Protocol.OKX_ROUTER && eventSig.name === 'OrderRecord') {
      // OrderRecord(address fromToken, address toToken, address sender, uint256 fromAmount, uint256 returnAmount)
      const fromToken = decoded.args.fromToken;
      const toToken = decoded.args.toToken;
      const fromAmount = decoded.args.fromAmount;
      const returnAmount = decoded.args.returnAmount;

      tokens.push({
        token: fromToken,
        amount: fromAmount.toString(),
      });

      tokens.push({
        token: toToken,
        amount: returnAmount.toString(),
      });

      return tokens;
    }

    // KyberSwap Meta Aggregation RouterV2 Swapped event
    if (eventSig.protocol === Protocol.KYBERSWAP_ROUTER && eventSig.name === 'Swapped') {
      // Swapped(address sender, address srcToken, address dstToken, address dstReceiver, uint256 spentAmount, uint256 returnAmount)
      const srcToken = decoded.args.srcToken;
      const dstToken = decoded.args.dstToken;
      const spentAmount = decoded.args.spentAmount;
      const returnAmount = decoded.args.returnAmount;

      tokens.push({
        token: srcToken,
        amount: spentAmount.toString(),
      });

      tokens.push({
        token: dstToken,
        amount: returnAmount.toString(),
      });

      return tokens;
    }

    // Uniswap V2 style Swap event
    // Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)
    const amount0In = decoded.args[1];
    const amount1In = decoded.args[2];
    const amount0Out = decoded.args[3];
    const amount1Out = decoded.args[4];

    // Get token addresses from pair
    const pairAddress = log.address;
    const pairContract = new ethers.Contract(
      pairAddress,
      ['function token0() view returns (address)', 'function token1() view returns (address)'],
      provider,
    );

    const [token0, token1] = await Promise.all([pairContract.token0(), pairContract.token1()]);

    // Determine which token is input and which is output
    if (amount0In > 0n) {
      tokens.push({
        token: token0,
        amount: amount0In.toString(),
      });
    }

    if (amount1In > 0n) {
      tokens.push({
        token: token1,
        amount: amount1In.toString(),
      });
    }

    if (amount0Out > 0n) {
      tokens.push({
        token: token0,
        amount: amount0Out.toString(),
      });
    }

    if (amount1Out > 0n) {
      tokens.push({
        token: token1,
        amount: amount1Out.toString(),
      });
    }

    return tokens;
  }

  /**
   * Parse lending protocol events (Aave/Euler/Venus)
   */
  private async parseLendingEvent(
    log: ethers.Log,
    decoded: ethers.LogDescription,
    eventSig: EventSignature,
    provider: ethers.Provider,
  ): Promise<TokenAmount[]> {
    const tokens: TokenAmount[] = [];

    if (eventSig.protocol === Protocol.AAVE) {
      // Aave events structure:
      // Supply(address reserve, address user, uint256 amount, address onBehalfOf, uint16 referralCode)
      // Withdraw(address reserve, address user, address to, uint256 amount)
      // Borrow(address reserve, address user, uint256 amount, uint256 borrowRateMode, uint256 borrowRate, uint16 referralCode)
      // Repay(address reserve, address user, address repayer, uint256 amount, bool useATokens)

      let tokenAddress: string;
      let amount: bigint;

      if (eventSig.actionType === RebalanceActionType.SUPPLY || eventSig.actionType === RebalanceActionType.BORROW) {
        tokenAddress = decoded.args[0]; // reserve
        amount = decoded.args[3]; // amount
      } else {
        // WITHDRAW or REPAY
        tokenAddress = decoded.args[0]; // reserve
        amount = decoded.args[3]; // amount
      }

      tokens.push({
        token: tokenAddress,
        amount: amount.toString(),
      });
    } else if (eventSig.protocol === Protocol.EULER) {
      // Euler vault events follow ERC-4626 semantics:
      // Deposit(address sender, address owner, uint256 assets, uint256 shares)
      // Withdraw(address sender, address receiver, address owner, uint256 assets, uint256 shares)
      const args = decoded.args as any;
      let tokenAddress: string | undefined = args?.underlying ?? args?.asset;

      if (
        !tokenAddress &&
        Array.isArray(args) &&
        args.length === 3 &&
        typeof args[0] === 'string'
      ) {
        tokenAddress = args[0];
      }

      if (!tokenAddress) {
        const vaultContract = new ethers.Contract(
          log.address,
          ['function asset() view returns (address)'],
          provider,
        );

        try {
          tokenAddress = await vaultContract.asset();
        } catch {
          tokenAddress = log.address;
        }
      }

      tokenAddress = tokenAddress ?? log.address;

      let amountRaw = args?.assets ?? args?.amount;

      if (amountRaw === undefined && Array.isArray(args)) {
        const candidateIndex = args.length >= 2 ? args.length - 2 : args.length - 1;
        if (candidateIndex >= 0) {
          amountRaw = args[candidateIndex];
        }
      }

      if (amountRaw === undefined) {
        amountRaw = args?.[2];
      }

      let amountValue: bigint = 0n;

      if (typeof amountRaw === 'bigint') {
        amountValue = amountRaw;
      } else if (amountRaw !== undefined && amountRaw !== null) {
        try {
          amountValue = BigInt(amountRaw.toString());
        } catch {
          amountValue = 0n;
        }
      }

      tokens.push({
        token: tokenAddress,
        amount: amountValue.toString(),
      });
    } else if (eventSig.protocol === Protocol.VENUS) {
      // Venus events structure (similar to Compound):
      // Mint(address minter, uint256 mintAmount, uint256 mintTokens)
      // Redeem(address redeemer, uint256 redeemAmount, uint256 redeemTokens)
      // Borrow(address borrower, uint256 borrowAmount, uint256 accountBorrows, uint256 totalBorrows)
      // RepayBorrow(address payer, address borrower, uint256 repayAmount, uint256 accountBorrows, uint256 totalBorrows)

      // For Venus, the log.address is the vToken contract
      // We need to get the underlying token
      const vTokenContract = new ethers.Contract(
        log.address,
        ['function underlying() view returns (address)'],
        provider,
      );

      let tokenAddress: string;
      try {
        tokenAddress = await vTokenContract.underlying();
      } catch {
        // If it's vBNB or similar, it doesn't have underlying
        tokenAddress = log.address; // Use vToken address
      }

      const venusAmountField: Record<string, { field: string; index: number }> = {
        Mint: { field: 'mintAmount', index: 1 },
        Redeem: { field: 'redeemAmount', index: 1 },
        Borrow: { field: 'borrowAmount', index: 1 },
        RepayBorrow: { field: 'repayAmount', index: 2 },
      };

      const amountMeta = venusAmountField[eventSig.name] ?? { field: '', index: 1 };
      const amountRaw =
        (amountMeta.field ? decoded.args?.[amountMeta.field] : undefined) ?? decoded.args?.[amountMeta.index];
      const amount = amountRaw ? amountRaw.toString() : '0';

      tokens.push({
        token: tokenAddress,
        amount,
      });
    }

    return tokens;
  }

  /**
   * Track position flows by tokenId across multiple transactions
   * Analyzes all actions across all transactions to calculate inflows, outflows, and fees for each position
   * @param parsedTransactions Array of parsed transactions with their metadata
   * @param chainId Chain ID for token info lookup
   */
  trackPositionFlows(
    parsedTransactions: Array<{ txHash: string; parsed: ParsedTransaction }>,
    chainId: string = '8453',
  ): PositionTrackingSummary {
    return trackPositionFlows(parsedTransactions, chainId);
  }

  /**
   * Format position tracking summary as human-readable text
   */
  formatPositionTracking(summary: PositionTrackingSummary, chainId: string = '8453'): string {
    return formatPositionTracking(summary, chainId);
  }

  /**
   * Track lending positions (AAVE/Euler) across multiple transactions
   * Analyzes supply/withdraw actions to calculate deposits, withdrawals, and interest earned
   */
  trackLendingPositions(
    parsedTransactions: Array<{ txHash: string; parsed: ParsedTransaction }>,
    chainId: string = '8453',
  ): LendingPositionSummary {
    return trackLendingPositions(parsedTransactions, chainId);
  }

  /**
   * Format lending position summary as human-readable text
   */
  formatLendingPositions(summary: LendingPositionSummary, chainId: string = '8453'): string {
    return formatLendingPositions(summary, chainId);
  }

  /**
   * Format parsed transaction actions as human-readable text
   */
  formatParsedTransaction(parsed: ParsedTransaction): string {
    const lines: string[] = [];

    lines.push(`Transaction: ${parsed.transactionHash}`);
    lines.push(`Block: ${parsed.blockNumber}`);
    if (parsed.timestamp) {
      lines.push(`Timestamp: ${new Date(parsed.timestamp * 1000).toISOString()}`);
    }
    lines.push(`\nRebalance Actions (${parsed.actions.length}):`);
    lines.push('---');

    parsed.actions.forEach((action, idx) => {
      lines.push(`\n[${idx + 1}] ${action.type} via ${action.protocol}`);

      if (action.tokenId) {
        lines.push(`  TokenId: ${action.tokenId}`);
      }

      action.tokens.forEach((token, tokenIdx) => {
        // Use formatted amount if available, otherwise raw amount
        const amountDisplay = token.amountFormatted || token.amount;
        // Use symbol if available, otherwise truncated address
        const symbolDisplay = token.symbol || (token.token.substring(0, 6) + '...' + token.token.substring(token.token.length - 4));

        lines.push(`  Token ${tokenIdx + 1}: ${amountDisplay} ${symbolDisplay}`);

        // Only show address if symbol is not available
        if (!token.symbol) {
          lines.push(`    Address: ${token.token}`);
        }
      });

      if (action.metadata && Object.keys(action.metadata).length > 0) {
        lines.push(`  Metadata: ${JSON.stringify(action.metadata, null, 2)}`);
      }
    });

    return lines.join('\n');
  }
}
