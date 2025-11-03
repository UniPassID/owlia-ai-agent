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
} from './types/transaction-parser.types';

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

      for (let i = 0; i < receipt.logs.length; i++) {
        const log = receipt.logs[i];
        const action = await this.parseLog(log, i, provider);
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
  ): Promise<RebalanceAction | null> {
    const topic0 = log.topics[0];
    const eventSig = this.EVENT_TOPICS.get(topic0);

    if (!eventSig) {
      // Unknown event, skip
      return null;
    }

    this.logger.debug(`Parsing ${eventSig.name} event from ${eventSig.protocol}`);

    try {
      const action = await this.parseEventByType(log, eventSig, eventIndex, provider);
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

    // Parse based on action type and protocol
    switch (eventSig.actionType) {
      case RebalanceActionType.ADD_LIQUIDITY:
      case RebalanceActionType.REMOVE_LIQUIDITY:
      case RebalanceActionType.POOL_MINT:
      case RebalanceActionType.POOL_BURN:
      case RebalanceActionType.POOL_COLLECT:
        tokens = await this.parseLiquidityEvent(log, decoded, eventSig, provider);
        break;

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
   */
  private async parseLiquidityEvent(
    log: ethers.Log,
    decoded: ethers.LogDescription,
    eventSig: EventSignature,
    provider: ethers.Provider,
  ): Promise<TokenAmount[]> {
    const tokens: TokenAmount[] = [];

    if (eventSig.protocol === Protocol.UNISWAP_V3) {
      // For V3, we need to handle different event types
      if (eventSig.name === 'IncreaseLiquidity' || eventSig.name === 'DecreaseLiquidity') {
        // IncreaseLiquidity(uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
        // DecreaseLiquidity(uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
        const amount0 = decoded.args[2];
        const amount1 = decoded.args[3];

        // We'd need to query the NFT position manager to get token addresses
        // For now, store amounts without token addresses
        tokens.push({
          token: 'UNKNOWN_TOKEN0',
          amount: amount0.toString(),
        });

        tokens.push({
          token: 'UNKNOWN_TOKEN1',
          amount: amount1.toString(),
        });
      } else if (eventSig.name === 'Mint') {
        // Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 liquidity, uint256 amount0, uint256 amount1)
        // indexed params are in topics, non-indexed in data
        // args array includes all params in order
        const amount0 = decoded.args.amount0 || decoded.args[5];
        const amount1 = decoded.args.amount1 || decoded.args[6];

        // Get token addresses from pool contract
        const poolAddress = log.address;
        const poolContract = new ethers.Contract(
          poolAddress,
          ['function token0() view returns (address)', 'function token1() view returns (address)'],
          provider,
        );

        try {
          const [token0, token1] = await Promise.all([poolContract.token0(), poolContract.token1()]);

          tokens.push({
            token: token0,
            amount: amount0.toString(),
          });

          tokens.push({
            token: token1,
            amount: amount1.toString(),
          });
        } catch (error) {
          // Fallback if contract call fails
          tokens.push({
            token: 'UNKNOWN_TOKEN0',
            amount: amount0.toString(),
          });

          tokens.push({
            token: 'UNKNOWN_TOKEN1',
            amount: amount1.toString(),
          });
        }
      } else if (eventSig.name === 'Burn') {
        // Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 liquidity, uint256 amount0, uint256 amount1)
        // indexed params are in topics, non-indexed in data
        // args array includes all params in order
        const amount0 = decoded.args.amount0 || decoded.args[4];
        const amount1 = decoded.args.amount1 || decoded.args[5];

        // Get token addresses from pool contract
        const poolAddress = log.address;
        const poolContract = new ethers.Contract(
          poolAddress,
          ['function token0() view returns (address)', 'function token1() view returns (address)'],
          provider,
        );

        try {
          const [token0, token1] = await Promise.all([poolContract.token0(), poolContract.token1()]);

          tokens.push({
            token: token0,
            amount: amount0.toString(),
          });

          tokens.push({
            token: token1,
            amount: amount1.toString(),
          });
        } catch (error) {
          // Fallback if contract call fails
          tokens.push({
            token: 'UNKNOWN_TOKEN0',
            amount: amount0.toString(),
          });

          tokens.push({
            token: 'UNKNOWN_TOKEN1',
            amount: amount1.toString(),
          });
        }
      } else if (eventSig.name === 'Collect') {
        // Collect(address indexed owner, address indexed recipient, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount0, uint128 amount1)
        // indexed params are in topics, non-indexed in data
        // args array includes all params in order
        const amount0 = decoded.args.amount0 || decoded.args[4];
        const amount1 = decoded.args.amount1 || decoded.args[5];

        // Get token addresses from pool contract
        const poolAddress = log.address;
        const poolContract = new ethers.Contract(
          poolAddress,
          ['function token0() view returns (address)', 'function token1() view returns (address)'],
          provider,
        );

        try {
          const [token0, token1] = await Promise.all([poolContract.token0(), poolContract.token1()]);

          tokens.push({
            token: token0,
            amount: amount0.toString(),
          });

          tokens.push({
            token: token1,
            amount: amount1.toString(),
          });
        } catch (error) {
          // Fallback if contract call fails
          tokens.push({
            token: 'UNKNOWN_TOKEN0',
            amount: amount0.toString(),
          });

          tokens.push({
            token: 'UNKNOWN_TOKEN1',
            amount: amount1.toString(),
          });
        }
      }
    }

    return tokens;
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
