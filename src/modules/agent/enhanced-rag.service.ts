import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { TfIdf, WordTokenizer } from 'natural';

interface DocumentChunk {
  content: string;
  title: string;
  startIndex: number;
  endIndex: number;
  embedding?: number[];
}

interface ScoredChunk {
  chunk: DocumentChunk;
  score: number;
  bm25Score: number;
  semanticScore: number;
  originalIndex: number;
}

@Injectable()
export class EnhancedRagService implements OnModuleInit {
  private readonly logger = new Logger(EnhancedRagService.name);
  private documentChunks: DocumentChunk[] = [];
  private fullDocument: string = '';
  private lastFetchTime: number = 0;
  private cacheExpiryMs: number = 3600000; // 1 hour
  private isInitialized = false;
  private readonly docsUrl = 'https://owlia-docs.vercel.app/llms-full.txt?lang=en';
  private autoRefreshEnabled: boolean = true;

  // TF-IDF components
  private tfidf: TfIdf | null = null;
  private tokenizer: WordTokenizer;

  // Embedding model (lightweight, runs locally)
  private embeddingModel: any = null;
  private readonly modelName = 'Xenova/all-MiniLM-L6-v2'; // 80MB, very fast

  constructor(private configService: ConfigService) {
    this.tokenizer = new WordTokenizer();
  }

  async onModuleInit() {
    try {
      this.logger.log('Initializing Enhanced RAG service...');

      // Note: Embedding model disabled due to ESM compatibility issues
      // Enhanced RAG will use TF-IDF only (still better than Basic RAG)
      // To enable embeddings, see ENHANCED_RAG_GUIDE.md

      // Fetch and process documents
      await this.fetchAndChunkDocumentation();
      this.isInitialized = true;

      this.logger.log('✅ Enhanced RAG service initialized (TF-IDF mode)');
    } catch (error) {
      this.logger.warn('Failed to initialize Enhanced RAG service during module init');
      this.logger.warn(error);
      this.isInitialized = false;
    }
  }

  /**
   * Load embedding model (runs locally, no API needed)
   */
  private async loadEmbeddingModel(): Promise<void> {
    try {
      this.logger.log(`Loading embedding model: ${this.modelName}...`);

      // Dynamic import for ESM module
      const { pipeline } = await import('@xenova/transformers');
      this.embeddingModel = await pipeline('feature-extraction', this.modelName);

      this.logger.log('✅ Embedding model loaded successfully');
    } catch (error) {
      this.logger.error('Failed to load embedding model:', error);
      throw error;
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

      // Split into chunks
      this.documentChunks = this.splitIntoChunks(this.fullDocument);

      // Build TF-IDF index
      this.buildTfIdfIndex();

      // Generate embeddings if model is ready
      if (this.embeddingModel) {
        await this.generateEmbeddings();
      }

      const duration = Date.now() - startTime;

      // Calculate statistics
      const avgChunkSize = Math.round(
        this.documentChunks.reduce((sum, chunk) => sum + chunk.content.length, 0) /
          this.documentChunks.length,
      );

      this.logger.log(
        `✅ Documentation processed in ${duration}ms:\n` +
          `  - Total chunks: ${this.documentChunks.length}\n` +
          `  - Document size: ${this.fullDocument.length} chars\n` +
          `  - Avg chunk size: ${avgChunkSize} chars\n` +
          `  - TF-IDF index: ${this.tfidf ? '✓' : '✗'}\n` +
          `  - Embeddings: ${this.documentChunks[0]?.embedding ? '✓' : '✗'}`,
      );
    } catch (error) {
      this.logger.error('Error fetching documentation:', error);
      throw error;
    }
  }

  /**
   * Split document into semantic chunks
   */
  private splitIntoChunks(text: string): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    let currentParentTitle = '';

