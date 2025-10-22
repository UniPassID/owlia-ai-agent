import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { RegisterUserDto } from './dto/user.dto';
import axios from 'axios';
import { RPC_ENDPOINTS } from '../config/rpc.config';

interface TransactionReceipt {
  logs: Array<{
    address: string;
    topics: string[];
    data: string;
  }>;
  status: string;
}

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  // Chain ID mappings (name to numeric ID)
  private readonly chainIdMap: Record<string, number> = {
    'ethereum': 1,
    'eth': 1,
    'mainnet': 1,
    '1': 1,
    'bsc': 56,
    'bnb': 56,
    '56': 56,
    'optimism': 10,
    'op': 10,
    '10': 10,
    'base': 8453,
    '8453': 8453,
    'arbitrum': 42161,
    'arb': 42161,
    '42161': 42161,
  };

  // Safe contract deployment event signature
  // event ProxyCreation(address proxy, address singleton)
  private readonly SAFE_PROXY_CREATION_TOPIC =
    '0x4f51faf6c4561ff95f067657e43439f0f856d97c04d9ec9070a6199ad418e235';

  // Safe module enabled event signature
  // event EnabledModule(address module)
  private readonly ENABLED_MODULE_TOPIC =
    '0xecdf3a3effea5783a3c4c2140e677577666428d44ed9d474a0b3a4c9943f8440';

  // Required module addresses by chain
  private readonly REQUIRED_MODULE_ADDRESSES: Record<string, string> = {
    '8453': '0xC25Ccf56f408c37b5eD33Ac47D0358cFAd0877e0'.toLowerCase(), // Base
    '56': '0xeF07EA36e815EAc1a74F2769F1e7cA42b4BA7026'.toLowerCase(),   // BSC
  };

  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  /**
   * Convert chain identifier (name or string ID) to numeric chain ID
   */
  private getChainId(chainIdentifier: string): number {
    const normalized = chainIdentifier.toLowerCase();
    const chainId = this.chainIdMap[normalized];

    if (!chainId) {
      // Try to parse as number if not found in map
      const parsed = parseInt(chainIdentifier, 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
      throw new HttpException(
        { success: false, error: `Unsupported chain: ${chainIdentifier}` },
        HttpStatus.BAD_REQUEST,
      );
    }

    return chainId;
  }

  /**
   * Register a new user with transaction verification
   */
  async register(dto: RegisterUserDto): Promise<User> {
    this.logger.log(`Registering user with address: ${dto.address} on chain: ${dto.network}`);

    const chainId = this.getChainId(dto.network);

    // Check if user already exists on this chain
    const existingUser = await this.userRepo.findOne({
      where: {
        address: dto.address.toLowerCase(),
        chainId,
      },
    });

    if (existingUser) {
      throw new HttpException(
        { success: false, error: 'User already registered on this chain' },
        HttpStatus.CONFLICT,
      );
    }

    // Verify transaction on chain
    await this.verifyActivationTransaction(
      chainId.toString(),
      dto.activationTxHash,
      dto.address,
    );

    // Create new user
    const user = this.userRepo.create({
      address: dto.address.toLowerCase(),
      safeOwner: dto.safeOwner.toLowerCase(),
      activationTxHash: dto.activationTxHash.toLowerCase(),
      chainId,
    });

    await this.userRepo.save(user);
    this.logger.log(`User registered successfully: ${user.id}`);

    return user;
  }

  /**
   * Verify activation transaction contains Safe deployment and module activation
   */
  private async verifyActivationTransaction(
    chainId: string,
    txHash: string,
    userAddress: string,
  ): Promise<void> {
    this.logger.log(`Verifying transaction ${txHash} on ${chainId}`);

    const rpcUrl = RPC_ENDPOINTS[chainId];
    if (!rpcUrl) {
      throw new HttpException(
        { success: false, error: `Unsupported chain: ${chainId}` },
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      // Get transaction receipt
      const receipt = await this.getTransactionReceipt(rpcUrl, txHash);

      // Check transaction status
      if (receipt.status !== '0x1') {
        throw new HttpException(
          { success: false, error: 'Transaction failed on chain' },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Verify logs contain Safe deployment
      const hasSafeDeployment = this.checkSafeDeployment(receipt);
      if (!hasSafeDeployment) {
        throw new HttpException(
          {
            success: false,
            error: 'Transaction does not contain Safe contract deployment',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Verify logs contain module activation
      const hasModuleActivation = this.checkModuleActivation(receipt, chainId);
      if (!hasModuleActivation) {
        throw new HttpException(
          {
            success: false,
            error: 'Transaction does not contain module activation',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      this.logger.log(`Transaction verification successful for ${txHash}`);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`Failed to verify transaction: ${error.message}`);
      throw new HttpException(
        { success: false, error: `Failed to verify transaction: ${error.message}` },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get transaction receipt from RPC
   */
  private async getTransactionReceipt(
    rpcUrl: string,
    txHash: string,
  ): Promise<TransactionReceipt> {
    try {
      const response = await axios.post(
        rpcUrl,
        {
          jsonrpc: '2.0',
          method: 'eth_getTransactionReceipt',
          params: [txHash],
          id: 1,
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000,
        },
      );

      if (response.data.error) {
        throw new Error(response.data.error.message);
      }

      if (!response.data.result) {
        throw new Error('Transaction not found');
      }

      return response.data.result;
    } catch (error) {
      throw new Error(`RPC request failed: ${error.message}`);
    }
  }

  /**
   * Check if transaction logs contain Safe deployment
   */
  private checkSafeDeployment(receipt: TransactionReceipt): boolean {
    return receipt.logs.some(
      (log) =>
        log.topics[0]?.toLowerCase() ===
        this.SAFE_PROXY_CREATION_TOPIC.toLowerCase(),
    );
  }

  /**
   * Check if transaction logs contain module activation for the required module
   */
  private checkModuleActivation(receipt: TransactionReceipt, chainId: string): boolean {
    const requiredModuleAddress = this.REQUIRED_MODULE_ADDRESSES[chainId];
    if (!requiredModuleAddress) {
      this.logger.warn(`No required module address configured for chain ${chainId}`);
      return false;
    }

    return receipt.logs.some((log) => {
      if (log.topics[0]?.toLowerCase() !== this.ENABLED_MODULE_TOPIC.toLowerCase()) {
        return false;
      }

      console.log("log.topics", log.topics)

      // EnabledModule event has the module address as topics[1]
      // topics[1] is padded to 32 bytes, so we need to extract the address
      const moduleAddress = log.topics[1]
        ? '0x' + log.topics[1].slice(-40).toLowerCase()
        : null;

      return moduleAddress === requiredModuleAddress;
    });
  }

  /**
   * Get user by address and chainId
   */
  async getUserByAddress(address: string, chainId: string): Promise<User | null> {
    const numericChainId = this.getChainId(chainId);
    return this.userRepo.findOne({
      where: {
        address: address.toLowerCase(),
        chainId: numericChainId,
      },
    });
  }

  /**
   * Get user by ID
   */
  async getUserById(id: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { id } });
  }
}
