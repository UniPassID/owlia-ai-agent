import { Injectable } from '@nestjs/common';
import { NetworkDto } from '../../common/dto/network.dto';
import {
  DeploymentConfigResponseDto,
  DeploymentConfigsResponseDto,
} from './dto/deployment.response.dto';
import { DEFAULT_DEPLOYMENT_CONFIGS } from './constants';

@Injectable()
export class DeploymentService {
  getDeploymentConfig(network: NetworkDto): DeploymentConfigResponseDto {
    return DEFAULT_DEPLOYMENT_CONFIGS[network];
  }

  getDeploymentConfigsRecord(): Record<
    NetworkDto,
    DeploymentConfigResponseDto
  > {
    return DEFAULT_DEPLOYMENT_CONFIGS;
  }

  getDeploymentConfigs(): DeploymentConfigsResponseDto {
    return {
      configs: Object.values(DEFAULT_DEPLOYMENT_CONFIGS),
    } satisfies DeploymentConfigsResponseDto;
  }
}
