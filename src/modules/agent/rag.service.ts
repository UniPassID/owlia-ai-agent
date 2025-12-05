import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';

interface DocumentChunk {
  content: string;
  title: string;
  startIndex: number;
  endIndex: number;
}

@Injectable()
export class RagService implements OnModuleInit {
  private readonly logger = new Logger(RagService.name);
  private documentChunks: DocumentChunk[] = [];
  private fullDocument: string = '';
  private lastFetchTime: number = 0;
  private cacheExpiryMs: number = 3600000; // 1 hour
  private isInitialized = false;
  private readonly docsUrl = 'https://owlia-docs.vercel.app/llms-full.txt?lang=en';
  private autoRefreshEnabled: boolean = true; // Enable/disable auto-refresh

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    try {
      await this.fetchAndChunkDocumentation();
      this.isInitialized = true;
    } catch (error) {
      this.logger.warn('Failed to initialize RAG service during module init');
      this.logger.warn(error);
      this.isInitialized = false;
    }
  }

  /**
   * Fetch and split documentation into semantic chunks
   */
  private async fetchAndChunkDocumentation(): Promise<void> {
    try {
      const startTime = Date.now();
      this.logger.log('Fetching documentation...');

      const response = await fetch(this.docsUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch docs: ${response.statusText}`);
      }

      this.fullDocument = await response.text();
      this.lastFetchTime = Date.now();

      this.logger.log(`Fetched ${this.fullDocument.length} characters`);

      // Split by major sections (## headers)
      this.documentChunks = this.splitIntoChunks(this.fullDocument);

      const duration = Date.now() - startTime;

      // Calculate chunk statistics
      const avgChunkSize = Math.round(
        this.documentChunks.reduce((sum, chunk) => sum + chunk.content.length, 0) /
          this.documentChunks.length,
      );
      const maxChunkSize = Math.max(...this.documentChunks.map(c => c.content.length));
      const minChunkSize = Math.min(...this.documentChunks.map(c => c.content.length));

      this.logger.log(
        `✅ Documentation chunked successfully in ${duration}ms:\n` +
          `  - Total chunks: ${this.documentChunks.length}\n` +
          `  - Document size: ${this.fullDocument.length} chars\n` +
          `  - Avg chunk size: ${avgChunkSize} chars\n` +
          `  - Min/Max chunk: ${minChunkSize}/${maxChunkSize} chars\n` +
          `  - Sections: ${this.documentChunks.map(c => c.title).filter((v, i, a) => a.indexOf(v) === i).length} unique`,
      );
    } catch (error) {
      this.logger.error('Error fetching documentation:', error);
      throw error;
    }
  }

  /**
   * Split document into semantic chunks based on markdown headers
   */
  private splitIntoChunks(text: string): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];

    // Split by ## headers (major sections)
    const sections = text.split(/(?=\n## )/);

    for (const section of sections) {
      if (!section.trim()) continue;

      // Extract title from the first line
      const lines = section.split('\n');
      const titleLine = lines.find(line => line.startsWith('##'));
      const title = titleLine ? titleLine.replace(/^##\s*/, '').trim() : 'Introduction';

      // For large sections, split into smaller subsections
      if (section.length > 2000) {
        const subsections = section.split(/(?=\n### )/);
        for (const subsection of subsections) {
          if (subsection.trim()) {
            chunks.push({
              content: subsection,
              title,
              startIndex: text.indexOf(subsection),
              endIndex: text.indexOf(subsection) + subsection.length,
            });
          }
        }
      } else {
        chunks.push({
          content: section,
          title,
          startIndex: text.indexOf(section),
          endIndex: text.indexOf(section) + section.length,
        });
      }
    }

    return chunks;
  }

  /**
   * Simple keyword-based relevance scoring
   */
  private calculateRelevance(query: string, chunk: DocumentChunk): number {
    const queryLower = query.toLowerCase();
    const contentLower = chunk.content.toLowerCase();
    const titleLower = chunk.title.toLowerCase();

    let score = 0;

    // Keyword matching
    const keywords = queryLower.split(/\s+/).filter(word => word.length > 2);
    for (const keyword of keywords) {
      // Title matches are more important
      if (titleLower.includes(keyword)) {
        score += 10;
      }
      // Content matches
      const matches = contentLower.split(keyword).length - 1;
      score += matches * 2;
    }

    // Boost for exact phrase matches
    if (contentLower.includes(queryLower)) {
      score += 20;
    }

    return score;
  }

  /**
   * Retrieve relevant document chunks based on keyword matching
   */
  async retrieveRelevantDocs(query: string, topK: number = 4): Promise<string> {
    // Refresh cache if expired
    if (Date.now() - this.lastFetchTime > this.cacheExpiryMs) {
      this.logger.log('Document cache expired, refreshing...');
      await this.fetchAndChunkDocumentation();
    }

    if (this.documentChunks.length === 0) {
      this.logger.warn('No chunks available, returning full document');
      return this.fullDocument;
    }

    try {
      // Score all chunks
      const scoredChunks = this.documentChunks.map(chunk => ({
        chunk,
        score: this.calculateRelevance(query, chunk),
      }));

      // Sort by relevance and take top K
      const relevantChunks = scoredChunks
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .filter(item => item.score > 0); // Only include chunks with some relevance

      if (relevantChunks.length === 0) {
        this.logger.warn('No relevant chunks found, returning full document');
        return this.fullDocument;
      }

      // Concatenate relevant chunks
      const relevantText = relevantChunks
        .map((item, index) => {
          return `[Section ${index + 1}: ${item.chunk.title}]\n${item.chunk.content}`;
        })
        .join('\n\n---\n\n');

      const totalChars = relevantText.length;
      const reduction = ((1 - totalChars / this.fullDocument.length) * 100).toFixed(1);

      this.logger.log(
        `Retrieved ${relevantChunks.length} relevant chunks (${totalChars} chars, ${reduction}% reduction)`,
      );

      return relevantText;
    } catch (error) {
      this.logger.error('Error retrieving relevant docs:', error);
      return this.fullDocument;
    }
  }

  /**
   * Fetch full documentation
   */
  async fetchFullDocs(): Promise<string> {
    if (this.fullDocument && Date.now() - this.lastFetchTime < this.cacheExpiryMs) {
      return this.fullDocument;
    }

    await this.fetchAndChunkDocumentation();
    return this.fullDocument;
  }

  /**
   * Force refresh documentation
   */
  async refreshDocumentation(): Promise<void> {
    this.logger.log('Forcing documentation refresh...');
    await this.fetchAndChunkDocumentation();
    this.isInitialized = true;
  }

  /**
   * Scheduled task: Auto-refresh documentation every 5 minutes
   * This ensures the documentation is always up-to-date
   */
  @Cron('*/5 * * * *', {
    name: 'refresh-documentation',
  })
  async handleDocumentationRefresh() {
    if (!this.autoRefreshEnabled) {
      return;
    }

    try {
      this.logger.log('⏰ Scheduled documentation refresh triggered');
      await this.fetchAndChunkDocumentation();
      this.isInitialized = true;
      this.logger.log('✅ Scheduled refresh completed successfully');
    } catch (error) {
      this.logger.error('❌ Scheduled refresh failed:', error);
      // Don't throw - keep the service running even if refresh fails
    }
  }

  /**
   * Enable or disable auto-refresh
   */
  setAutoRefresh(enabled: boolean): void {
    this.autoRefreshEnabled = enabled;
    this.logger.log(`Auto-refresh ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check if RAG is properly initialized
   */
  isReady(): boolean {
    return this.isInitialized && this.documentChunks.length > 0;
  }

  /**
   * Get RAG statistics
   */
  async getStats(): Promise<{
    initialized: boolean;
    chunks: number;
    documentSize: number;
    cacheAge: number;
  }> {
    return {
      initialized: this.isInitialized,
      chunks: this.documentChunks.length,
      documentSize: this.fullDocument.length,
      cacheAge: Date.now() - this.lastFetchTime,
    };
  }
}
