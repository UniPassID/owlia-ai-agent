import { Injectable, Logger } from '@nestjs/common';
import { NetworkDto } from '../common/dto/network.dto';
import {
  DEFAULT_DEPLOYMENT_CONFIGS,
  DeploymentConfigResponseDto,
} from './dto/deployment.response.dto';

@Injectable()
export class DeploymentService {
  private readonly logger = new Logger(DeploymentService.name);

  getDeploymentConfig(network: NetworkDto): DeploymentConfigResponseDto {
    return DEFAULT_DEPLOYMENT_CONFIGS[network];
  }

  getDeploymentConfigs(): Record<NetworkDto, DeploymentConfigResponseDto> {
    return DEFAULT_DEPLOYMENT_CONFIGS;
  }
}
