import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { getLoggerConfig } from '../config/logger.config';
import {
  formatAsText,
  formatAsJson,
  generateLogFileName,
  getDateSubdirectory,
  LogEntry,
  RebalanceLogSession,
} from './log-formatter.util';

/**
 * Service for capturing and persisting rebalance operation logs
 */
@Injectable()
export class RebalanceLoggerService {
  private readonly logger = new Logger(RebalanceLoggerService.name);
  private readonly logSessions: Map<string, RebalanceLogSession> = new Map();
  private readonly config = getLoggerConfig();

  // Store original logger methods for interception
  private originalLogMethods: Map<string, Function> = new Map();
  private activeInterceptionSession: string | null = null;
  private isIntercepting = false;

  /**
   * Start capturing logs for a rebalance job
   */
  startCapture(jobId: string, metadata: {
    userId: string;
    userAddress?: string;
    chainId?: string;
    trigger: string;
    precheckResult?: any;
  }): void {
    const session: RebalanceLogSession = {
      jobId,
      userId: metadata.userId,
      userAddress: metadata.userAddress,
      chainId: metadata.chainId,
      trigger: metadata.trigger,
      startTime: new Date(),
      entries: [],
      metadata: {
        precheckResult: metadata.precheckResult,
      },
    };

    this.logSessions.set(jobId, session);
    this.logger.log(`Started log capture for job ${jobId}`);
  }

  /**
   * Log a message for a specific job
   */
  log(
    jobId: string,
    level: 'log' | 'error' | 'warn' | 'debug',
    message: string,
    context?: string,
  ): void {
    const session = this.logSessions.get(jobId);
    if (!session) {
      // Job not being tracked, skip
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
    };

    session.entries.push(entry);
  }

  /**
   * Stop capturing logs (without saving)
   */
  stopCapture(jobId: string, status?: string): void {
    const session = this.logSessions.get(jobId);
    if (!session) {
      return;
    }

    session.endTime = new Date();
    session.duration = (session.endTime.getTime() - session.startTime.getTime()) / 1000;
    session.status = status;

    this.logger.log(`Stopped log capture for job ${jobId} with status ${status}`);
  }

  /**
   * Save log session to file(s) and clean up from memory
   */
  async saveToFile(
    jobId: string,
    finalStatus?: string,
  ): Promise<{ textPath?: string; jsonPath?: string }> {
    const session = this.logSessions.get(jobId);
    if (!session) {
      this.logger.warn(`No log session found for job ${jobId}`);
      return {};
    }

    // Update status if provided
    if (finalStatus) {
      this.stopCapture(jobId, finalStatus);
    } else if (!session.endTime) {
      this.stopCapture(jobId, 'UNKNOWN');
    }

    try {
      const result: { textPath?: string; jsonPath?: string } = {};

      // Create directory structure
      const dateSubdir = getDateSubdirectory();
      const logDir = path.join(this.config.logDir, dateSubdir);
      await this.ensureDirectory(logDir);

      // Save text log
      if (this.config.format === 'text' || this.config.format === 'both') {
        const textFileName = generateLogFileName(session.userId, jobId, 'log');
        const textPath = path.join(logDir, textFileName);
        const textContent = formatAsText(session);
        await fs.promises.writeFile(textPath, textContent, 'utf-8');
        result.textPath = textPath;
        this.logger.log(`Saved text log to ${textPath}`);
      }

      // Save JSON log
      if (this.config.format === 'json' || this.config.format === 'both') {
        const jsonFileName = generateLogFileName(session.userId, jobId, 'json');
        const jsonPath = path.join(logDir, jsonFileName);
        const jsonContent = formatAsJson(session);
        await fs.promises.writeFile(jsonPath, jsonContent, 'utf-8');
        result.jsonPath = jsonPath;
        this.logger.log(`Saved JSON log to ${jsonPath}`);
      }

      // Clean up from memory
      this.logSessions.delete(jobId);

      return result;
    } catch (error) {
      this.logger.error(`Failed to save log for job ${jobId}: ${(error as Error).message}`);
      // Don't throw - we don't want log failures to break the main flow
      return {};
    }
  }

  /**
   * Get log buffer for a job (for testing/debugging)
   */
  getLogBuffer(jobId: string): RebalanceLogSession | undefined {
    return this.logSessions.get(jobId);
  }

  /**
   * Update session metadata
   */
  updateMetadata(jobId: string, metadata: any): void {
    const session = this.logSessions.get(jobId);
    if (!session) {
      return;
    }

    session.metadata = {
      ...session.metadata,
      ...metadata,
    };
  }

