import { Injectable, Logger } from '@nestjs/common';
import { AgentService } from '../agent/agent.service';
import { getRebalanceSummaryPrompt } from '../agent/agent.prompt';
import { TimelineMessage } from '../agent/types/chat';

@Injectable()
export class RebalanceSummaryService {
  private readonly logger = new Logger(RebalanceSummaryService.name);

  constructor(private readonly agentService: AgentService) {}

  /**
   * Generate execResult from rebalance log content
   * @param logContent The raw log content from rebalance execution
   * @returns TimelineMessage object for UI display
   */
  async generateExecResult(logContent: string): Promise<TimelineMessage | null> {
    try {
      this.logger.log('Generating execResult from log content...');

      // Generate prompt using the same method as test script
      const prompt = getRebalanceSummaryPrompt(logContent);

      // Call AgentService's simple completion method
      const summary = await this.agentService.runSimpleCompletion(prompt);

      // Extract JSON from response (AI might wrap it in markdown code blocks)
      const jsonMatch = summary.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.error('AI did not return valid JSON');
        this.logger.error('Raw response:', summary);
        return null;
      }

      // Parse JSON
      const parsed = JSON.parse(jsonMatch[0]) as TimelineMessage;

      // Validate field lengths
      this.validateFieldLengths(parsed);

      this.logger.log('Successfully generated execResult');
      return parsed;
    } catch (error) {
      this.logger.error(`Error generating execResult: ${error.message}`, error.stack);
      return null;
    }
  }

  /**
   * Validate field lengths to ensure they meet UI constraints
   */
  private validateFieldLengths(parsed: TimelineMessage): void {
    const titleLen = parsed.title?.length || 0;
    const summaryLen = parsed.summary?.length || 0;

    if (titleLen > 30) {
      this.logger.warn(`Title length (${titleLen}) exceeds 30 chars`);
    }
    if (summaryLen > 50) {
      this.logger.warn(`Summary length (${summaryLen}) exceeds 50 chars`);
    }

    if (parsed.steps && Array.isArray(parsed.steps)) {
      parsed.steps.forEach((step, idx) => {
        const contentLen = step.content?.length || 0;
        const reasonLen = step.metadata?.reason?.length || 0;

        // Step 0 has different limits
        if (idx === 0) {
          if (contentLen > 35) {
            this.logger.warn(`Step[${idx}].content length (${contentLen}) exceeds 35 chars`);
          }
          if (reasonLen > 100) {
            this.logger.warn(`Step[${idx}].reason length (${reasonLen}) exceeds 100 chars`);
          }
        } else {
          if (contentLen > 50) {
            this.logger.warn(`Step[${idx}].content length (${contentLen}) exceeds 50 chars`);
          }
          if (reasonLen > 300) {
            this.logger.warn(`Step[${idx}].reason length (${reasonLen}) exceeds 300 chars`);
          }
        }
      });
    }
  }
}
