export interface AnalysisPromptParams {
  address: string;
  chainId: string;
}

export interface Step1PromptParams extends AnalysisPromptParams {}

export interface Step2PromptParams extends AnalysisPromptParams {
  step1Summary: Step1SummaryData;
  lpContext: LpContextData;
}

export interface Step3PromptParams extends AnalysisPromptParams {
  step1Summary: Step1SummaryData;
  step2Summary: Step2SummaryData;
}

export interface Step1SummaryData {
  totalAssetsUsd: number;
  portfolioApy: number;
  yieldSummary: unknown;
}

export interface Step2SummaryData {
  bestLpOpportunity: unknown;
  lpCandidates: unknown[];
  bestSupplyOpportunity: unknown;
  supplyOpportunities: unknown[];
  lpPlanSuggestions?: unknown[];
}

export interface LpContextData {
  deployableCapital: number;
  pools: unknown[];
  binanceDepth: unknown;
}

export interface LpPlanScenario {
  label: string;
  tickLower: number;
  tickUpper: number;
  notes?: string;
}

export interface LpPlanSuggestion {
  poolAddress: string;
  poolName?: string;
  protocol?: 'aerodromeSlipstream' | 'uniswapV3';
  token0Address?: string;
  token0Symbol?: string;
  token1Address?: string;
  token1Symbol?: string;
  tickStatus: '🎯 Ambush Ready' | '⚠️ Jump Soon' | 'Stable';
  justification?: string;
  scenarios: LpPlanScenario[];
}


export function buildStep2Prompt(params: Step2PromptParams): string {
  const { address, chainId, step1Summary, lpContext } = params;
  const step1Json = JSON.stringify(step1Summary, null, 2);
  const lpContextJson = JSON.stringify(lpContext, null, 2);

  return `You are executing Step 2: Market Opportunities Analysis for address ${address} on chain ${chainId}.

Step 1 summary (use this data, do not recompute):
\`\`\`json
${step1Json}
\`\`\`

Total deployable capital equals totalAssetsUsd from the summary above.

LP pool context and Binance depth data:
\`\`\`json
${lpContextJson}
\`\`\`

### Required actions
1. Using only the provided pool summaries and Binance depth data, classify each pool's tick status (Stable / ⚠️ Jump Soon / 🎯 Ambush Ready).
2. For every pool, propose realistic simulation scenarios (tickLower/tickUpper pairs) that match its status. Include at least one scenario per pool; use two scenarios for Jump Soon or Ambush Ready pools (standard + directional). When the status is Stable, follow these refinements:
   - If pricePositionText indicates the price is between 20% and 80% of the tick range (inclusive), use a tight single-tick range [currentTick, currentTick + 1].
   - If pricePositionText is below 5% or above 95%, treat the pool as pending a boundary jump and prepare scenarios as you would for the Jump Soon category (two scenarios reflecting potential direction).
3. For each scenario, provide a short justification so downstream code understands the reasoning.
4. Do not call any external tools. Work strictly with the supplied data.

### Output format
Return only a JSON code block with the structure below:
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
      "justification": "string",
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

Rules:
- Provide suggestions for every pool in the input list (no filtering).
- All tickLower / tickUpper values must be integers.
- Ensure scenarios respect the provided tick spacing information where relevant.
- Provide no additional commentary outside the JSON code block.`;
}

export function buildStep3Prompt(params: Step3PromptParams): string {
  const { address, chainId, step1Summary, step2Summary } = params;
  const step1Json = JSON.stringify(step1Summary, null, 2);
  const step2Json = JSON.stringify(step2Summary, null, 2);

  return `You are executing Step 3: Portfolio Rebalancing Analysis for address ${address} on chain ${chainId}.

Use the previously computed data exactly as provided. Do not repeat earlier tool calls except where mandated in this step.

### Step 1 summary
\`\`\`json
${step1Json}
\`\`\`

### Step 2 summary
\`\`\`json
${step2Json}
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
3. Decide whether rebalancing is beneficial considering APY lift, gas costs, and break-even time (must be <= 30 days to proceed).
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
