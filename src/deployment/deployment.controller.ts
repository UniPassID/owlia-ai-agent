import { Controller, Get, Query } from '@nestjs/common';
import { DeploymentService } from './deployment.service';
import { ApiOk } from '../common/dto/response.dto';
import { DeploymentConfigResponseDto } from './dto/deployment.response.dto';
import { NetworkDto } from '../user/dto/common.dto';
import { ApiTags } from '@nestjs/swagger';

@Controller({
  path: 'deployment',
  version: '1',
})
@ApiTags('Deployment')
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
