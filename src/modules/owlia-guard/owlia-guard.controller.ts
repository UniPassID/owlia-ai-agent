import { Body, Controller, Post } from '@nestjs/common';
import { OwliaGuardService } from './owlia-guard.service';
import {
  ExecuteRebalancePositionResponseDto,
  RebalancePositionParamsDto,
} from './dto/rebalance-position.response.dto';
import { ApiOk } from '../../common/dto/response.dto';
import { RebalancePositionDto } from './dto/rebalance-position.dto';

@Controller({
  path: 'owlia-guard',
  version: '1',
})
export class OwliaGuardController {
  constructor(private readonly owliaGuardService: OwliaGuardService) {}

  @Post('rebalance-position')
  @ApiOk(ExecuteRebalancePositionResponseDto)
  async rebalancePosition(@Body() dto: RebalancePositionDto) {
    return this.owliaGuardService.executeRebalancePosition(dto);
  }

  @Post('rebalance-position-params')
  @ApiOk(RebalancePositionParamsDto)
  async getRebalancePositionParams(@Body() dto: RebalancePositionDto) {
    return this.owliaGuardService.getRebalancePositionParams(dto);
  }
}
