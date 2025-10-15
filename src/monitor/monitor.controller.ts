import { Controller, Get, Query } from '@nestjs/common';
import { MonitorService } from './monitor.service';

@Controller('monitor')
export class MonitorController {
  constructor(private readonly monitorService: MonitorService) {}

  @Get('precheck')
  async precheck(@Query('address') address: string) {
    return this.monitorService.evaluateUserPrecheckByAddress(address);
  }
}
