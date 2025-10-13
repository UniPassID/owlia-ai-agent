import { Injectable, Logger } from '@nestjs/common';
import { UserPolicy } from '../entities/user-policy.entity';

export interface SimulationResult {
  netGainUsd: number;
  gasCostUsd: number;
  slippageBps: number;
  finalHealthFactor?: number;
  finalApr: number;
  aprLiftBps: number;
  risks: string[];
  approved?: boolean;
  reason?: string;
}

export interface GuardResult {
  approved: boolean;
  reason: string;
  violations: string[];
}

@Injectable()
export class GuardService {
  private readonly logger = new Logger(GuardService.name);

  /**
   * Main guard function to approve or reject a simulation result
   */
  approveSimulation(
    simulation: SimulationResult,
    userPolicy: UserPolicy | null,
  ): GuardResult {
    this.logger.log('Running guard checks on simulation');

    // If no user policy, skip all policy-based checks and approve
    if (!userPolicy) {
      this.logger.log('No user policy provided, skipping policy checks');

      // Still check for critical risks
      const violations: string[] = [];
      if (simulation.risks && simulation.risks.length > 0) {
        const criticalRisks = simulation.risks.filter((r) =>
          r.toLowerCase().includes('critical'),
        );
        if (criticalRisks.length > 0) {
          violations.push(`Critical risks detected: ${criticalRisks.join(', ')}`);
        }
      }

      const approved = violations.length === 0;
      const result: GuardResult = {
        approved,
        reason: approved
          ? 'No policy checks required, no critical risks'
          : `Critical risks found: ${violations.join('; ')}`,
        violations,
      };

      if (approved) {
        this.logger.log('✅ Simulation approved (no policy)');
      } else {
        this.logger.warn(`❌ Simulation rejected: ${result.reason}`);
      }

      return result;
    }

    const violations: string[] = [];

    // Check 1: Net gain must exceed minimum threshold
    if (simulation.netGainUsd < userPolicy.minNetUsd) {
      violations.push(
        `Net gain $${simulation.netGainUsd.toFixed(2)} < minimum $${userPolicy.minNetUsd}`,
      );
    }

    // Check 2: APR lift must exceed minimum threshold
    if (simulation.aprLiftBps < userPolicy.minAprLiftBps) {
      violations.push(
        `APR lift ${simulation.aprLiftBps} bps < minimum ${userPolicy.minAprLiftBps} bps`,
      );
    }

    // Check 3: Health factor must be above minimum (if applicable)
    if (
      simulation.finalHealthFactor !== undefined &&
      simulation.finalHealthFactor < userPolicy.minHealthFactor
    ) {
      violations.push(
        `Health factor ${simulation.finalHealthFactor.toFixed(2)} < minimum ${userPolicy.minHealthFactor}`,
      );
    }

    // Check 4: Slippage must be within limit
    if (simulation.slippageBps > userPolicy.maxSlippageBps) {
      violations.push(
        `Slippage ${simulation.slippageBps} bps > maximum ${userPolicy.maxSlippageBps} bps`,
      );
    }

    // Check 5: Gas cost must be within limit
    if (simulation.gasCostUsd > userPolicy.maxGasUsd) {
      violations.push(
        `Gas cost $${simulation.gasCostUsd.toFixed(2)} > maximum $${userPolicy.maxGasUsd}`,
      );
    }

    // Check 6: Review simulation risks
    if (simulation.risks && simulation.risks.length > 0) {
      const criticalRisks = simulation.risks.filter((r) =>
        r.toLowerCase().includes('critical'),
      );
      if (criticalRisks.length > 0) {
        violations.push(`Critical risks detected: ${criticalRisks.join(', ')}`);
      }
    }

    const approved = violations.length === 0;

    const result: GuardResult = {
      approved,
      reason: approved
        ? 'All checks passed'
        : `Failed checks: ${violations.join('; ')}`,
      violations,
    };

    if (approved) {
      this.logger.log('✅ Simulation approved');
    } else {
      this.logger.warn(`❌ Simulation rejected: ${result.reason}`);
    }

    return result;
  }

  /**
   * Additional pre-execution checks
   */
  validateExecution(
    plan: any,
    userPolicy: UserPolicy | null,
  ): { valid: boolean; reason: string } {
    // Check for whitelisted protocols
    const allowedProtocols = ['AAVE', 'EULER', 'UniswapV3', 'AerodromeCL'];

    for (const step of plan.steps || []) {
      if (!allowedProtocols.includes(step.protocol)) {
        return {
          valid: false,
          reason: `Protocol ${step.protocol} not in whitelist`,
        };
      }

      // Check asset whitelist if configured and policy exists
      if (userPolicy && userPolicy.assetWhitelist.length > 0) {
        if (!userPolicy.assetWhitelist.includes(step.asset)) {
          return {
            valid: false,
            reason: `Asset ${step.asset} not in user whitelist`,
          };
        }
      }
    }

    return { valid: true, reason: 'Validation passed' };
  }

  /**
   * Check if auto-execution is allowed
   */
  canAutoExecute(userPolicy: UserPolicy | null, tradeValueUsd: number): boolean {
    // If no policy, allow auto-execution (no restrictions)
    if (!userPolicy) {
      this.logger.log('No user policy, allowing auto-execution');
      return true;
    }

    if (!userPolicy.autoEnabled) {
      this.logger.log('Auto-execution disabled by user');
      return false;
    }

    if (tradeValueUsd > userPolicy.maxPerTradeUsd) {
      this.logger.warn(
        `Trade value $${tradeValueUsd} exceeds max $${userPolicy.maxPerTradeUsd}`,
      );
      return false;
    }

    return true;
  }
}
