import { Injectable } from '@nestjs/common';
import { NetworkDto } from '../../common/dto/network.dto';
import { DeploymentConfigResponseDto } from './dto/deployment.response.dto';
import { DEFAULT_DEPLOYMENT_CONFIGS } from './constants';

@Injectable()
export class DeploymentService {
  getDeploymentConfig(network: NetworkDto): DeploymentConfigResponseDto {
    return DEFAULT_DEPLOYMENT_CONFIGS[network];
  }

  getDeploymentConfigs(): Record<NetworkDto, DeploymentConfigResponseDto> {
    return DEFAULT_DEPLOYMENT_CONFIGS;
  }
}
