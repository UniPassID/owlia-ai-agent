export interface BaseAnalysisParams {
  address: string;
  chainId: string;
}

export interface LPRangePromptParams extends BaseAnalysisParams {
  portfolioSummary: PortfolioAnalysisSummary;
  liquidityPoolContext: LiquidityPoolContext;
}

export interface RebalancingPromptParams extends BaseAnalysisParams {
  portfolioSummary: PortfolioAnalysisSummary;
  marketOpportunitiesSummary: MarketOpportunitiesSummary;
}

export interface PortfolioAnalysisSummary {
  totalAssetsUsd: number;
  portfolioApy: number;
  yieldSummary: unknown;
}

export interface MarketOpportunitiesSummary {
  bestLpOpportunity: unknown;
  lpCandidates: unknown[];
  bestSupplyOpportunity: unknown;
  supplyOpportunities: unknown[];
  lpPlanSuggestions?: unknown[];
}

export interface LiquidityPoolContext {
  deployableCapital: number;
  pools: unknown[];
  binanceDepth: unknown;
}

export interface TickRangeScenario {
  label: string;
  tickLower: number;
  tickUpper: number;
  notes?: string;
}

export interface PoolRebalanceSuggestion {
  poolAddress: string;
  poolName?: string;
  protocol?: 'aerodromeSlipstream' | 'uniswapV3';
  token0Address?: string;
  token0Symbol?: string;
  token1Address?: string;
  token1Symbol?: string;
  tickStatus: '🎯 Ambush Ready' | '⚠️ Jump Soon' | 'Stable';
  justification?: string;
  scenarios: TickRangeScenario[];
}

export function buildLPRangeRecommendationPrompt(params: LPRangePromptParams): string {
  const { address, chainId, portfolioSummary, liquidityPoolContext } = params;
  const portfolioJson = JSON.stringify(portfolioSummary, null, 2);
  const liquidityPoolJson = JSON.stringify(liquidityPoolContext, null, 2);

  return `You are executing Step 2: Market Opportunities Analysis for address ${address} on chain ${chainId}.

Step 1 summary (use this data, do not recompute):
\`\`\`json
${portfolioJson}
\`\`\`

Total deployable capital equals totalAssetsUsd from the summary above.

LP pool context and Binance depth data:
\`\`\`json
${liquidityPoolJson}
\`\`\`

### Required actions
1. Classify each pool's tick status using ONLY the numeric value from pricePositionText field:

   **Step-by-step classification process:**
   a) Extract the numeric value from pricePositionText (e.g., "29.26%" → 29.26)
   b) Apply ONLY these rules (no exceptions, no interpretation):

      IF value >= 20.0 AND value <= 80.0:
         → tickStatus = "Stable"
         → Use single scenario: [currentTick, currentTick + 1]

      ELSE IF (value >= 5.0 AND value < 20.0) OR (value > 80.0 AND value <= 95.0):
         → tickStatus = "⚠️ Jump Soon"
         → Use two scenarios (standard + directional)

      ELSE IF value < 5.0 OR value > 95.0:
         → tickStatus = "🎯 Ambush Ready"
         → Use two scenarios (standard + directional)

   **Examples to verify your logic:**
   - 4.5% → Ambush Ready ✓
   - 10.0% → Jump Soon ✓
   - 20.0% → Stable ✓
   - 29.26% → Stable ✓
   - 60.90% → Stable ✓
   - 69.99% → Stable ✓
   - 80.0% → Stable ✓
   - 85.0% → Jump Soon ✓
   - 96.0% → Ambush Ready ✓

2. For every pool, propose simulation scenarios matching the tickStatus determined above:
   - **Stable**: Exactly ONE scenario with tight range [currentTick, currentTick + 1]
   - **Jump Soon or Ambush Ready**: Exactly TWO scenarios (standard + directional)
3. For each scenario, provide a short justification so downstream code understands the reasoning.
4. Do not call any external tools. Work strictly with the supplied data.

### Output format
For each pool, follow this process before writing JSON:

1. **Extract pricePositionText value** (e.g., "29.68%" → 29.68)
2. **Apply classification logic**:
   - Is 29.68 >= 20.0 AND <= 80.0? YES → Status is "Stable"
3. **Determine scenarios count**:
   - If Stable: 1 scenario
   - If Jump Soon or Ambush Ready: 2 scenarios
4. **Write the pool entry ensuring tickStatus and scenarios count match**

Return only a JSON code block:
\`\`\`json
{
  "lpPlanSuggestions": [
    {
      "poolAddress": "0x...",
      "poolName": "string",
      "protocol": "aerodromeSlipstream" | "uniswapV3",
      "token0Address": "0x...",
      "token0Symbol": "string",
      "token1Address": "0x...",
      "token1Symbol": "string",
      "tickStatus": "🎯 Ambush Ready" | "⚠️ Jump Soon" | "Stable",
      "justification": "Must start with 'pricePositionText=X.XX → Status: [Stable|Jump Soon|Ambush Ready]'",
      "scenarios": [
        {
          "label": "string",
          "tickLower": <number>,
          "tickUpper": <number>,
          "notes": "string"
        }
      ]
    }
  ]
}
\`\`\`

**Critical validation rules:**
- If tickStatus is "Stable", scenarios array MUST have exactly 1 element
- If tickStatus is "⚠️ Jump Soon" or "🎯 Ambush Ready", scenarios array MUST have exactly 2 elements
- justification MUST explicitly state the pricePositionText value and the resulting status
- Provide suggestions for every pool in the input list (no filtering)
- All tickLower/tickUpper values must be integers
- Provide no additional commentary outside the JSON code block`;
}

