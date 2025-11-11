import { Controller, Get, Query } from "@nestjs/common";
import { MonitorService } from "./monitor.service";
import { NetworkDto } from "../user/dtos/user.dto";

@Controller("monitor")
export class MonitorController {
  constructor(private readonly monitorService: MonitorService) {}

  @Get("precheck")
  async precheck(
    @Query("address") address: string,
    @Query("network") network: NetworkDto
  ) {
    return this.monitorService.evaluateUserPrecheckByAddress(address, network);
  }
}
