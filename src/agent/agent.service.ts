import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import Anthropic from '@anthropic-ai/sdk';
import { AgentContext, AgentResult } from './agent.types';
import { SYSTEM_PROMPT, buildUserContext } from './agent.prompt';
import { buildExecutionPrompt } from './execution.prompt';
import { buildAnalysisPrompt } from './analysis.prompt';
import { extractTxHashFromOutput, verifyTransactionOnChain } from '../utils/chain-verifier.util';

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
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

  async onModuleInit() {
    const apiKey = this.configService.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required but not set in environment variables');
    }

    // Initialize Anthropic client
    this.anthropicClient = new Anthropic({ apiKey });
    this.model = this.configService.get('MODEL') || 'claude-3-5-sonnet-20241022';
    this.logger.log(`Using Anthropic model: ${this.model}`);

    // Initialize MCP client
    const mcpServerCommand = this.configService.get('MCP_SERVER_COMMAND') || 'npx';
    const mcpServerArgs = this.configService.get('MCP_SERVER_ARGS') || '-y,@modelcontextprotocol/server-defi';
    const fullCommand = `${mcpServerCommand} ${mcpServerArgs.split(',').join(' ')}`;
    const [command, ...commandArgs] = fullCommand.split(' ');

    this.mcpClient = new Client(
      {
        name: 'owlia-agent-backend',
        version: '1.0.0',
      },
      {
        capabilities: {
          prompts: {},
          tools: {},
        },
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
      this.allTools.forEach(tool => {
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
   * Convert MCP tools to Anthropic tool format
   */
  private convertMcpToolsToAnthropic(): any[] {
    return this.allTools.map(tool => ({
      name: tool.name,
      description: tool.description || '',
      input_schema: tool.inputSchema || { type: 'object', properties: {}, required: [] },
    }));
  }

  /**
   * Map chain names to chain IDs
   */
  private getChainId(chainName: string): string {
    const chainMap: Record<string, string> = {
      'base': '8453',
      'ethereum': '1',
      'eth': '1',
      'mainnet': '1',
      'arbitrum': '42161',
      'optimism': '10',
      'polygon': '137',
      'bsc': '56',
      'avalanche': '43114',
    };
    return chainMap[chainName.toLowerCase()] || chainName;
  }

  /**
   * Normalize protocol names to match execution tool requirements
   */
  private normalizeProtocolName(protocol: string): string {
    const protocolMap: Record<string, string> = {
      'aerodromecl': 'aerodromeSlipstream',
      'aerodrome': 'aerodromeSlipstream',
      'uniswapv3': 'uniswapV3',
      'aave': 'aave',
      'euler': 'euler',
      'venus': 'venus',
    };
    return protocolMap[protocol.toLowerCase()] || protocol;
  }

  /**
   * Convert chains array to chain_ids string
   */
  private convertChainsToIds(chains: string[]): string {
    return chains.map(chain => this.getChainId(chain)).join(',');
  }

  /**
   * Filter tools based on context to reduce token usage
   */
  private filterToolsForContext(trigger: string): any[] {
    // Essential tools for position fetching
    if (trigger === 'fetch_positions') {
      const allowedTools = [
        'get_idle_assets',
        'get_active_investments',
      ];
      return this.allTools.filter(tool => allowedTools.includes(tool.name));
    }

    // Essential tools for rebalancing
    if (trigger === 'trigger_rebalance' || trigger === 'manual_trigger' || trigger === 'manual_preview' || trigger === 'scheduled_monitor') {
      const allowedTools = [
        // Position data
        'get_idle_assets',
        'get_active_investments',
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
      return this.allTools.filter(tool => allowedTools.includes(tool.name));
    }

    // For execution, only include execution tools
    if (trigger === 'execute_rebalance') {
      const allowedTools = [
        'rebalance_position',
      ];
      return this.allTools.filter(tool => allowedTools.includes(tool.name));
    }

    // Default: return all tools (fallback)
    return this.allTools;
  }

  /**
   * Directly execute an MCP tool and return parsed output.
   * Useful for lightweight data fetches outside of full agent runs.
   */
  async callMcpTool<T = any>(toolName: string, input: Record<string, any>): Promise<T> {
    if (!this.mcpClient) {
      throw new Error('MCP client not initialized');
    }

    const toolExists = this.allTools.some(tool => tool.name === toolName);
    if (!toolExists) {
      throw new Error(`Tool ${toolName} is not available on MCP server`);
    }

    // await this.throttleRequest();
    this.logger.log(`Calling MCP tool ${toolName} with input ${JSON.stringify(input)}`);

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
      this.logger.log(`Tool ${toolName} returned keys: ${Object.keys(parsed).join(', ')}`);
      return parsed as T;
    } catch {
      this.logger.warn(`Tool ${toolName} returned non-JSON content: ${resultText}`);
      return resultText as unknown as T;
    }
  }

  /**
   * Wrapper with automatic retry and checkpoint resume for entire agent run
   */
  private async runAnthropicAgentWithRetry(
    userMessage: string,
    forceToolUse: boolean = false,
    trigger: string = ''
  ): Promise<any> {
    const maxGlobalRetries = 2;
    let globalRetry = 0;
    let lastCheckpoint: { messages: any[], toolResults: any[], currentTurn: number } | undefined;

    while (globalRetry <= maxGlobalRetries) {
      try {
        return await this.runAnthropicAgent(userMessage, forceToolUse, trigger, lastCheckpoint);
      } catch (error) {
        if (error.status === 429 && globalRetry < maxGlobalRetries) {
          globalRetry++;
          const delay = 60000 * globalRetry; // 60s, 120s
          this.logger.error(`Agent run failed with rate limit (global retry ${globalRetry}/${maxGlobalRetries})`);
          this.logger.log(`Waiting ${delay/1000}s before retrying entire run...`);

          // Try to extract checkpoint from error context if available
          // (In practice, the checkpoint is maintained within runAnthropicAgent)

          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw error;
        }
      }
    }

    throw new Error('Failed to complete agent run after max global retries');
  }

  /**
   * Run agent with Anthropic SDK (with checkpoint resume capability)
   */
  private async runAnthropicAgent(
    userMessage: string,
    forceToolUse: boolean = false,
    trigger: string = '',
    resumeState?: { messages: any[], toolResults: any[], currentTurn: number }
  ): Promise<any> {
    // Filter tools based on context to reduce token usage
    const filteredTools = trigger ? this.filterToolsForContext(trigger) : this.allTools;
    this.logger.log(`Using ${filteredTools.length} tools (filtered from ${this.allTools.length})`);

    const tools = filteredTools.map(tool => ({
      name: tool.name,
      description: tool.description || '',
      input_schema: tool.inputSchema || { type: 'object', properties: {}, required: [] },
    }));

    // Resume from checkpoint or start fresh
    let messages: any[];
    let toolResults: any[];
    let currentTurn: number;

    if (resumeState) {
      this.logger.log(`Resuming from checkpoint: turn ${resumeState.currentTurn}, ${resumeState.toolResults.length} tool results`);
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
          }
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
            this.logger.warn(`Rate limit hit (attempt ${retries}/${maxRetries}), waiting ${delay/1000} seconds before retry...`);
            this.logger.log(`Checkpoint saved: turn ${currentTurn}, ${messages.length} messages, ${toolResults.length} tool results`);
            await new Promise(resolve => setTimeout(resolve, delay));
            // Continue with same state - no need to restart
          } else {
            this.logger.error(`Request failed with error: ${error.status} ${error.message}`);
            throw error;
          }
        }
      }

      if (!response) {
        throw new Error('Failed to get response after max retries');
      }

      // Check stop reason
      this.logger.log(`Turn ${currentTurn} stop reason: ${response.stop_reason}`);
      this.logger.log(`Turn ${currentTurn} content types: ${response.content.map(c => c.type).join(', ')}`);

      if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
        // Extract final text response
        const textContent = response.content.find(c => c.type === 'text');
        const finalText = textContent ? (textContent as any).text : '';

        this.logger.log(`Agent finished with stop_reason: ${response.stop_reason}`);
        this.logger.log(`Total tool calls made: ${toolResults.length}`);
        this.logger.log(`Final response preview: ${finalText}...`);

        return {
          finalOutput: finalText,
          toolResults,
        };
      }

      if (response.stop_reason === 'tool_use') {
        // Process tool calls
        const toolUses = response.content.filter(c => c.type === 'tool_use');

        // Add assistant message to history
        messages.push({ role: 'assistant', content: response.content });

        // Execute each tool
        const toolResultsContent: any[] = [];
        for (const toolUse of toolUses) {
          const toolData = toolUse as any;
          this.logger.log(`Calling tool: ${toolData.name} with args: ${JSON.stringify(toolData.input).substring(0, 200)}`);

          try {
            const result = await this.mcpClient.callTool({
              name: toolData.name,
              arguments: toolData.input,
            });

            // Parse result
            const resultText = result.content?.[0]?.text || JSON.stringify(result);
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
            this.logger.log(`Tool ${toolData.name} output preview: ${JSON.stringify(parsedResult)}`);

            // Special logging for specific tools
            if (toolData.name === 'get_supply_opportunities') {
              const opportunities = parsedResult?.opportunities || parsedResult;
              this.logger.log(`get_supply_opportunities returned ${Array.isArray(opportunities) ? opportunities.length : 0} opportunities`);
              if (Array.isArray(opportunities) && opportunities.length > 0) {
                this.logger.log(`Top 3 opportunities: ${JSON.stringify(opportunities.slice(0, 3), null, 2)}`);
              } else {
                this.logger.warn(`get_supply_opportunities returned no opportunities. Full output: ${JSON.stringify(parsedResult)}`);
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
        const textContent = response.content.find(c => c.type === 'text');
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

  async runRebalanceAgent(context: AgentContext): Promise<AgentResult> {
    try {
      this.logger.log(`Starting agent run for job ${context.jobId}`);

      if(!['manual_trigger', 'manual_preview', 'scheduled_monitor', 'fetch_positions'].includes(context.trigger)) {
        this.logger.error(`unsupported trigger: ${context.trigger}`)
        return
      }

      // For manual_trigger or manual_preview, use local analysis prompt
      if (context.trigger === 'manual_trigger' || context.trigger === 'manual_preview' || context.trigger === 'scheduled_monitor') {
        const chainId = context.userPolicy.chains[0] || 'base';
        const chainIdNum = this.getChainId(chainId);

        this.logger.log('Using local analysis prompt template');
        this.logger.log(`Using chain_id: ${chainIdNum} (from chain: ${chainId})`);
        this.logger.log(`User address: ${context.userAddress}`);

        const analysisPrompt = buildAnalysisPrompt({
          address: context.userAddress,
          chainId: chainIdNum,
        });

        this.logger.log(`Analysis prompt length: ${analysisPrompt.length} characters`);

        // Run with automatic retry on rate limit
        const result = await this.runAnthropicAgentWithRetry(analysisPrompt, false, context.trigger);

        this.logger.log('Agent run completed with analysis prompt');

        // Extract simulation and plan from tool results or final output
        let simulation = null;
        let plan = null;

        // Try to find simulation and plan in tool results
        if (result.toolResults && result.toolResults.length > 0) {
          // Look for analyze_strategy or calculate_rebalance_cost_batch results
          const analysisResult = result.toolResults.find(
            r => r.tool === 'analyze_strategy' || r.tool === 'calculate_rebalance_cost_batch'
          );
          if (analysisResult && analysisResult.output) {
            simulation = analysisResult.output.simulation || analysisResult.output;
            plan = analysisResult.output.plan;
          }
        }

        // Try to parse structured JSON output from final output
        let structuredData = null;
        try {
          const jsonMatch = result.finalOutput.match(/```json\n([\s\S]*?)\n```/);
          if (jsonMatch) {
            structuredData = JSON.parse(jsonMatch[1]);
            this.logger.log('Successfully parsed structured JSON output');
            this.logger.log(`Structured data keys: ${Object.keys(structuredData).join(', ')}`);

            // Check if rebalancing is recommended
            if (structuredData.shouldRebalance === false) {
              this.logger.log('Agent recommends NOT rebalancing - insufficient improvement');

              // Return analysis without plan (no rebalancing needed)
              return {
                success: true,
                action: 'analyzed',
                data: {
                  simulation: null,
                  plan: null,
                  reasoning: structuredData.recommendation || result.finalOutput,
                  analysis: structuredData.analysis || {},
                  currentStrategy: structuredData.currentStrategy || {},
                  shouldRebalance: false,
                  toolResults: result.toolResults,
                },
              };
            }

            // Use structured data if available and rebalancing is beneficial
            if (structuredData.opportunities && structuredData.opportunities.length > 0) {
              this.logger.log(`Found ${structuredData.opportunities.length} opportunities in structured output`);

              // Normalize protocol names in opportunities
              const normalizedOpportunities = structuredData.opportunities.map(opp => ({
                ...opp,
                protocol: opp.protocol ? this.normalizeProtocolName(opp.protocol) : opp.protocol,
              }));

              plan = {
                description: 'Rebalance plan from structured analysis',
                recommendation: structuredData.recommendation || result.finalOutput,
                hasOpportunity: true,
                shouldRebalance: true,
                opportunities: normalizedOpportunities,
                currentPositions: structuredData.currentPositions || [],
                chainId: structuredData.chainId || chainIdNum,
                userAddress: structuredData.userAddress || context.userAddress,
              };
            }
          }
        } catch (e) {
          this.logger.warn(`Could not parse structured JSON from agent output: ${e.message}`);
        }

        // If we have tool results with positions and opportunities, consider it a successful analysis
        const hasPositionData = result.toolResults.some(
          r => r.tool === 'get_idle_assets' || r.tool === 'get_active_investments'
        );
        const hasOpportunities = result.toolResults.some(
          r => r.tool === 'get_supply_opportunities' || r.tool === 'get_lp_simulate_batch'
        );

        // Fallback: Extract opportunities data from tool results if no structured plan
        if (!plan) {
          const opportunitiesResult = result.toolResults.find(
            r => r.tool === 'get_supply_opportunities'
          );
          const lpSimulateResult = result.toolResults.find(
            r => r.tool === 'get_lp_simulate_batch'
          );

          let opportunitiesData = [];

          // Try to extract from supply opportunities
          if (opportunitiesResult?.output) {
            const supplyOps = opportunitiesResult.output.opportunities || opportunitiesResult.output;
            if (Array.isArray(supplyOps)) {
              opportunitiesData = supplyOps;
            }
          }

          // Try to extract from LP simulations
          if (lpSimulateResult?.output) {
            const lpOps = lpSimulateResult.output.results || lpSimulateResult.output;
            if (Array.isArray(lpOps)) {
              opportunitiesData = [...opportunitiesData, ...lpOps];
            }
          }

          this.logger.log(`Extracted ${opportunitiesData.length} opportunities from tool results`);

          // If we have a recommendation in the output, create a plan
          const hasRecommendation = result.finalOutput && (
            result.finalOutput.toLowerCase().includes('recommendation') ||
            result.finalOutput.toLowerCase().includes('recommended') ||
            result.finalOutput.toLowerCase().includes('rebalance') ||
            result.finalOutput.toLowerCase().includes('opportunity')
          );

          if (hasRecommendation || opportunitiesData.length > 0) {
            this.logger.log('Creating plan from tool results and recommendation text');
            plan = {
              description: 'Rebalance plan generated from analysis',
              recommendation: result.finalOutput,
              hasOpportunity: opportunitiesData.length > 0,
              opportunities: opportunitiesData,
              chainId: chainIdNum,
              userAddress: context.userAddress,
            };
          }
        }

        // Create a basic simulation result if we have opportunities but no simulation
        if (!simulation && hasOpportunities) {
          const opportunitiesResult = result.toolResults.find(
            r => r.tool === 'get_supply_opportunities'
          );
          if (opportunitiesResult && opportunitiesResult.output) {
            this.logger.log('Creating simulation from opportunities data');
            simulation = {
              opportunities: opportunitiesResult.output.opportunities || opportunitiesResult.output,
              hasOpportunity: true,
            };
          }
        }

        this.logger.log(`Final data - has simulation: ${!!simulation}, has plan: ${!!plan}`);
        if (simulation) {
          this.logger.log(`Simulation keys: ${Object.keys(simulation).join(', ')}`);
        }
        if (plan) {
          this.logger.log(`Plan keys: ${Object.keys(plan).join(', ')}`);
        }

        return {
          success: true,
          action: (simulation || plan || (hasPositionData && hasOpportunities)) ? 'simulated' : 'analyzed',
          data: {
            simulation,
            plan,
            reasoning: result.finalOutput,
            toolResults: result.toolResults,
          },
        };
      }

      const userContext = buildUserContext(context);
      const forceToolUse = context.trigger === 'fetch_positions';

      this.logger.log(`Running agent with forceToolUse=${forceToolUse}, trigger=${context.trigger}`);

      // Run with automatic retry on rate limit
      const result = await this.runAnthropicAgentWithRetry(userContext, forceToolUse, context.trigger);

      this.logger.log('Agent run completed');
      this.logger.log(`Tool results: ${result.toolResults.length}`);
      this.logger.log(`Final output length: ${result.finalOutput?.length || 0} characters`);

      // For fetch_positions, return tool results
      if (context.trigger === 'fetch_positions' && result.toolResults.length > 0) {
        // Combine idle_assets and active_investments
        const idleAssets = result.toolResults.find(t => t.tool === 'get_idle_assets')?.output;
        const activeInvestments = result.toolResults.find(t => t.tool === 'get_active_investments')?.output;

        return {
          success: true,
          action: 'analyzed',
          data: {
            idle_assets: idleAssets || null,
            active_investments: activeInvestments || null,
          },
        };
      }

      // For rebalancing tasks, extract simulation and plan
      let simulation = null;
      let plan = null;

      try {
        // Look for JSON blocks in the output
        const jsonMatch = result.finalOutput.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[1]);
          simulation = data.simulation;
          plan = data.plan;
        }
      } catch (e) {
        this.logger.warn('Could not parse structured data from agent output');
      }

      return {
        success: true,
        action: simulation ? 'simulated' : 'analyzed',
        data: {
          simulation,
          plan,
          reasoning: result.finalOutput,
        },
      };
    } catch (error) {
      this.logger.error(`Agent run failed: ${error.status || 'unknown'} ${error.message}`);

      return {
        success: false,
        action: 'rejected',
        error: error.message,
      };
    }
  }

  async executeRebalance(
    userId: string,
    plan: any,
    idempotencyKey: string,
    userAddress?: string,
  ): Promise<any> {
    try {
      this.logger.log(`Executing rebalance for user ${userId}`);

      // Get safe address and chain ID
      const safeAddress = userAddress || plan?.safeAddress || plan?.userAddress || plan?.address;
      const chainId = plan?.chainId || '8453'; // Default to Base

      if (!safeAddress) {
        throw new Error('safeAddress is required but not found in plan or parameters');
      }

      this.logger.log(`Preparing execution with safeAddress: ${safeAddress}, chainId: ${chainId}`);

      // Use the execution prompt template
      const executeMessage = buildExecutionPrompt({
        userId,
        safeAddress,
        idempotencyKey,
        plan,
        chainId,
      });

      this.logger.log(`Using execution prompt template (length: ${executeMessage.length})`);

      const result = await this.runAnthropicAgentWithRetry(executeMessage, false, 'execute_rebalance');

      // Try to parse execution result from output
      let execResult = null;
      try {
        const jsonMatch = result.finalOutput.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch) {
          execResult = JSON.parse(jsonMatch[1]);
        }
      } catch (e) {
        this.logger.warn('Could not parse execution result from agent output');
      }

      // Also check tool results for execution output
      if (!execResult && result.toolResults) {
        const executeResult = result.toolResults.find(
          r => r.tool === 'execute_steps' || r.tool === 'swap' || r.tool === 'add_liquidity'
        );
        if (executeResult && executeResult.output) {
          execResult = executeResult.output;
        }
      }

      // If no structured result, try to extract tx hash from output
      if (!execResult || !execResult.success) {
        const output = result.finalOutput || execResult?.output || '';
        const txHash = extractTxHashFromOutput(output);

        this.logger.log(`Extracted tx hash from output: ${txHash || 'none'}`);

        if (txHash) {
          // Verify transaction on chain
          this.logger.log(`Verifying transaction ${txHash} on chain ${chainId}`);
          const verificationResult = await verifyTransactionOnChain(txHash, chainId);

          this.logger.log(`Verification result: ${JSON.stringify(verificationResult)}`);

          if (verificationResult.success && verificationResult.confirmed) {
            // Transaction confirmed successfully on chain
            return {
              success: true,
              txHash,
              transactionHash: txHash,
              blockNumber: verificationResult.blockNumber,
              status: 'confirmed',
              output,
            };
          } else if (verificationResult.success && !verificationResult.confirmed) {
            // Transaction submitted but failed on chain
            return {
              success: false,
              txHash,
              transactionHash: txHash,
              blockNumber: verificationResult.blockNumber,
              status: 'failed',
              error: 'Transaction failed on chain',
              output,
            };
          } else {
            // Transaction not found or pending
            return {
              success: false,
              txHash,
              transactionHash: txHash,
              status: 'pending',
              error: verificationResult.error || 'Transaction not confirmed',
              output,
            };
          }
        }
      }

      return execResult || {
        success: false,
        error: 'No execution result found in agent response',
        output: result.finalOutput,
      };
    } catch (error) {
      this.logger.error(`Execute rebalance failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
