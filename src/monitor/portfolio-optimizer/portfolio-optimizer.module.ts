import { Module } from '@nestjs/common';
import { AgentModule } from '../../agent/agent.module';
import { APYCalculatorService } from './apy-calculator.service';
import { CostCalculatorService } from './cost-calculator.service';
import { MarginalOptimizerService } from './marginal-optimizer.service';
import { OpportunityConverterService } from './opportunity-converter.service';

@Module({
  imports: [AgentModule],
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
