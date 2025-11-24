import { Controller, Get, Query } from '@nestjs/common';
import { DeploymentService } from './deployment.service';
import { ApiOk } from '../common/dto/response.dto';
import { DeploymentConfigResponseDto } from './dto/deployment.response.dt';
import { NetworkDto } from '../user/dto/common.dto';

@Controller('deployment')
export class DeploymentController {
  constructor(private readonly deploymentService: DeploymentService) {}

  @Get('config')
  @ApiOk(DeploymentConfigResponseDto)
  async getDeploymentConfig(
    @Query('network') network: NetworkDto,
  ): Promise<DeploymentConfigResponseDto> {
    return this.deploymentService.getDeploymentConfig(network);
  }
}
