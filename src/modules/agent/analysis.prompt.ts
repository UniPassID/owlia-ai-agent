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

export function buildLPRangeRecommendationPrompt(
  params: LPRangePromptParams,
): string {
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

export function buildBestOpportunityPrompt(
  params: RebalancingPromptParams,
): string {
  const { address, chainId, portfolioSummary, marketOpportunitiesSummary } =
    params;
  const portfolioJson = JSON.stringify(portfolioSummary, null, 2);
  const marketOpportunitiesJson = JSON.stringify(
    marketOpportunitiesSummary,
    null,
    2,
  );

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
   - The new APY must satisfy BOTH conditions simultaneously:
     a) Relative increase: new APY ÷ current APY >= 1.1 (i.e., new APY is at least 1.1x the current)
        Special case: If current APY = 0, this condition is automatically satisfied.
        Example: if current is 5%, new must be >= 5.5% (5 × 1.1 = 5.5)
     b) Absolute increase: new APY - current APY >= 2 percentage points
        Example: if current is 5%, new must be >= 7% (5 + 2 = 7)

     **Calculation verification:**
     - Current APY: 4.708%
     - New APY: 7.894%
     - Relative: 7.894 ÷ 4.708 = 1.677 (✓ >= 1.1, meaning 67.7% increase)
     - Absolute: 7.894 - 4.708 = 3.186pp (✓ >= 2pp)
     - Result: APY conditions SATISFIED

   - Break-even time calculation (use results from calculate_rebalance_cost_batch):
     **Formula:**
     1. Calculate APY improvement: APY_improvement = new APY - current APY (in percentage points)
     2. Calculate hourly return rate: hourly_rate = (APY_improvement / 100) / (365 × 24)
        Example: If APY improves from 5% to 8%, improvement = 3pp
        hourly_rate = (3 / 100) / 8760 = 0.03 / 8760 = 0.00000342465753
     3. Calculate hourly return in USD: hourly_return_usd = totalAssetsUsd × hourly_rate
        Example: With $1000 assets: hourly_return = 1000 × 0.00000342465753 = $0.00342465753
     4. Calculate break-even time: break_even_hours = rebalance_cost_usd / hourly_return_usd
        Example: With $0.15 cost: break_even = 0.15 / 0.00342465753 = 43.8 hours

     **Break-even condition:**
     - Break-even time must be <= 4 hours to proceed.

   - Only recommend rebalancing if BOTH APY conditions AND break-even time are satisfied.
4. Assemble the final execution plan using current positions from Step 1's yieldSummary.

