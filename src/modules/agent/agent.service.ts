import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from './agent.prompt';

@Injectable()
export class AgentService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentService.name);
  private mcpClient: Client;
  private anthropicClient: Anthropic;
  private model: string;
  private allTools: any[] = [];
  private lastRequestTime: number = 0;
  private minRequestInterval: number = 5000; // Minimum 5 seconds between requests

  constructor(private configService: ConfigService) {}

  /**
   * Throttle API requests to avoid rate limits
   */
  private async throttleRequest(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - timeSinceLastRequest;
      this.logger.log(`Throttling request: waiting ${waitTime}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

  async onModuleInit() {
    const apiKey = this.configService.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is required but not set in environment variables',
      );
    }

    // Initialize Anthropic client
    this.anthropicClient = new Anthropic({ apiKey });
    this.model =
      this.configService.get('MODEL') || 'claude-3-5-sonnet-20241022';
    this.logger.log(`Using Anthropic model: ${this.model}`);

    // Initialize MCP client
    const mcpServerCommand =
      this.configService.get('MCP_SERVER_COMMAND') || 'npx';
    const mcpServerArgs =
      this.configService.get('MCP_SERVER_ARGS') ||
      '-y,@modelcontextprotocol/server-defi';
    const fullCommand = `${mcpServerCommand} ${mcpServerArgs.split(',').join(' ')}`;
    const [command, ...commandArgs] = fullCommand.split(' ');

    this.mcpClient = new Client(
      {
        name: 'owlia-agent-backend',
        version: '1.0.0',
      },
      {
        capabilities: {},
      },
    );

    try {
      const transport = new StdioClientTransport({
        command,
        args: commandArgs,
      });
      await this.mcpClient.connect(transport);
      this.logger.log('MCP Client connected');

      // List available tools
      const toolsResponse = await this.mcpClient.listTools();
      this.allTools = toolsResponse.tools || [];
      this.logger.log(`Loaded ${this.allTools.length} tools from MCP server`);
      this.allTools.forEach((tool) => {
        this.logger.log(`  - ${tool.name}`);
      });
    } catch (error) {
      this.logger.error(`Failed to connect to MCP Server: ${error.message}`);
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.mcpClient) {
      await this.mcpClient.close();
      this.logger.log('MCP Client connection closed');
    }
  }

  /**
   * Filter tools based on context to reduce token usage
   */
  private filterToolsForContext(trigger: string): any[] {
    // Essential tools for position fetching
    if (trigger === 'fetch_positions') {
      const allowedTools = ['get_idle_assets', 'get_active_investments'];
      return this.allTools.filter((tool) => allowedTools.includes(tool.name));
    }

    // Essential tools for rebalancing
    if (
      trigger === 'trigger_rebalance' ||
      trigger === 'manual_trigger' ||
      trigger === 'manual_preview' ||
      trigger === 'scheduled_monitor'
    ) {
      const allowedTools = [
        // Position data
        'get_idle_assets',
        'get_active_investments',
        'get_account_yield_summary',
        // Market data
        'get_dex_pools',
        'get_binance_depth',
        // Simulation
        'get_lp_simulate_batch',
        'get_supply_opportunities',
        // Analysis
        'analyze_strategy',
        'calculate_rebalance_cost_batch',
      ];
      return this.allTools.filter((tool) => allowedTools.includes(tool.name));
    }

    // For execution, only include execution tools
    if (trigger === 'execute_rebalance') {
      const allowedTools = ['rebalance_position'];
      return this.allTools.filter((tool) => allowedTools.includes(tool.name));
    }

    // Default: return all tools (fallback)
    return this.allTools;
  }

  /**
   * Directly execute an MCP tool and return parsed output.
   * Useful for lightweight data fetches outside of full agent runs.
   */
  async callMcpTool<T = any>(
    toolName: string,
    input: Record<string, any>,
  ): Promise<T> {
    if (!this.mcpClient) {
      throw new Error('MCP client not initialized');
    }

    const toolExists = this.allTools.some((tool) => tool.name === toolName);
    if (!toolExists) {
      throw new Error(`Tool ${toolName} is not available on MCP server`);
    }

    // await this.throttleRequest();
    this.logger.log(
      `Calling MCP tool ${toolName} with input ${JSON.stringify(input)}`,
    );

    const result = await this.mcpClient.callTool({
      name: toolName,
      arguments: input,
    });

    const resultText = result.content?.[0]?.text;
    if (!resultText) {
      this.logger.warn(`Tool ${toolName} returned empty content`);
      return result as unknown as T;
    }

    try {
      const parsed = JSON.parse(resultText);
      this.logger.log(
        `Tool ${toolName} returned keys: ${Object.keys(parsed).join(', ')}`,
      );
      return parsed as T;
    } catch {
      this.logger.warn(
        `Tool ${toolName} returned non-JSON content: ${resultText}`,
      );
      return resultText as unknown as T;
    }
  }

  /**
   * Run agent with Anthropic SDK (with checkpoint resume capability)
   */
  public async runAnthropicAgent(
    userMessage: string,
    forceToolUse: boolean = false,
    trigger: string = '',
    resumeState?: { messages: any[]; toolResults: any[]; currentTurn: number },
  ): Promise<any> {
    // Filter tools based on context to reduce token usage
    const filteredTools = trigger
      ? this.filterToolsForContext(trigger)
      : this.allTools;
    this.logger.log(
      `Using ${filteredTools.length} tools (filtered from ${this.allTools.length})`,
    );

    const tools = filteredTools.map((tool) => ({
      name: tool.name,
      description: tool.description || '',
      input_schema: tool.inputSchema || {
        type: 'object',
        properties: {},
        required: [],
      },
    }));

    // Resume from checkpoint or start fresh
    let messages: any[];
    let toolResults: any[];
    let currentTurn: number;

    if (resumeState) {
      this.logger.log(
        `Resuming from checkpoint: turn ${resumeState.currentTurn}, ${resumeState.toolResults.length} tool results`,
      );
      messages = resumeState.messages;
      toolResults = resumeState.toolResults;
      currentTurn = resumeState.currentTurn;
    } else {
      messages = [{ role: 'user', content: userMessage }];
      toolResults = [];
      currentTurn = 0;
    }

    const maxTurns = 10;

    while (currentTurn < maxTurns) {
      currentTurn++;
      this.logger.log(`Agent turn ${currentTurn}/${maxTurns}`);

      const requestParams: any = {
        model: this.model,
        max_tokens: 4096,
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' }, // Cache system prompt
          },
        ],
        messages,
        tools,
      };

      // Force tool use on first turn if requested
      if (currentTurn === 1 && forceToolUse) {
        requestParams.tool_choice = { type: 'any' };
      }

      let response;
      let retries = 0;
      const maxRetries = 3;
      const baseDelay = 30000; // 30 seconds base delay

      while (retries <= maxRetries) {
        try {
          // Throttle requests to avoid rate limits
          await this.throttleRequest();

          response = await this.anthropicClient.messages.create(requestParams);
          break; // Success, exit retry loop
        } catch (error) {
          // Handle rate limit errors with exponential backoff
          if (error.status === 429 && retries < maxRetries) {
            retries++;
            const delay = baseDelay * Math.pow(2, retries - 1); // Exponential backoff: 30s, 60s, 120s
            this.logger.warn(
              `Rate limit hit (attempt ${retries}/${maxRetries}), waiting ${delay / 1000} seconds before retry...`,
            );
            this.logger.log(
              `Checkpoint saved: turn ${currentTurn}, ${messages.length} messages, ${toolResults.length} tool results`,
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
            // Continue with same state - no need to restart
          } else {
            this.logger.error(
              `Request failed with error: ${error.status} ${error.message}`,
            );
            throw error;
          }
        }
      }

      if (!response) {
        throw new Error('Failed to get response after max retries');
      }

      // Check stop reason
      this.logger.log(
        `Turn ${currentTurn} stop reason: ${response.stop_reason}`,
      );
      this.logger.log(
        `Turn ${currentTurn} content types: ${response.content.map((c) => c.type).join(', ')}`,
      );

      if (
        response.stop_reason === 'end_turn' ||
        response.stop_reason === 'max_tokens'
      ) {
        // Extract final text response
        const textContent = response.content.find((c) => c.type === 'text');
        const finalText = textContent ? (textContent as any).text : '';

        this.logger.log(
          `Agent finished with stop_reason: ${response.stop_reason}`,
        );
        this.logger.log(`Total tool calls made: ${toolResults.length}`);
        this.logger.log(`Final response preview: ${finalText}...`);

        return {
          finalOutput: finalText,
          toolResults,
        };
      }

      if (response.stop_reason === 'tool_use') {
        // Process tool calls
        const toolUses = response.content.filter((c) => c.type === 'tool_use');

        // Add assistant message to history
        messages.push({ role: 'assistant', content: response.content });

        // Execute each tool
        const toolResultsContent: any[] = [];
        for (const toolUse of toolUses) {
          const toolData = toolUse as any;
          this.logger.log(
            `Calling tool: ${toolData.name} with args: ${JSON.stringify(toolData.input)}`,
          );

          try {
            const result = await this.mcpClient.callTool({
              name: toolData.name,
              arguments: toolData.input,
            });

            // Parse result
            const resultText =
              result.content?.[0]?.text || JSON.stringify(result);
            let parsedResult: any;
            try {
              parsedResult = JSON.parse(resultText);
            } catch {
              parsedResult = resultText;
            }

            toolResults.push({
              tool: toolData.name,
              input: toolData.input,
              output: parsedResult,
            });

            toolResultsContent.push({
              type: 'tool_result',
              tool_use_id: toolData.id,
              content: resultText,
            });

            // Log detailed output
            this.logger.log(`Tool ${toolData.name} completed`);
            this.logger.log(
              `Tool ${toolData.name} output preview: ${JSON.stringify(parsedResult)}`,
            );

            // Special logging for specific tools
            if (toolData.name === 'get_supply_opportunities') {
              const opportunities = parsedResult?.opportunities || parsedResult;
              this.logger.log(
                `get_supply_opportunities returned ${Array.isArray(opportunities) ? opportunities.length : 0} opportunities`,
              );
              if (Array.isArray(opportunities) && opportunities.length > 0) {
                this.logger.log(
                  `Top 3 opportunities: ${JSON.stringify(opportunities.slice(0, 3), null, 2)}`,
                );
              } else {
                this.logger.warn(
                  `get_supply_opportunities returned no opportunities. Full output: ${JSON.stringify(parsedResult)}`,
                );
              }
            }
          } catch (error) {
            this.logger.error(`Tool ${toolData.name} failed: ${error.message}`);
            toolResultsContent.push({
              type: 'tool_result',
              tool_use_id: toolData.id,
              content: `Error: ${error.message}`,
              is_error: true,
            });
          }
        }

        // Add tool results to messages
        messages.push({ role: 'user', content: toolResultsContent });
      } else {
        // Unexpected stop reason
        this.logger.warn(`Unexpected stop reason: ${response.stop_reason}`);
        const textContent = response.content.find((c) => c.type === 'text');
        return {
          finalOutput: textContent ? (textContent as any).text : '',
          toolResults,
        };
      }
    }

    return {
      finalOutput: 'Max turns reached',
      toolResults,
    };
  }

  /**
   * Run a simple text completion without tools (for prompt testing and text generation)
   */
  async runSimpleCompletion(
    userMessage: string,
    systemPrompt?: string,
  ): Promise<string> {
    await this.throttleRequest();

    const requestParams: any = {
      model: this.model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: userMessage }],
    };

    // Add system prompt if provided
    if (systemPrompt) {
      requestParams.system = systemPrompt;
    }

    this.logger.log('Running simple completion (no tools)');

    const response = await this.anthropicClient.messages.create(requestParams);

    // Extract text response
    const textContent = response.content.find((c) => c.type === 'text');
    const result = textContent ? (textContent as any).text : '';

    this.logger.log(
      `Completion finished. Stop reason: ${response.stop_reason}`,
    );
    this.logger.log(
      `Token usage - Input: ${response.usage.input_tokens}, Output: ${response.usage.output_tokens}`,
    );

    return result;
  }
}