  /**
   * Ensure directory exists, create if not
   */
  private async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await fs.promises.access(dirPath);
    } catch {
      // Directory doesn't exist, create it
      await fs.promises.mkdir(dirPath, { recursive: true });
      this.logger.log(`Created log directory: ${dirPath}`);
    }
  }

  /**
   * Clean up old log files based on retention policy
   */
  async cleanupOldLogs(): Promise<void> {
    try {
      const retentionMs = this.config.retentionDays * 24 * 60 * 60 * 1000;
      const now = Date.now();

      const baseDir = this.config.logDir;
      const entries = await fs.promises.readdir(baseDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const dirPath = path.join(baseDir, entry.name);
        const stats = await fs.promises.stat(dirPath);
        const age = now - stats.mtimeMs;

        if (age > retentionMs) {
          await fs.promises.rm(dirPath, { recursive: true, force: true });
          this.logger.log(`Deleted old log directory: ${dirPath}`);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to cleanup old logs: ${(error as Error).message}`);
    }
  }

  /**
   * Start intercepting all Logger calls globally
   * This will capture logs from nested service calls
   */
  startInterception(sessionId: string): void {
    if (this.isIntercepting) {
      this.logger.warn(`Already intercepting logs for session ${this.activeInterceptionSession}`);
      return;
    }

    this.activeInterceptionSession = sessionId;
    this.isIntercepting = true;

    // Store original methods
    const loggerPrototype = Logger.prototype as any;
    this.originalLogMethods.set('log', loggerPrototype.log);
    this.originalLogMethods.set('error', loggerPrototype.error);
    this.originalLogMethods.set('warn', loggerPrototype.warn);
    this.originalLogMethods.set('debug', loggerPrototype.debug);

    // Replace with intercepting methods
    const self = this;

    loggerPrototype.log = function (message: any, ...optionalParams: any[]) {
      // Call original to maintain console output
      const original = self.originalLogMethods.get('log');
      original?.call(this, message, ...optionalParams);

      // Capture to our session
      if (self.activeInterceptionSession) {
        const context = optionalParams.length > 0 ? optionalParams[optionalParams.length - 1] : this.context;
        const msg = typeof message === 'object' ? JSON.stringify(message) : String(message);
        self.log(self.activeInterceptionSession, 'log', msg, context);
      }
    };

    loggerPrototype.error = function (message: any, ...optionalParams: any[]) {
      const original = self.originalLogMethods.get('error');
      original?.call(this, message, ...optionalParams);

      if (self.activeInterceptionSession) {
        const context = optionalParams.length > 0 ? optionalParams[optionalParams.length - 1] : this.context;
        const msg = typeof message === 'object' ? JSON.stringify(message) : String(message);
        self.log(self.activeInterceptionSession, 'error', msg, context);
      }
    };

    loggerPrototype.warn = function (message: any, ...optionalParams: any[]) {
      const original = self.originalLogMethods.get('warn');
      original?.call(this, message, ...optionalParams);

      if (self.activeInterceptionSession) {
        const context = optionalParams.length > 0 ? optionalParams[optionalParams.length - 1] : this.context;
        const msg = typeof message === 'object' ? JSON.stringify(message) : String(message);
        self.log(self.activeInterceptionSession, 'warn', msg, context);
      }
    };

    loggerPrototype.debug = function (message: any, ...optionalParams: any[]) {
      const original = self.originalLogMethods.get('debug');
      original?.call(this, message, ...optionalParams);

      if (self.activeInterceptionSession) {
        const context = optionalParams.length > 0 ? optionalParams[optionalParams.length - 1] : this.context;
        const msg = typeof message === 'object' ? JSON.stringify(message) : String(message);
        self.log(self.activeInterceptionSession, 'debug', msg, context);
      }
    };

    this.logger.log(`Started global log interception for session ${sessionId}`);
  }

  /**
   * Stop intercepting Logger calls and restore original methods
   */
  stopInterception(): void {
    if (!this.isIntercepting) {
      return;
    }

    // Restore original methods
    const loggerPrototype = Logger.prototype as any;
    loggerPrototype.log = this.originalLogMethods.get('log');
    loggerPrototype.error = this.originalLogMethods.get('error');
    loggerPrototype.warn = this.originalLogMethods.get('warn');
    loggerPrototype.debug = this.originalLogMethods.get('debug');

    this.logger.log(`Stopped global log interception for session ${this.activeInterceptionSession}`);

    this.isIntercepting = false;
    this.activeInterceptionSession = null;
    this.originalLogMethods.clear();
  }
}
