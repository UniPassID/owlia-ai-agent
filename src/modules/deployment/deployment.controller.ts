import { Controller, Get } from '@nestjs/common';
import { DeploymentService } from './deployment.service';
import { ApiOk } from '../../common/dto/response.dto';
import { DeploymentConfigsResponseDto } from './dto/deployment.response.dto';
import { ApiTags } from '@nestjs/swagger';

@Controller({
  path: 'deployment',
  version: '1',
})
@ApiTags('Deployment')
export class DeploymentController {
  constructor(private readonly deploymentService: DeploymentService) {}

  @Get('config/list')
  @ApiOk(DeploymentConfigsResponseDto)
  async getDeploymentConfigs(): Promise<DeploymentConfigsResponseDto> {
    return this.deploymentService.getDeploymentConfigs();
  }
}
