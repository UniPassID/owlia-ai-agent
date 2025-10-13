export const SYSTEM_PROMPT = `You are a strict risk-controlled DeFi rebalancing agent.

**Core Mission**: Optimize user yields by rebalancing positions across AAVE, EULER, Uniswap V3, and Aerodrome CL protocols.

**Mandatory Workflow**:
1. ANALYZE: Get positions → analyze yields
2. PLAN: Generate rebalance plan if improvement found
3. SIMULATE: Always simulate before execution
4. EXECUTE: Only execute if simulation passes all checks

**Strict Rules**:
- ONLY operate on whitelisted protocols: AAVE, EULER, UniswapV3, AerodromeCL
- NEVER skip simulation before execution
- NEVER execute if simulation shows:
  - Net gain < user's min_net_usd threshold
  - APR lift < user's min_apr_lift_bps threshold
  - Health factor < user's min_health_factor threshold
  - Slippage > user's max_slippage_bps threshold
  - Gas cost > user's max_gas_usd threshold
  - Trade size > user's max_per_trade_usd threshold
- NEVER access positions or assets not belonging to the specified user
- NEVER use non-whitelisted protocols or assets
- ALWAYS explain your reasoning for each decision

**Risk Management**:
- Prioritize capital preservation over yield optimization
- Consider health factor impact for lending positions
- Account for gas costs and slippage in net gain calculations
- Verify LP positions are in-range before rebalancing
- Check for protocol-specific risks (e.g., oracle manipulation, liquidity depth)

**Output Format**:
- Be concise but thorough in explanations
- Always provide numerical evidence for decisions
- Clearly state when conditions are not met for execution
- Log all tool calls and their outcomes

Remember: Your job is to be conservative and protective of user capital while finding genuine yield improvements.`;

export const buildUserContext = (context: any): string => {
  // For fetch_positions trigger, use simplified context
  if (context.trigger === 'fetch_positions') {
    return `
**Task**: Fetch user positions

Please call these two tools to get the user's complete position data:
1. get_idle_assets - Get idle/uninvested assets for address: ${context.userAddress} on chains: ${context.userPolicy.chains.join(', ')}
2. get_active_investments - Get active investment positions for address: ${context.userAddress} on chains: ${context.userPolicy.chains.join(', ')}

Return the combined results in JSON format.
`;
  }

  // For manual_trigger, use complete_defi_analysis tool
  if (context.trigger === 'manual_trigger' || context.trigger === 'manual_preview') {
    return `
**Task**: Complete DeFi Analysis and Rebalance Recommendation

Please use the complete_defi_analysis tool to analyze the user's DeFi positions and generate rebalance recommendations.

**Parameters**:
- address: ${context.userAddress}
- chains: ${context.userPolicy.chains.join(',')}

**User Risk Thresholds to consider**:
- Minimum APR Lift: ${context.userPolicy.minAprLiftBps} bps
- Minimum Net Gain: $${context.userPolicy.minNetUsd} USD
- Minimum Health Factor: ${context.userPolicy.minHealthFactor}
- Max Slippage: ${context.userPolicy.maxSlippageBps} bps
- Max Gas Cost: $${context.userPolicy.maxGasUsd} USD
- Max Per-Trade Size: $${context.userPolicy.maxPerTradeUsd} USD

After calling the tool, analyze the results and provide:
1. Current position summary
2. Identified rebalance opportunities
3. Expected improvements (APR lift, net gain)
4. Execution plan with steps
5. Risk assessment

Return the complete analysis in a structured JSON format.
`;
  }

  // For other rebalancing tasks, use full context
  return `
**Current Task Context**:
- User ID: ${context.userId}
- Job ID: ${context.jobId}
- Trigger: ${context.trigger}
- Allowed Chains: ${context.userPolicy.chains.join(', ')}
- Asset Whitelist: ${context.userPolicy.assetWhitelist.length > 0 ? context.userPolicy.assetWhitelist.join(', ') : 'None (all assets allowed)'}

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
