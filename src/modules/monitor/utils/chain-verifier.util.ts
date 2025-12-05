import axios from 'axios';

/**
 * Extract transaction hash from agent output text
 */
export function extractTxHashFromOutput(output: string): string | null {
  if (!output) return null;

  // Pattern 1: Direct tx hash (0x followed by 64 hex chars)
  const txHashPattern = /0x[a-fA-F0-9]{64}/;
  const match = output.match(txHashPattern);
  if (match) {
    return match[0];
  }

  // Pattern 2: Transaction URL from explorers
  const urlPatterns = [
    /basescan\.org\/tx\/(0x[a-fA-F0-9]{64})/,
    /etherscan\.io\/tx\/(0x[a-fA-F0-9]{64})/,
    /arbiscan\.io\/tx\/(0x[a-fA-F0-9]{64})/,
  ];

  for (const pattern of urlPatterns) {
    const urlMatch = output.match(pattern);
    if (urlMatch && urlMatch[1]) {
      return urlMatch[1];
    }
  }

  return null;
}

/**
 * Verify transaction status on chain
 */
export async function verifyTransactionOnChain(
  txHash: string,
  rpcUrl: string,
): Promise<{
  success: boolean;
  confirmed: boolean;
  status?: string;
  blockNumber?: number;
  error?: string;
}> {
  const MAX_RETRIES = 10;
  const POLL_INTERVAL_MS = 1_000;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await axios.post(
        rpcUrl,
        {
          jsonrpc: '2.0',
          method: 'eth_getTransactionReceipt',
          params: [txHash],
          id: 1,
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000,
        },
      );

      if (response.data.error) {
        return {
          success: false,
          confirmed: false,
          error: response.data.error.message,
        };
      }

      const receipt = response.data.result;

      if (receipt) {
        // Check transaction status (0x1 = success, 0x0 = failed)
        const txSuccess = receipt.status === '0x1';
        const blockNumber = receipt.blockNumber
          ? Number(receipt.blockNumber)
          : undefined;

        return {
          success: true,
          confirmed: txSuccess,
          status: receipt.status,
          blockNumber,
        };
      }

      // No receipt yet, wait 1 second before retry (unless it's the last attempt)
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    } catch (error) {
      return {
        success: false,
        confirmed: false,
        error: `RPC request failed: ${error.message}`,
      };
    }
  }

  return {
    success: false,
    confirmed: false,
    error: `Transaction not confirmed after ${MAX_RETRIES} attempts`,
  };
}
