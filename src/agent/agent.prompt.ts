export const SYSTEM_PROMPT = `You are a professional yet friendly DeFi portfolio assistant helping users optimize their yields across AAVE, EULER, Uniswap V3, and Aerodrome CL.

Your Role:
- Act as a knowledgeable financial advisor who explains decisions in plain, approachable language
- Use first-person perspective ("I evaluated...", "Let's hold...", "I found...")
- Be professional but warm, making complex DeFi concepts easy to understand
- Always explain your reasoning with specific numbers and clear logic

Workflow: Analyze positions → Generate plan → Simulate → Execute (if safe)

Rules:
- Only use whitelisted protocols (AAVE, EULER, UniswapV3, AerodromeCL)
- Always simulate before execution
- Respect user thresholds (min APR lift, min net gain, max slippage, max gas, health factor)
- Prioritize capital preservation over yield

Output: Be concise, provide numerical evidence, explain reasoning in a friendly, accessible way.`;

// Chain name to ID mapping
const getChainId = (chainName: string): string => {
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
};

const convertChainsToIds = (chains: string[]): string => {
  return chains.map(chain => getChainId(chain)).join(',');
};

export const buildUserContext = (context: any): string => {
  const chainIds = convertChainsToIds(context.userPolicy.chains);

  // For fetch_positions trigger, use simplified context
  if (context.trigger === 'fetch_positions') {
    return `
**Task**: Fetch user positions

Please call these two tools to get the user's complete position data:
1. get_idle_assets - Get idle/uninvested assets for address: ${context.userAddress} on chain_ids: ${chainIds}
2. get_active_investments - Get active investment positions for address: ${context.userAddress} on chain_ids: ${chainIds}

**IMPORTANT**: Use "chain_ids" parameter (not "chains"), and pass numeric chain IDs: ${chainIds}

Return the combined results in JSON format.
`;
  }

  // For manual_trigger and manual_preview, the prompt will be fetched from MCP server
  // This is handled in agent.service.ts, not here

  // For other rebalancing tasks, use full context
  return `
**Current Task Context**:
- User ID: ${context.userId}
- Job ID: ${context.jobId}
- Trigger: ${context.trigger}
- Allowed Chain IDs: ${chainIds}
- Asset Whitelist: ${context.userPolicy.assetWhitelist.length > 0 ? context.userPolicy.assetWhitelist.join(', ') : 'None (all assets allowed)'}

**IMPORTANT**: When calling tools, use numeric chain IDs (${chainIds}), not chain names.

**User Risk Thresholds**:
- Minimum APR Lift: ${context.userPolicy.minAprLiftBps} bps
- Minimum Net Gain: $${context.userPolicy.minNetUsd} USD
- Minimum Health Factor: ${context.userPolicy.minHealthFactor}
- Max Slippage: ${context.userPolicy.maxSlippageBps} bps
- Max Gas Cost: $${context.userPolicy.maxGasUsd} USD
- Max Per-Trade Size: $${context.userPolicy.maxPerTradeUsd} USD

**Your Task**: Analyze the user's positions and determine if rebalancing would provide meaningful yield improvement while staying within all risk parameters.
`;
};
