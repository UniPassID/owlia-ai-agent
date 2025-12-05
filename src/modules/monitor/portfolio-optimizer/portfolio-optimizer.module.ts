import { Module } from '@nestjs/common';
import { AgentModule } from '../../agent/agent.module';
import { APYCalculatorService } from './apy-calculator.service';
import { CostCalculatorService } from './cost-calculator.service';
import { MarginalOptimizerService } from './marginal-optimizer.service';
import { OpportunityConverterService } from './opportunity-converter.service';
import { TrackerModule } from '../../tracker/tracker.module';
import { OwliaGuardModule } from '../../owlia-guard/owlia-guard.module';

@Module({
  imports: [AgentModule, TrackerModule, OwliaGuardModule],
  providers: [
    APYCalculatorService,
    CostCalculatorService,
    MarginalOptimizerService,
    OpportunityConverterService,
  ],
  exports: [
    APYCalculatorService,
    CostCalculatorService,
    MarginalOptimizerService,
    OpportunityConverterService,
  ],
})
export class PortfolioOptimizerModule {}
