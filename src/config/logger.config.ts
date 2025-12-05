/**
 * Logger configuration for rebalance operations
 */
export interface LoggerConfig {
  /** Directory to store rebalance logs */
  logDir: string;
  /** Number of days to retain log files */
  retentionDays: number;
  /** Log output format: 'text', 'json', or 'both' */
  format: 'text' | 'json' | 'both';
}

export const DEFAULT_LOGGER_CONFIG: LoggerConfig = {
  logDir: './logs/rebalance',
  retentionDays: 30,
  format: 'both',
};

/**
 * Get logger configuration from environment variables
 */
export function getLoggerConfig(): LoggerConfig {
  return {
    logDir: process.env.REBALANCE_LOG_DIR || DEFAULT_LOGGER_CONFIG.logDir,
    retentionDays: parseInt(process.env.REBALANCE_LOG_RETENTION_DAYS || '30', 10),
    format: (process.env.REBALANCE_LOG_FORMAT as LoggerConfig['format']) || DEFAULT_LOGGER_CONFIG.format,
  };
}
