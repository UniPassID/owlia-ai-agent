import { Inject, Injectable, Logger } from '@nestjs/common';
import { UserService } from '../user/user.service';
import { RebalancePositionDto } from './dto/rebalance-position.dto';
import { NetworkDto } from '../common/dto/network.dto';
import { OwliaGuardManager } from './utils/owlia-guard-manager';
import { KyberSwapClient } from '../common/kyber-swap-client';
import {
  ExecuteRebalancePositionResponseDto,
  RebalancePositionParamsDto,
} from './dto/rebalance-position.response.dto';
import { AaveV3Service } from '../aave-v3/aave-v3.service';
import { AerodromeClService } from '../aerodrome-cl/aerodrome-cl.service';
import { EulerV2Service } from '../euler-v2/euler-v2.service';
import { VenusV4Service } from '../venus-v4/venus-v4.service';
import { UniswapV3Service } from '../uniswap-v3/uniswap-v3.service';
import { WalletClient } from 'viem';
import privateConfig from '../config/private.config';
import { ConfigType } from '@nestjs/config';
import blockchainsConfig from '../config/blockchains.config';

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
    @Inject(privateConfig.KEY)
    _privateConfig: ConfigType<typeof privateConfig>,
    @Inject(blockchainsConfig.KEY)
    blockchains: ConfigType<typeof blockchainsConfig>,
  ) {
    this.owliaGuardManagers = {
      [NetworkDto.Bsc]: new OwliaGuardManager(
        NetworkDto.Bsc,
        this.aaveV3Service,
        this.aerodromeCLService,
        this.eulerV2Service,
        this.venusV4Service,
        this.uniswapV3Service,
        this.kyberSwapClient,
        this.userService,
        _privateConfig.privateKey,
        blockchains.bsc.rpcUrls,
      ),
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
}