export function buildBestOpportunityPrompt(params: RebalancingPromptParams): string {
  const { address, chainId, portfolioSummary, marketOpportunitiesSummary } = params;
  const portfolioJson = JSON.stringify(portfolioSummary, null, 2);
  const marketOpportunitiesJson = JSON.stringify(marketOpportunitiesSummary, null, 2);

  return `You are executing Step 3: Portfolio Rebalancing Analysis for address ${address} on chain ${chainId}.

Use the previously computed data exactly as provided. Do not repeat earlier tool calls except where mandated in this step.

### Portfolio Analysis Summary
\`\`\`json
${portfolioJson}
\`\`\`

### Market Opportunities Summary
\`\`\`json
${marketOpportunitiesJson}
\`\`\`

Total deployable capital equals the totalAssetsUsd value above.

### Required actions
1. Build these strategies using the opportunities from Step 2:
   - Strategy A: 100% capital into the best supply opportunity (skip if none available).
   - Strategy B: 100% capital into the best LP opportunity (skip if none available).
   - Strategy C: 50% supply / 50% LP split using the same opportunities (only if both exist).
2. For each strategy:
   - Call calculate_rebalance_cost_batch first to obtain gas and execution details.
   - After the cost call completes, call analyze_strategy using the same strategy definition.
3. Decide whether rebalancing is beneficial considering APY lift, gas costs, and break-even time:
   - The new APY must satisfy BOTH conditions:
     a) At least 10% higher than current portfolio APY (e.g., if current is 5%, new must be >= 5.5%)
     b) At least 2 percentage points higher in absolute terms (e.g., if current is 5%, new must be >= 7%)
   - Break-even time must be <= 4 hours to proceed.
   - Only recommend rebalancing if the APY gain significantly outweighs the gas costs and complexity.
4. Assemble the final execution plan using current positions from Step 1's yieldSummary.

### Output format
Respond only with the final JSON block required by the executor:
\`\`\`json
{
  "recommendation": "string",
  "shouldRebalance": true | false,
  "opportunities": [
    {
      "type": "lp" | "supply",
      "protocol": "aerodromeSlipstream" | "uniswapV3" | "aave" | "euler" | "venus",
      "poolName"?: "string",
      "poolAddress"?: "0x...",
      "token0Address"?: "0x...",
      "token0Symbol"?: "string",
      "token1Address"?: "0x...",
      "token1Symbol"?: "string",
      "targetTickLower"?: <number>,
      "targetTickUpper"?: <number>,
      "targetAmount0"?: <number>,
      "targetAmount1"?: <number>,
      "amount"?: <number>,
      "tokenAddress"?: "0x...",
      "tokenSymbol"?: "string",
      "vToken"?: "0x...",
      "expectedAPY": <number>,
      "currentAPY": <number>
    }
  ],
  "currentPositions": [
    {
      "type": "lp" | "supply" | "idle",
      "protocol": "string",
      "poolAddress"?: "0x...",
      "tokenAddress"?: "0x...",
      "amount": <number>,
      "value": <number>,
      "apy": <number>
    }
  ],
  "analysis": {
    "gasEstimate": <number>,
    "breakEvenTime": "string",
    "reason": "string"
  },
  "chainId": "${chainId}",
  "userAddress": "${address}"
}
\`\`\`

Rules:
- Use the positions contained in Step 1's yieldSummary to populate currentPositions and express amounts in human-readable decimals.
- All numeric fields must be numbers, not strings.
- Protocol names must match the allowed casing exactly.
- The recommendation string must state the real current APY value (no placeholders).
- Do not include any text outside the JSON code block.`;
}
