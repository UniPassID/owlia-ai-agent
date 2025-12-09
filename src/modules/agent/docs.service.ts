import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import Anthropic from '@anthropic-ai/sdk';
import { EnhancedRagService } from './enhanced-rag.service';


@Injectable()
export class DocService implements OnModuleInit {
  private readonly logger = new Logger(DocService.name);
  private mcpClient: Client;
  private anthropicClient: Anthropic;
  private model: string;
  private allTools: any[] = [];
  private lastRequestTime: number = 0;
  private minRequestInterval: number = 5000; // Minimum 5 seconds between requests
  private useRag: boolean = true; // Enable/disable RAG

  constructor(
    private configService: ConfigService,
    private ragService: EnhancedRagService,
  ) {}

  onModuleInit() {
    // Initialize Anthropic client
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }

    this.anthropicClient = new Anthropic({
      apiKey: apiKey,
    });

    this.model = this.configService.get<string>('MODEL') || 'claude-3-5-sonnet-20241022';
    this.logger.log(`DocService initialized with model: ${this.model}`);
  }

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

  /**
   * Fetch documentation content from the docs URL
   */
  private async fetchDocsContent(): Promise<string> {
    try {
      const docsUrl = 'https://owlia-docs.vercel.app/llms-full.txt?lang=en';
      const response = await fetch(docsUrl);

      if (!response.ok) {
        throw new Error(`Failed to fetch docs: ${response.statusText}`);
      }

      const contextText = await response.text();
      this.logger.log(`Fetched ${contextText.length} characters of documentation`);
      return contextText;
    } catch (error) {
      this.logger.error('Error fetching documentation:', error);
      throw error;
    }
  }

  /**
   * Answer user questions based on Owlia documentation
   * Uses RAG (Retrieval-Augmented Generation) for efficient context retrieval
   * Falls back to full document if RAG is not available
   */
  async answerWithDocs(userMessage: string, systemPrompt?: string): Promise<string> {
    await this.throttleRequest();

    // Use RAG to retrieve relevant documentation chunks, or fall back to full document
    let docsContent: string;
    if (this.useRag && this.ragService.isReady()) {
      this.logger.log('Using RAG for context retrieval');
      docsContent = await this.ragService.retrieveRelevantDocs(userMessage, 4);
    } else {
      this.logger.log('RAG not available, using full document');
      docsContent = await this.fetchDocsContent();
    }

    // Construct system prompt with documentation context
    const fullSystemPrompt = systemPrompt
      ? `${systemPrompt}\n\nDocument Content:\n${docsContent}`
      : `You are Owlia, a DeFi AI Co-pilot. Answer the user's question based on the provided document. Keep answers concise and helpful.\n\nDocument Content:\n${docsContent}`;

    const requestParams: Anthropic.MessageCreateParams = {
      model: this.model,
      max_tokens: 4096,
      system: fullSystemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    };

    this.logger.log('Running completion with documentation context');

    const response = await this.anthropicClient.messages.create(requestParams);

    // Extract text response
    const textContent = response.content.find(c => c.type === 'text');
    const result = textContent ? (textContent as any).text : '';

    this.logger.log(`Completion finished. Stop reason: ${response.stop_reason}`);
    this.logger.log(`Token usage - Input: ${response.usage.input_tokens}, Output: ${response.usage.output_tokens}`);

    return result;
  }
}
