import { Injectable, Logger } from "@nestjs/common";

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
  approveSimulation(simulation: SimulationResult): GuardResult {
    this.logger.log("Running guard checks on simulation");

    this.logger.log("No user policy provided, skipping policy checks");

    // Still check for critical risks
    const violations: string[] = [];
    if (simulation.risks && simulation.risks.length > 0) {
      const criticalRisks = simulation.risks.filter((r) =>
        r.toLowerCase().includes("critical")
      );
      if (criticalRisks.length > 0) {
        violations.push(`Critical risks detected: ${criticalRisks.join(", ")}`);
      }
    }

    const approved = violations.length === 0;
    const result: GuardResult = {
      approved,
      reason: approved
        ? "No policy checks required, no critical risks"
        : `Critical risks found: ${violations.join("; ")}`,
      violations,
    };

    if (approved) {
      this.logger.log("✅ Simulation approved (no policy)");
    } else {
      this.logger.warn(`❌ Simulation rejected: ${result.reason}`);
    }

    return result;
  }

  /**
   * Additional pre-execution checks
   */
  validateExecution(plan: any): { valid: boolean; reason: string } {
    // Check for whitelisted protocols
    const allowedProtocols = ["AAVE", "EULER", "UniswapV3", "AerodromeCL"];

    for (const step of plan.steps || []) {
      if (!allowedProtocols.includes(step.protocol)) {
        return {
          valid: false,
          reason: `Protocol ${step.protocol} not in whitelist`,
        };
      }
    }

    return { valid: true, reason: "Validation passed" };
  }
}
