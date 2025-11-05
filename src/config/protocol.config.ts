/**
 * Protocol configuration for DeFi integrations
 */

/**
 * Parse comma-separated protocol list from environment variable
 */
function parseLendingProtocols(): string[] {
  const envValue = process.env.LENDING_PROTOCOLS;
  if (!envValue) {
    return ['aave', 'venus'];
  }
  return envValue.split(',').map(p => p.trim()).filter(Boolean);
}

/**
 * Supported lending/supply protocols
 * Can be configured via LENDING_PROTOCOLS environment variable (comma-separated)
 * Default: aave,venus
 */
export const LENDING_PROTOCOLS = parseLendingProtocols();

export type LendingProtocol = string;
