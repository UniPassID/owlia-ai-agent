import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Agent, run, MCPServerStdio, getAllMcpTools, withTrace, setDefaultOpenAIClient, setOpenAIAPI } from '@openai/agents';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { OpenAI } from 'openai';
import { AgentContext, AgentResult } from './agent.types';
import { SYSTEM_PROMPT, buildUserContext } from './agent.prompt';

@Injectable()
export class AgentService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentService.name);
  private mcpServer: MCPServerStdio;
  private mcpClient: Client; // Direct MCP client for accessing prompts
  private model: string;
  private allTools: any[] = [];

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    // Check if using Anthropic (Claude) or OpenAI
    const useAnthropic = this.configService.get('USE_ANTHROPIC') === 'true';
    const apiKey = useAnthropic
      ? this.configService.get('ANTHROPIC_API_KEY')
      : this.configService.get('OPENAI_API_KEY');

    if (!apiKey) {
      throw new Error(`${useAnthropic ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} is required but not set in environment variables`);
    }

    // Configure the OpenAI client
    if (useAnthropic) {
      // Anthropic only supports chat_completions API, not responses API
      setOpenAIAPI('chat_completions');

      // Use Anthropic's OpenAI SDK compatibility layer
      const anthropicClient = new OpenAI({
        apiKey: apiKey,
        baseURL: 'https://api.anthropic.com/v1/',
      });
      setDefaultOpenAIClient(anthropicClient);
      this.logger.log('Anthropic API configured (OpenAI SDK compatibility mode with chat_completions)');
    } else {
      // Standard OpenAI client
      const openaiClient = new OpenAI({
        apiKey: apiKey,
      });
      setDefaultOpenAIClient(openaiClient);
      this.logger.log('OpenAI API key configured');
    }

    const model = this.configService.get('MODEL') ||
                  (useAnthropic ? 'claude-sonnet-4-5' : 'gpt-4o');
    const mcpServerCommand = this.configService.get('MCP_SERVER_COMMAND') || 'npx';
    const mcpServerArgs = this.configService.get('MCP_SERVER_ARGS') || '-y,@modelcontextprotocol/server-defi';

    this.model = model;
    this.logger.log(`Using model: ${model} (${useAnthropic ? 'Anthropic' : 'OpenAI'})`);

    // Build full MCP server command
    const fullCommand = `${mcpServerCommand} ${mcpServerArgs.split(',').join(' ')}`;
    const [command, ...commandArgs] = fullCommand.split(' ');

    // Initialize MCP Server connection (only once - this is expensive)
    this.mcpServer = new MCPServerStdio({
      name: 'DeFi MCP Server',
      fullCommand,
    });

    // Also initialize direct MCP client for accessing prompts
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
      await this.mcpServer.connect();
      this.logger.log(`MCP Server connected: ${fullCommand}`);

      // Connect MCP client for prompts
      const transport = new StdioClientTransport({
        command,
        args: commandArgs,
      });
      await this.mcpClient.connect(transport);
      this.logger.log('MCP Client connected for prompts access');

      // Fetch all available tools from MCP servers (must be within a trace context)
      await withTrace('Initialize MCP Tools', async () => {
        this.allTools = await getAllMcpTools([this.mcpServer]);
        this.logger.log(`Loaded ${this.allTools.length} tools from MCP servers`);
      });

      this.logger.log(`Agent will use model ${model} with fresh context per run`);
    } catch (error) {
      this.logger.error(`Failed to connect to MCP Server: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create a fresh agent instance with clean context
   * This ensures no context pollution between different user requests
   */
  private createAgent(forceToolUse?: boolean): Agent {
    const agentConfig: any = {
      name: 'DeFi Rebalance Agent',
      model: this.model,
      instructions: SYSTEM_PROMPT,
      tools: this.allTools, // Use pre-fetched tools
    };

    // Force tool usage for Anthropic models (use Claude's "any" type)
    if (forceToolUse) {
      agentConfig.modelSettings = {
        tool_choice: { type: 'any' },
      };
    }

    return new Agent(agentConfig);
  }

  async onModuleDestroy() {
    if (this.mcpServer) {
      await this.mcpServer.close();
      this.logger.log('MCP Server connection closed');
    }
    if (this.mcpClient) {
      await this.mcpClient.close();
      this.logger.log('MCP Client connection closed');
    }
  }

  async runRebalanceAgent(context: AgentContext): Promise<AgentResult> {
    try {
      this.logger.log(`Starting agent run for job ${context.jobId}`);

      // For manual_trigger or manual_preview, try to use MCP prompt
      if (context.trigger === 'manual_trigger' || context.trigger === 'manual_preview') {
        // Get the prompt from MCP server
        // Note: MCP prompt expects chain_id (single chain), not chains (multiple)
        const chainId = context.userPolicy.chains[0] || 'base'; // Use first chain or default to base

        try {
          this.logger.log('Attempting to get complete_defi_analysis prompt from MCP');
          this.logger.log(`Context chains: ${JSON.stringify(context.userPolicy.chains)}`);

          this.logger.log(`Using chain_id: ${chainId} (from chains array: [${context.userPolicy.chains.join(', ')}])`);
          this.logger.log(`User address: ${context.userAddress}`);

          const promptResult = await this.mcpClient.getPrompt({
            name: 'complete_defi_analysis',
            arguments: {
              address: context.userAddress,
              chain_id: chainId,
            },
          });

          this.logger.log('Successfully got MCP prompt');
          this.logger.log(`Prompt description: ${promptResult.description || 'N/A'}`);
          console.log('promptResult', promptResult)
          

          // Extract the prompt messages
          const messages = promptResult.messages || [];
          const userMessage = messages.find(m => m.role === 'user');

          if (userMessage && userMessage.content) {
            // Extract text from content (could be array of content blocks)
            let promptText = '';
            if (typeof userMessage.content === 'string') {
              promptText = userMessage.content;
            } else if (Array.isArray(userMessage.content)) {
              // Find text content block
              const textBlock = userMessage.content.find(c => c.type === 'text');
              promptText = textBlock?.text || '';
            } else if (userMessage.content.type === 'text') {
              promptText = userMessage.content.text;
            }

            if (promptText) {
              this.logger.log('Creating agent and running with MCP prompt...');
              this.logger.log(`Prompt text length: ${promptText.length} characters`);
              this.logger.log(`Prompt preview: ${promptText}...`);

              const agent = this.createAgent();
              const result = await run(agent, promptText);

              this.logger.log('Agent run completed with MCP prompt');
              this.logger.log(`Total items in history: ${result.history?.length || 0}`);
              this.logger.log(`New items generated: ${result.newItems?.length || 0}`);
              this.logger.log(`Final output length: ${result.finalOutput?.length || 0} characters`);

              // Log agent execution details
              if (result.newItems && result.newItems.length > 0) {
                this.logger.log('--- Agent Execution Steps ---');
                result.newItems.forEach((item, idx) => {
                  this.logger.log(`Step ${idx + 1}: ${item.type}`);
                  if (item.type === 'tool_call_item') {
                    this.logger.log(`  Tool: ${(item as any).functionName}`);
                    this.logger.log(`  Args: ${JSON.stringify((item as any).arguments).substring(0, 200)}`);
                  }
                  if (item.type === 'tool_call_output_item') {
                    this.logger.log(`  Tool Output: ${JSON.stringify((item as any).output).substring(0, 200)}`);
                  }
                  if (item.type === 'message_output_item') {
                    const content = (item as any).content;
                    if (content) {
                      const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
                      this.logger.log(`  Content: ${contentStr.substring(0, 150)}`);
                    }
                  }
                });
                this.logger.log('--- End of Execution Steps ---');
              }

              return {
                success: true,
                action: 'analyzed',
                data: result.finalOutput,
              };
            }
          }
        } catch (promptError) {
          // Handle rate limit errors specifically
          if (promptError.status === 429) {
            this.logger.warn(`Rate limit hit: ${promptError.message}`);
            const retryAfter = promptError.headers?.['retry-after'];
            if (retryAfter) {
              this.logger.log(`Rate limit - should retry after ${retryAfter} seconds`);
            }
            // Extract wait time from error message
            const waitMatch = promptError.message.match(/try again in ([\d.]+)s/);
            if (waitMatch) {
              const waitSeconds = parseFloat(waitMatch[1]);
              this.logger.log(`Waiting ${waitSeconds} seconds before retrying...`);
              await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));

              // Retry once
              try {
                this.logger.log('Retrying MCP prompt after rate limit wait...');
                const promptResult = await this.mcpClient.getPrompt({
                  name: 'complete_defi_analysis',
                  arguments: {
                    address: context.userAddress,
                    chain_id: chainId,
                  },
                });

                // Process the retry result
                const messages = promptResult.messages || [];
                const userMessage = messages.find(m => m.role === 'user');
                if (userMessage && userMessage.content) {
                  let promptText = '';
                  if (typeof userMessage.content === 'string') {
                    promptText = userMessage.content;
                  } else if (Array.isArray(userMessage.content)) {
                    const textBlock = userMessage.content.find(c => c.type === 'text');
                    promptText = textBlock?.text || '';
                  } else if (userMessage.content.type === 'text') {
                    promptText = userMessage.content.text;
                  }

                  if (promptText) {
                    const agent = this.createAgent();
                    const result = await run(agent, promptText);
                    return {
                      success: true,
                      action: 'analyzed',
                      data: result.finalOutput,
                    };
                  }
                }
              } catch (retryError) {
                this.logger.error(`Retry failed: ${retryError.message}`);
              }
            }
          } else {
            this.logger.warn(`Failed to get MCP prompt: ${promptError.message}`);
          }
          // Fall through to standard flow
        }
      }

      const userContext = buildUserContext(context);

      // Log available tools for debugging
      this.logger.log(`Available tools: ${this.allTools.length}`);
      this.allTools.forEach(tool => {
        this.logger.log(`  - ${tool.function?.name || tool.name}`);
      });

      // Create fresh agent instance for clean context
      // This prevents context pollution between different users/jobs
      // For fetch_positions, force tool usage
      const forceToolUse = context.trigger === 'fetch_positions';
      const agent = this.createAgent(forceToolUse);

      this.logger.log(`Agent created with forceToolUse=${forceToolUse}`);
      if (forceToolUse) {
        this.logger.log('Tool choice set to: { type: "any" }');
      }

      const result = await run(agent, userContext);

      this.logger.log('Agent run completed');
      this.logger.log(`Result details: turns=${result.state._currentTurn}, items=${result.state._generatedItems.length}`);

      // Debug: log the last response
      if (result.state._lastTurnResponse) {
        this.logger.log('Last turn response:');
        this.logger.log(`  - response ID: ${result.state._lastTurnResponse.responseId}`);
        this.logger.log(`  - output items: ${result.state._lastTurnResponse.output?.length || 0}`);
        if (result.state._lastTurnResponse.output) {
          result.state._lastTurnResponse.output.forEach((item: any, idx: number) => {
            this.logger.log(`    [${idx}] type: ${item.type}`);
            if (item.type === 'function') {
              this.logger.log(`        function: ${item.name}`);
            }
          });
        }
      }

      // Parse the result to extract simulation and plan data
      // Note: result.finalOutput contains the agent's final response
      // Tool calls and their results are handled internally by the SDK

      const output = result.finalOutput;

      // For fetch_positions, extract tool output data from newItems
      if (context.trigger === 'fetch_positions') {
        console.log('output', result)

        // Try to extract tool output from newItems first
        if (result.newItems && result.newItems.length > 0) {
          let toolOutputData = null;

          // Find the last tool_call_output_item which usually contains the combined result
          for (let i = result.newItems.length - 1; i >= 0; i--) {
            const item = result.newItems[i];
            if (item.type === 'tool_call_output_item') {
              const itemOutput = (item as any).output;
              if (itemOutput && typeof itemOutput === 'object') {
                toolOutputData = itemOutput;
                break;
              }
            }
          }

          if (toolOutputData) {
            this.logger.log('Extracted tool output data from newItems');
            return {
              success: true,
              action: 'analyzed',
              data: toolOutputData,
            };
          }
        }

        // Fallback: try to parse JSON from text output
        try {
          const jsonMatch = output.match(/```json\n([\s\S]*?)\n```/);
          if (jsonMatch) {
            const positionsData = JSON.parse(jsonMatch[1]);
            return {
              success: true,
              action: 'analyzed',
              data: positionsData, // Return clean JSON data
            };
          }
        } catch (e) {
          this.logger.warn('Could not parse positions data from agent output');
        }
      }

      // For rebalancing tasks, extract simulation and plan
      let simulation = null;
      let plan = null;

      try {
        // Look for JSON blocks in the output
        const jsonMatch = output.match(/```json\n([\s\S]*?)\n```/);
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
          reasoning: output,
        },
      };
    } catch (error) {
      // Handle API errors
      this.logger.error(`Agent run failed: ${error.status || 'unknown'} ${error.message}`);
      if (error.response) {
        this.logger.error(`Response body: ${JSON.stringify(error.response)}`);
      }
      if (error.request) {
        this.logger.error(`Request: ${JSON.stringify(error.request)}`);
      }

      if (error.status === 429) {
        this.logger.error('API quota exceeded. Please check billing settings.');
        return {
          success: false,
          action: 'rejected',
          error: 'API quota exceeded. Please add payment method or check billing settings.',
        };
      }

      if (error.status === 404) {
        this.logger.error('404 error - this may indicate incompatibility between Anthropic API and OpenAI Agents SDK');
        this.logger.error('Consider switching to OpenAI or using a different integration method');
      }

      return {
        success: false,
        action: 'rejected',
        error: error.message,
      };
    }
  }

  /**
   * Execute rebalance by running agent with execution instruction
   * This is called after guard approval
   */
  async executeRebalance(
    userId: string,
    plan: any,
    idempotencyKey: string,
  ): Promise<any> {
    try {
      this.logger.log(`Executing rebalance for user ${userId}`);

      const executeMessage = `Execute the following approved rebalance plan for user ${userId}:

Plan: ${JSON.stringify(plan, null, 2)}
Idempotency Key: ${idempotencyKey}

Use the execute_steps tool to perform the on-chain execution. Return the execution result in JSON format.`;

      // Create fresh agent instance for clean context
      const agent = this.createAgent();
      const result = await run(agent, executeMessage);

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