    const sections = text.split(/(?=\n## )/);

    for (const section of sections) {
      if (!section.trim()) continue;

      const sectionLines = section.split('\n');

      // Find parent # title in this section
      const parentLine = sectionLines.find(line => line.match(/^#\s+[^#]/));
      if (parentLine) {
        currentParentTitle = parentLine.replace(/^#\s*/, '').split('(')[0].trim();
      }

      // Extract ## title
      const titleLine = sectionLines.find(line => line.startsWith('##'));
      const baseTitle = titleLine ? titleLine.replace(/^##\s*/, '').trim() : 'Introduction';

      // Combine with parent title if exists
      const title = currentParentTitle ? `${currentParentTitle} - ${baseTitle}` : baseTitle;

      if (section.length > 5000) {
        const subsections = section.split(/(?=\n### )/);

        if (subsections.length > 1) {
          for (const subsection of subsections) {
            if (subsection.trim()) {
              const subTitleLine = subsection.split('\n').find(line => line.startsWith('###'));
              const subTitle = subTitleLine
                ? `${title} - ${subTitleLine.replace(/^###\s*/, '').trim()}`
                : title;

              chunks.push({
                content: subsection,
                title: subTitle,
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
   * Build TF-IDF index for keyword-based retrieval
   */
  private buildTfIdfIndex(): void {
    try {
      this.tfidf = new TfIdf();

      for (const chunk of this.documentChunks) {
        // Combine title and content, giving title more weight by repeating it
        const text = `${chunk.title} ${chunk.title} ${chunk.title} ${chunk.content}`;
        this.tfidf.addDocument(text.toLowerCase());
      }

      this.logger.log('TF-IDF index built successfully');
    } catch (error) {
      this.logger.error('Failed to build TF-IDF index:', error);
      this.tfidf = null;
    }
  }

  /**
   * Generate embeddings for all chunks
   */
  private async generateEmbeddings(): Promise<void> {
    if (!this.embeddingModel) return;

    try {
      this.logger.log('Generating embeddings for chunks...');
      const startTime = Date.now();

      for (const chunk of this.documentChunks) {
        // Combine title and content for embedding
        const text = `${chunk.title}\n\n${chunk.content}`;
        chunk.embedding = await this.getEmbedding(text);
      }

      const duration = Date.now() - startTime;
      this.logger.log(`✅ Generated ${this.documentChunks.length} embeddings in ${duration}ms`);
    } catch (error) {
      this.logger.error('Failed to generate embeddings:', error);
    }
  }

  /**
   * Get embedding for a text
   */
  private async getEmbedding(text: string): Promise<number[]> {
    if (!this.embeddingModel) {
      throw new Error('Embedding model not loaded');
    }

    const output = await this.embeddingModel(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * Hybrid retrieval: BM25 + Semantic similarity
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
      const startTime = Date.now();

      // Get TF-IDF scores
      const tfidfScores = await this.getTfIdfScores(query);

      // Get semantic similarity scores
      const semanticScores = await this.getSemanticScores(query);

      // Combine scores (weighted hybrid)
      // Note: Currently using TF-IDF only due to embedding compatibility issues
      const tfidfWeight = 1.0; // TF-IDF for keyword matching
      const semanticWeight = 0.0; // Semantic disabled (ESM issues)

      const scoredChunks: ScoredChunk[] = this.documentChunks.map((chunk, index) => {
        const tfidfScore = tfidfScores[index];
        const semanticScore = semanticScores[index];

        // Normalize scores to [0, 1]
        const normalizedTfIdf = this.normalizeScore(tfidfScore, tfidfScores);
        const normalizedSemantic = this.normalizeScore(semanticScore, semanticScores);

        // Hybrid score
        const hybridScore = tfidfWeight * normalizedTfIdf + semanticWeight * normalizedSemantic;

        return {
          chunk,
          score: hybridScore,
          bm25Score: normalizedTfIdf,
          semanticScore: normalizedSemantic,
          originalIndex: index,
        };
      });

      // Sort and take top K
      let relevantChunks = scoredChunks
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .filter(item => item.score > 0.1); // Threshold

      if (relevantChunks.length === 0) {
        this.logger.warn('No relevant chunks found, returning full document');
        return this.fullDocument;
      }

      // Merge adjacent chunks
      relevantChunks = this.mergeAdjacentChunks(relevantChunks);

      // Sort by document position
      relevantChunks.sort((a, b) => a.chunk.startIndex - b.chunk.startIndex);

      // Deduplicate
      const deduplicatedChunks = this.deduplicateChunks(relevantChunks);

      // Format output
      const relevantText = deduplicatedChunks
        .map((item, index) => {
          return `[Section ${index + 1}: ${item.chunk.title}]\n${item.chunk.content}`;
        })
        .join('\n\n---\n\n');

      const duration = Date.now() - startTime;
      const totalChars = relevantText.length;
      const reduction = ((1 - totalChars / this.fullDocument.length) * 100).toFixed(1);

      this.logger.log(
        `Retrieved ${deduplicatedChunks.length} chunks in ${duration}ms (${totalChars} chars, ${reduction}% reduction)`,
      );

      // Log top chunk scores for debugging
      if (deduplicatedChunks.length > 0) {
        const topChunk = deduplicatedChunks[0];
        this.logger.debug(
          `Top chunk: "${topChunk.chunk.title}" (hybrid: ${topChunk.score.toFixed(3)}, bm25: ${topChunk.bm25Score.toFixed(3)}, semantic: ${topChunk.semanticScore.toFixed(3)})`,
        );
      }

      return relevantText;
    } catch (error) {
      this.logger.error('Error retrieving relevant docs:', error);
      return this.fullDocument;
    }
  }

  /**
   * Get TF-IDF scores for query
   */
  private async getTfIdfScores(query: string): Promise<number[]> {
    if (!this.tfidf) {
      this.logger.warn('TF-IDF not available, returning zero scores');
      return new Array(this.documentChunks.length).fill(0);
    }

    const scores: number[] = [];
    const queryTokens = this.tokenizer.tokenize(query.toLowerCase());

    // Stop words to filter out (English + Chinese + Product name)
    const stopWords = new Set([
      'the', 'is', 'at', 'which', 'on', 'in', 'to', 'for', 'of', 'and', 'or', 'a', 'an', 'as', 'by', 'with', 'from', 'what', 'how', 'are', 'does', 'it',
      '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这',
      'owlia'
    ]);

    // Filter stop words
    const filteredTokens = queryTokens.filter(token => !stopWords.has(token) && token.length > 2);

    // Calculate TF-IDF score for each document
    for (let i = 0; i < this.documentChunks.length; i++) {
      let score = 0;
      for (const term of filteredTokens) {
        score += this.tfidf.tfidf(term, i);
      }
      scores.push(score);
    }

    return scores;
  }

  /**
   * Get semantic similarity scores for query
   */
  private async getSemanticScores(query: string): Promise<number[]> {
    if (!this.embeddingModel || !this.documentChunks[0]?.embedding) {
      this.logger.warn('Embeddings not available, returning zero scores');
      return new Array(this.documentChunks.length).fill(0);
    }

    try {
      const queryEmbedding = await this.getEmbedding(query);

      return this.documentChunks.map(chunk => {
        if (!chunk.embedding) return 0;
        return this.cosineSimilarity(queryEmbedding, chunk.embedding);
      });
    } catch (error) {
      this.logger.error('Error calculating semantic scores:', error);
      return new Array(this.documentChunks.length).fill(0);
    }
  }

  /**
   * Normalize scores to [0, 1] range
   */
  private normalizeScore(score: number, allScores: number[]): number {
    const max = Math.max(...allScores);
    const min = Math.min(...allScores);

    if (max === min) return 0;
    return (score - min) / (max - min);
  }

  /**
   * Merge adjacent or nearby chunks
   */
  private mergeAdjacentChunks(scoredChunks: ScoredChunk[]): ScoredChunk[] {
    if (scoredChunks.length === 0) return scoredChunks;

    const sorted = [...scoredChunks].sort((a, b) => a.chunk.startIndex - b.chunk.startIndex);
    const merged: ScoredChunk[] = [];

    let currentGroup = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const previous = currentGroup[currentGroup.length - 1];

      const isAdjacent = current.chunk.startIndex - previous.chunk.endIndex < 100;
      const isSameSection = current.chunk.title.split(' - ')[0] === previous.chunk.title.split(' - ')[0];

      if (isAdjacent || isSameSection) {
        currentGroup.push(current);
      } else {
        merged.push(this.mergeScoredChunkGroup(currentGroup));
        currentGroup = [current];
      }
    }

    if (currentGroup.length > 0) {
      merged.push(this.mergeScoredChunkGroup(currentGroup));
    }

    return merged;
  }

  /**
   * Merge a group of scored chunks
   */
  private mergeScoredChunkGroup(group: ScoredChunk[]): ScoredChunk {
    if (group.length === 1) return group[0];

    const mergedContent = group.map(item => item.chunk.content).join('\n\n');
    const maxScore = Math.max(...group.map(item => item.score));
    const avgBM25 = group.reduce((sum, item) => sum + item.bm25Score, 0) / group.length;
    const avgSemantic = group.reduce((sum, item) => sum + item.semanticScore, 0) / group.length;
    const minIndex = Math.min(...group.map(item => item.originalIndex));
    const firstChunk = group[0].chunk;

    return {
      chunk: {
        content: mergedContent,
        title: firstChunk.title.split(' - ')[0],
        startIndex: Math.min(...group.map(item => item.chunk.startIndex)),
        endIndex: Math.max(...group.map(item => item.chunk.endIndex)),
      },
      score: maxScore,
      bm25Score: avgBM25,
      semanticScore: avgSemantic,
      originalIndex: minIndex,
    };
  }

  /**
   * Remove duplicate chunks
   */
  private deduplicateChunks(chunks: ScoredChunk[]): ScoredChunk[] {
    const result: ScoredChunk[] = [];
    const seen = new Set<string>();

    for (const item of chunks) {
      const key = `${item.chunk.startIndex}-${item.chunk.endIndex}`;

      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }

    return result;
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
   */
  @Cron('*/5 * * * *', {
    name: 'refresh-documentation-enhanced',
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
   * Check if RAG is ready
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
    hasTfIdf: boolean;
    hasEmbeddings: boolean;
  }> {
    return {
      initialized: this.isInitialized,
      chunks: this.documentChunks.length,
      documentSize: this.fullDocument.length,
      cacheAge: Date.now() - this.lastFetchTime,
      hasTfIdf: this.tfidf !== null,
      hasEmbeddings: this.documentChunks[0]?.embedding !== undefined,
    };
  }
}
