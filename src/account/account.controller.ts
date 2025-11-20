import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AccountResponseDto } from './dto/account.response.dto';
import { ApiOk } from '../common/dto/response.dto';
import { PositionsResponseDto } from './dto/position.response.dto';
import { GetDeploymentSnapshotsDto } from './dto/get-snapshot.dto';
import { DeploymentSnapshotsResponseDto } from './dto/snapshot.response.dto';

@Controller({
  path: 'account',
  version: '1',
})
export class AccountController {
  @Get('')
  @ApiOk(AccountResponseDto)
  async getAccountInfo(
    @Query('wallet') wallet: string,
  ): Promise<AccountResponseDto> {
    throw new Error('Not implemented');
  }

  @Get('/deployment/positions')
  @ApiOk(PositionsResponseDto)
  async getPositions(
    @Query('deploymentId') deploymentId: string,
  ): Promise<PositionsResponseDto> {
    throw new Error('Not implemented');
  }

  @Post('deployment/snapshots')
  @ApiOk(DeploymentSnapshotsResponseDto)
  async getDeploymentSnapshots(
    @Body() body: GetDeploymentSnapshotsDto,
  ): Promise<DeploymentSnapshotsResponseDto> {
    throw new Error('Not implemented');
  }
}