### Output format
Respond only with the final JSON block required by the executor:
\`\`\`json
{
  "summary": "string (brief overview of the entire rebalancing proposal in 1 sentence)",
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
- **CRITICAL: The opportunities array must contain ONLY the selected strategy to be executed, not all strategies evaluated.**
  * If shouldRebalance is true and you chose Strategy A (100% supply), include ONLY the supply opportunity.
  * If shouldRebalance is true and you chose Strategy B (100% LP), include ONLY the LP opportunity.
  * If shouldRebalance is true and you chose Strategy C (50/50 split), include BOTH the supply and LP opportunities with their respective amounts.
  * If shouldRebalance is false, include the best alternative strategy (for reference in the recommendation).
- If any MCP interface call fails (calculate_rebalance_cost_batch, analyze_strategy, or others), stop immediately and return an error response without continuing the workflow.
- Use the positions contained in Step 1's yieldSummary to populate currentPositions and express amounts in human-readable decimals.
- All numeric fields must be numbers, not strings.
- Protocol names must match the allowed casing exactly.
- The summary field should provide a one-sentence overview of the entire proposal:
  * If shouldRebalance is true:
    - Length: 40-60 characters maximum
    - Tone: Professional, friendly, natural language
    - Numbers: Only 1-2 core numbers (target APY)
    - FORBIDDEN: "pp", "basis points", "break-even", parentheses with technical details
    - Template options (choose one for natural variation):
      * "Rebalanced to [strategy] at [APY]% APY."
      * "Moved to [strategy], now [APY]% APY."
      * "Switched to [strategy] for [APY]% APY."
    - Examples:
      * "Rebalanced to AAVE supply at 7.9% APY."
      * "Switched to Aerodrome LP for 18.0% APY."
      * "Moved to mixed LP and supply at 8.5% APY."
  * If shouldRebalance is false:
    - Length: 40-60 characters maximum
    - Style: Simple, friendly, conversational (first-person perspective)
    - Content: Explain WHY we're not rebalancing without using numbers or technical jargon
    - HOW TO DETERMINE WHICH SCENARIO:
      * Scenario A (APY gain insufficient): Use when the best alternative APY is <= current APY, OR when APY improvement is < 2pp
        - This means current position is already optimal or close to it
      * Scenario B (Break-even time too long): Use when best alternative APY > current APY + 2pp, BUT break-even time > 4 hours
        - This means there IS a better option, but gas costs are too high
    - Scenario A (APY gain insufficient): Emphasize current position is already good
      Examples: "Current position is optimal, alternatives offer less yield."
                "Your position is performing well, limited upside from switching."
                "Yield is strong, switching adds minimal value."
    - Scenario B (Break-even time too long): Emphasize cost/time concerns
      Examples: "Better returns available, but cost recovery takes too long."
                "Gas costs eat into gains too much for the improvement offered."
                "Higher yields exist, but rebalancing fees outweigh benefits."
    - FORBIDDEN: Do NOT use technical terms like "pp", "threshold", "basis points"
    - REQUIRED: Keep it under 60 characters, natural and easy to understand
    - Allow natural variation in phrasing while staying true to the actual reason
- The recommendation string should be user-friendly and informative:
  * Use a conversational, helpful tone (avoid cold technical language)
  * If shouldRebalance is true:
    - Length: Maximum 140 characters (be concise!)
    - Tone: Professional but friendly, execution-focused (action already taken)
    - CRITICAL RULE: Describe ONLY the single executed strategy, no lists or alternatives
    - Required information to include:
      1. Strategy composition (e.g., "100% AAVE supply" or "50% Aerodrome LP + 50% AAVE supply")
         - Simplify protocol names: use "AAVE supply" not "AAVE USDC supply position"
         - Use percentage allocations from the opportunities array
      2. Strategy APY (precise number)
      3. Simple improvement and cost-time note in plain words:
         - Use "about +[gain]%" instead of "+Xpp" or "from X% to Y%"
         - Use "Cost $[cost], recover in [hours]h" instead of "break-even Xh"
         - If cost is negligible (< $0.01), use "minimal cost" or omit cost sentence
      4. Execution confirmation: "Applied." or "Executed." or "Done."
    - Required structure (follow this template):
      "Moved to [strategy] at [APY]% APY, about +[gain]%. Cost $[cost], recover in [hours]h. Applied."
    - Examples:
      * "Moved to 100% AAVE supply at 7.9% APY, about +3.2%. Cost $0.15, recover in 2h. Applied."
      * "Switched to 100% Aerodrome LP at 18.0% APY, about +2.2%. Cost $0.10, recover in 0.5h. Executed."
      * "Rebalanced to 50% Aerodrome LP + 50% AAVE supply at 8.5% APY, about +2.5%. Cost $1.50, recover in 3h. Done."
      * "Moved to 100% AAVE supply at 4.8% APY, about +4.8%. Minimal cost, instant recovery. Applied."
    - Data source: Extract the SINGLE BEST strategy from opportunities array
    - CRITICAL: All numbers must come from actual analysis results, no fabrication allowed
    - ABSOLUTELY FORBIDDEN:
      * "I evaluated...", "I tested...", "I found..." or listing multiple options
      * Technical jargon: "pp", "threshold", "basis points", "break-even limit"
      * Mentioning how many strategies were tested
      * Comparing multiple alternatives or explaining evaluation process
      * Parentheses with technical details like "(+3.2pp gain, 2h break-even)"
      * Future tense or conditional language - use past tense (action already taken)
    - REQUIRED: Use action verbs indicating completion (Moved, Switched, Rebalanced)
  * If shouldRebalance is false:
    - Length: Maximum 180 characters (be concise!)
    - Tone: Professional but friendly, first-person perspective, easy to understand
    - CRITICAL RULE: Only mention ONE strategy - the best alternative. Never list multiple strategies.
    - HOW TO DETERMINE WHICH SCENARIO (same as summary):
      * Scenario A (APY gain insufficient): Best alternative APY <= current APY, OR APY improvement < 2pp
      * Scenario B (Break-even time too long): Best alternative APY > current APY + 2pp, BUT break-even time > 4h
    - Required structure (follow this template strictly):
      "The best alternative is [strategy composition] at [APY]% APY, but [reason why not proceeding]. Let's [conclusion]."
    - Required information to include:
      1. The optimal strategy composition (e.g., "50% Aerodrome LP + 50% AAVE Supply" or "100% Aerodrome LP")
         - Simplify protocol names: use "Aerodrome LP" not "Aerodrome oUSDT/USDC LP"
         - Use percentage allocations from the opportunities array
      2. That strategy's APY (just the number, precise)
      3. Simple comparison/reason (choose based on scenario):
         - Scenario A: "but your current [X]% yield is better" or "but your current [X]% yield is still higher"
         - Scenario B: "but the $[cost] gas fee would take [hours]h to recover"
      4. Friendly conclusion: "Let's hold for now." or "Let's stay put." or "Let's wait."
    - Example for Scenario A (APY gain insufficient):
      "The best alternative is 100% Aerodrome LP at 6.5% APY, but your current 6.18% yield is already strong (gain would be only 0.32%). Let's hold for now."
    - Example for Scenario B (gas cost too high):
      "The best alternative is 50% Aerodrome LP + 50% AAVE Supply at 8.5% APY (up from 6.0%), but the $1.50 gas fee would take 8h to recover. Let's wait."
    - Data source: Extract the SINGLE BEST strategy from opportunities array
    - CRITICAL: All numbers must come from actual analysis results, no fabrication allowed
    - ABSOLUTELY FORBIDDEN:
      * "I evaluated three strategies..." or "I tested..." or listing multiple options
      * Technical jargon: "pp", "threshold", "basis points", "break-even limit"
      * Mentioning how many strategies were tested
      * Comparing multiple alternatives
      * Any text about the evaluation process
    - REQUIRED: Jump straight to describing the best alternative only
  * Do not use Strategy A/B/C labels in the final recommendation without explaining what they are
  * Do not include elaborate risk assessments or philosophical justifications
- Do not include any text outside the JSON code block.`;
}
