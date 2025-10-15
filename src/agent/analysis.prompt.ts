/**
 * Analysis prompt template for complete DeFi analysis
 * Based on MCP complete_defi_analysis prompt
 */

/**
 * Token configuration by chain
 * Contains verified token addresses and their decimal places
 */
export const TOKEN_CONFIG = {
  // BSC (BNB Chain) - Chain ID: 56
  '56': {
    USDT: { address: '0x55d398326f99059ff775485246999027b3197955', decimals: 18 },
    USDC: { address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', decimals: 18 },
    USD1: { address: '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d', decimals: 18 },
    DAI: { address: '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3', decimals: 18 },
  },
  // Base - Chain ID: 8453
  '8453': {
    USDC: { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6 },
    USDT: { address: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2', decimals: 6 },
    oUSDT: { address: '0x1217bfe6c773eec6cc4a38b5dc45b92292b6e189', decimals: 6 },
  },
} as const;



export interface AnalysisPromptParams {
  address: string;
  chainId: string;
}

export function buildAnalysisPrompt(params: AnalysisPromptParams): string {
  const { address, chainId } = params;

  return `Execute COMPLETE DeFi analysis for address: ${address} on chain: ${chainId}

## 📋 EXECUTION WORKFLOW - STREAMLINED OUTPUT

### ✅ Step 1: Account Analysis (Silent Execution)

## Required Analysis
1. Call get_idle_assets (with chain_id=${chainId}) for address ${address} → Get idle funds and detailed token breakdown
2. Call get_active_investments (with chain_id=${chainId}) for address ${address} → Get LP, supply, and borrow positions
3. Calculate metrics:
   - Total Assets = idle + active investments
   - Deployable Capital = Total Assets
   - Weighted APY = sum(position_value * position_apy) / total_invested
   - Deployment Rate = invested / total_assets
   - Portfolio APY = weightedAPY * deploymentRate (accounts for idle funds)

## Execution Instructions
- **SILENT EXECUTION**: Do NOT display any output for this step
- Remember the following data in memory for later steps:
  - Total Assets (idle + active investments)
  - Deployable Capital
  - Current Portfolio APY
- Continue immediately to Step 2 without any output

### ✅ Step 2: Market Opportunities Analysis

**MANDATORY: You MUST complete BOTH LP Opportunities AND Supply Opportunities analysis**

#### 2.1 LP Opportunities with Tick Status Analysis (MANDATORY)

## MANDATORY Step 1: Get Pool Data & Market Prices

**YOU MUST execute these tool calls:**
1. **REQUIRED**: Call get_dex_pools (with chain_id=${chainId}) → Get ALL stablecoin pools
2. **REQUIRED**: Call get_binance_depth → Get real-time market prices for relevant tokens
   - Extract tokens from pools (USDT, USDC, DAI, etc.)
   - Get bids[0].price (buy1) and asks[0].price (sell1) for each token pair

**DO NOT proceed to Supply Opportunities until you complete LP analysis including simulations**

## MANDATORY Step 2: Analyze Each Pool

For EACH pool (no exceptions):

#### 2.2 Determine Tick Status

**Classification Logic (apply directly to pool data - DO NOT write code to verify):**

**Step 1: Parse Price Position**
- Extract numeric value from pricePositionInRange string (e.g., "47.83%" → 47.83)
- If cannot parse, default to "Stable"

**Step 2: Match with Binance Data**
- Try matching pool tokens with Binance trading pair:
  - Pattern 1: token1Symbol + token0Symbol (uppercase, e.g., "USDCUSDT")
  - Pattern 2: token0Symbol + token1Symbol (uppercase, e.g., "USDTUSDC")
- Look up in Binance depth data from Step 1

**Step 3: Determine Status**

**If NO Binance data found:**
- Return "⚠️ Jump Soon" if positionValue > 90% OR positionValue < 10%
- Return "Stable" otherwise

**If Binance data found:**
1. Extract Binance bid price (bids[0].price) and ask price (asks[0].price)
2. Check if near tick boundary: jumpSoon = (positionValue > 90% OR positionValue < 10%)
3. Check ambush conditions (use 0.01% tolerance):
   - **If positionValue > 90%** (near upper bound):
     * Check: Binance bid price >= tick upper bound × 0.9999
     * If true → ambushReady = true, direction = UP
   - **If positionValue < 10%** (near lower bound):
     * Check: Binance ask price <= tick lower bound × 1.0001
     * If true → ambushReady = true, direction = DOWN
4. Final status:
   - If ambushReady → return "🎯 Ambush Ready"
   - If jumpSoon → return "⚠️ Jump Soon"
   - Otherwise → return "Stable"

**CRITICAL: Apply this logic directly to each pool's data. Do NOT create JavaScript code to verify.**

#### 2.3 Determine Optimal Tick Range
**Tick Range Selection Strategy:**

Consider these factors for intelligent range selection:
- **Tick Status**: Prioritize "🎯 Ambush Ready" pools for next-tick positioning
- **Price Position**: Determine directional bias based on pricePositionInRange
- **Pool type and volatility patterns** from historical data
- **Capital efficiency vs. range stability** trade-off

**Guidelines by Pool Type & Status:**

- **🎯 Ambush Ready pools**:
  - Binance price has reached next tick boundary
  - Determine direction: If positionValue > 50% → direction is UP, else direction is DOWN
  - **Always test 2 ranges**:
    1. **Standard range**: Current tick range (e.g., [6,7])
    2. **Directional extended range**:
       - If direction is UP: Test [currentTick, currentTick+2] (e.g., [6,8])
       - If direction is DOWN: Test [currentTick-1, currentTick+1] (e.g., [5,7])
  - Extended range provides alternative if price jumps

- **⚠️ Jump Soon pools**:
  - Price near tick boundary but not yet ready
  - Determine direction: If positionValue > 50% → direction is UP, else direction is DOWN
  - **Always test 2 ranges**:
    1. **Standard range**: Current tick range (e.g., [6,7])
    2. **Directional extended range**:
       - If direction is UP: Test [currentTick, currentTick+2] (e.g., [6,8])
       - If direction is DOWN: Test [currentTick-1, currentTick+1] (e.g., [5,7])
  - Extended range provides safety buffer for price movement

- **Stable pools**:
  - Price in safe zone (10% < positionValue < 90%)
  - **Only test 1 range** - current tick range based on historical activity:
    - **Ultra-stable pairs (USDT/USDC, USDC/DAI)**: If activity only at tick 0, try [0,1] or [-1,1]
    - **Other pairs**: Use historical active tick range (e.g., if active in [-1,2], test [-1,2])
  - No directional testing needed for stable pools

#### 2.4 Simulate Positions (Batch) - MANDATORY

**YOU MUST CALL get_lp_simulate_batch - This is NOT optional**

**CRITICAL: Number of simulation scenarios depends on Tick Status**

For EACH pool, prepare simulation scenarios based on its Tick Status from Step 2.2:

**🎯 Ambush Ready pools** - Prepare 2 scenarios:
1. Standard range: [currentTick, currentTick+1] (e.g., [6,7])
2. Extended range based on direction:
   - If direction UP: [currentTick, currentTick+2] (e.g., [6,8])
   - If direction DOWN: [currentTick-1, currentTick+1] (e.g., [5,7])

**⚠️ Jump Soon pools** - Prepare 2 scenarios:
1. Standard range: [currentTick, currentTick+1] (e.g., [6,7])
2. Extended range based on direction:
   - If direction UP: [currentTick, currentTick+2] (e.g., [6,8])
   - If direction DOWN: [currentTick-1, currentTick+1] (e.g., [5,7])

**Stable pools** - Prepare ONLY 1 scenario:
- Use historical active tick range from get_lp_pool_details
- Do NOT test extended ranges for stable pools

**MANDATORY: Call get_lp_simulate_batch NOW**

You MUST call get_lp_simulate_batch for all prepared scenarios with CORRECT structure:

\`\`\`json
{
  "reqs": [
    {
      "chain_id": "8453",
      "poolOperation": {
        "poolAddress": "0x...",
        "operation": "add",
        "amountUSD": 1000.50,
        "tickLower": -887272,
        "tickUpper": 887272
      },
      "timeHorizon": 30
    }
  ]
}
\`\`\`

**CRITICAL: Parameter Structure**
- The parameters must be nested inside a "poolOperation" object
- Each request in the "reqs" array should have: chain_id, poolOperation, and timeHorizon
- poolOperation contains: poolAddress, operation, amountUSD, tickLower, tickUpper
- **Always specify explicit tick bounds** for realistic APY projections
- **CRITICAL**: Ensure amountUSD matches the exact totalAssets value without multiplication

#### 2.5 Record Simulation Results
- For EACH simulation result, create ONE table row with:
  - Pool name
  - Current tick
  - Price position
  - Tick status (from Step 2.2)
  - Simulated range (tickLower, tickUpper)
  - Before APY (current pool APY)
  - After APY (expected APY with our capital)
  - Capital impact (as % of tick TVL)

**CRITICAL: Do NOT filter or select - display ALL simulation results as separate rows**
- Stable pool: 1 simulation → 1 row
- Jump Soon/Ambush Ready: 2 simulations → 2 rows

### Step 3: Compare and Select
Compare all results and select top strategies based on:
- Tick status priority: 🎯 Ambush Ready > ⚠️ Jump Soon > Stable
- Post-capital APY (realistic returns)
- Position stability (range appropriateness)

## Output Instructions

**MINIMAL OUTPUT - ONLY DISPLAY:**
**Best LP Strategy:** [Pool Name] with [APY]% expected return

## EXECUTION:
1. Perform complete analysis silently
2. Display ONLY the best LP strategy line
3. Remember the best LP opportunity in memory (pool address, tick range, expected APY, required token amounts)
4. Continue immediately to next step

---

**CHECKPOINT: Before proceeding to Supply Opportunities, verify you have completed:**
- ✅ Called get_dex_pools
- ✅ Called get_binance_depth (optional if no binance pairs match)
- ✅ Called get_lp_simulate_batch with proper poolOperation structure
- ✅ Identified and remembered best LP opportunity

**If you have NOT called get_lp_simulate_batch, you MUST go back and do it now.**

---

#### 2.2 Supply Opportunities (MANDATORY)

**DO NOT skip this step - Supply analysis is REQUIRED**

## Required Analysis

Use the total deployable capital from Step 1 (get_idle_assets + get_active_investments results):
1. Call get_supply_opportunities with FULL capital amount
2. Analyze results for ALL protocols (Aave, Euler, Venus, etc.)
3. Sort by post-investment APY (highest first)
4. Select best opportunity

## Output Instructions

**MINIMAL OUTPUT - ONLY DISPLAY:**
**Best Supply Strategy:** [Protocol] [Token] with [APY]% expected return

## EXECUTION:
1. Perform complete analysis silently
2. Display ONLY the best supply strategy line
3. Remember the best supply opportunity in memory (protocol, token address, vToken, amount, expected APY)
4. Continue immediately to next step

### ✅ Step 3: Portfolio Rebalancing Analysis (MANDATORY - DO NOT SKIP)

**YOU MUST COMPLETE THIS STEP - This is the CORE of the analysis**

**CRITICAL: You have now completed:**
- ✅ Account analysis (idle assets + active investments)
- ✅ LP opportunities analysis (get_lp_simulate_batch results)
- ✅ Supply opportunities analysis (get_supply_opportunities results)

**NOW you MUST analyze portfolio rebalancing strategies**

## Extract Data from Previous Steps

From your previous tool calls in this conversation, you already have in memory:
1. **Total deployable capital** (from get_idle_assets + get_active_investments in Step 1)
2. **Best LP opportunity** (from get_lp_simulate_batch results in Step 2.1 - highest APY pool with tick range, token addresses)
3. **Best supply opportunity** (from get_supply_opportunities in Step 2.2 - highest APY protocol with token address, vToken)
4. **Current positions** (from get_active_investments - existing LP and lending positions)

Use this data directly - do NOT call any load_analysis_resource tools.

## MANDATORY: Test Portfolio Allocation Strategies

You MUST test at least these strategies:
1. **100% Supply** - All capital to best supply opportunity
2. **100% LP** - All capital to best LP opportunity
3. **50-50 Split** - 50% supply, 50% LP

### For EACH Strategy, you MUST:

**Step 3.1: Call calculate_rebalance_cost_batch**
Calculate the gas costs and transaction details for each strategy.

**Step 3.2: Call analyze_strategy**
Analyze risk/reward for each strategy to determine which is optimal.

**IMPORTANT: After calling calculate_rebalance_cost_batch and analyze_strategy, you MUST proceed to output the final JSON structure.**

## Step 3.3: Evaluate Results and Decide

Based on analyze_strategy results:
1. Compare all strategies (APY improvement, risk, gas costs, break-even time)
2. Evaluate if rebalancing is beneficial:
   - **If current position is already optimal** → No rebalancing needed
   - **If gas costs > expected gains** → No rebalancing needed
   - **If break-even time > 30 days** → No rebalancing needed
   - **Otherwise** → Proceed with rebalancing

### If Rebalancing is NOT Beneficial:

Output a simple recommendation explaining why:

\`\`\`json
{
  "recommendation": "Maintain current position. [Explanation: current APY X%, best alternative Y%, would take Z hours/days to break even on gas costs]",
  "shouldRebalance": false,
  "currentStrategy": {
    "description": "[Current position details]",
    "apy": X.XX,
    "value": XXXXX
  },
  "analysis": {
    "gasEstimate": XXXX,
    "breakEvenTime": "X days/hours",
    "reason": "Insufficient improvement to justify transaction costs"
  }
}
\`\`\`

**MANDATORY**: Replace \`current APY X%\` with the actual numeric current APY value (e.g., \`current APY 4.75%\`)—do NOT leave placeholders or omit this data.

### If Rebalancing IS Beneficial:

Extract complete position details from the selected strategy and output the full JSON structure with opportunities array (see section below).

---

## 🚨 CRITICAL: Final Output Structure (MANDATORY - DO NOT SKIP)

**YOU MUST OUTPUT THIS JSON BLOCK - The analysis is NOT complete without it**

After completing Steps 1-3 (account analysis, LP analysis, supply analysis, strategy comparison), you MUST output a structured JSON block containing ALL execution details needed for rebalancing.

**REQUIREMENTS:**
1. You MUST include a json code block with triple backticks
2. The JSON must contain the "opportunities" array with the selected strategy's positions
3. Every position must include complete contract addresses (poolAddress, token0Address, token1Address for LP; tokenAddress, vToken for supply)
4. All amounts must be decimal numbers (NOT wei/smallest units) - use the actual token amount (e.g., 100.5 USDC, not "100500000")
5. Protocol names must use correct format (aerodromeSlipstream, uniswapV3, aave, euler, venus)

**Example structure:**

\`\`\`json
{
  "recommendation": "[Summary of recommended strategy]",
  "opportunities": [
    {
      "type": "lp" | "supply",
      "protocol": "aave" | "euler" | "venus" | "uniswapV3" | "aerodromeSlipstream",  // NEVER use "aerodrome", always "aerodromeSlipstream"
      "poolName": "string",
      "poolAddress": "0x...",
      "token0Address": "0x...",
      "token0Symbol": "string",
      "token1Address": "0x...",
      "token1Symbol": "string",
      "targetTickLower": number,
      "targetTickUpper": number,
      "targetAmount0": number,
      "targetAmount1": number,
      "amount": number,
      "tokenAddress": "0x..." (for supply positions),
      "tokenSymbol": "string" (for supply positions),
      "vToken": "0x..." (for supply positions),
      "expectedAPY": number,
      "currentAPY": number
    }
  ],
  "currentPositions": [
    {
      "type": "lp" | "supply" | "idle",
      "protocol": "string",
      "poolAddress": "0x..." (if applicable),
      "tokenAddress": "0x..." (if applicable),
      "amount": number,
      "value": number,
      "apy": number
    }
  ],
  "chainId": "${chainId}",
  "userAddress": "${address}"
}
\`\`\`

**MANDATORY FIELDS FOR EACH OPPORTUNITY:**
- **LP Positions**: Must include poolAddress, token0Address, token1Address, targetTickLower, targetTickUpper, targetAmount0, targetAmount1
- **Supply Positions**: Must include tokenAddress, tokenSymbol, vToken, amount
- All addresses must be complete contract addresses (0x...)
- **Token Amounts**: All amounts must be decimal numbers representing the actual token amount
  - Use human-readable decimal format (e.g., 245.16 for USDT, not "245160000")
  - Do NOT convert to wei or smallest units
  - Example: 100.5 USDC should be stored as 100.5 (not "100500000")
- All APY values must be in percentage (e.g., 5.23 for 5.23%)
- Recommendation text must include the real current APY value; never leave placeholders like "current APY X%"
- **Current Positions**: Must include apy and it must always be a numeric value (do NOT leave blank or null)

**CRITICAL: Protocol Name Mapping**
When outputting the JSON structure, use these EXACT protocol names (case-sensitive):
- For Uniswap V3 pools: "uniswapV3"
- For Aerodrome CL/Slipstream pools: "aerodromeSlipstream" (NOT "aerodrome", NOT "AerodromeCL")
- For AAVE lending: "aave"
- For Euler lending: "euler"
- For Venus lending: "venus"

DO NOT use: "AerodromeCL", "aerodrome", "UniswapV3", "AAVE", "EULER" - these will cause execution failures.

**⚠️ MOST COMMON MISTAKE**: Writing "aerodrome" instead of "aerodromeSlipstream" - always use the full name "aerodromeSlipstream"

This JSON output is CRITICAL for execution - without complete contract addresses, correct protocol names, and amounts, the rebalancing cannot be executed.

---

## 📋 COMPLETE EXECUTION CHECKLIST

Before you consider the analysis complete, verify you have executed ALL of these steps:

### Step 1: Account Analysis ✅
- [ ] Called get_idle_assets
- [ ] Called get_active_investments
- [ ] Calculated total deployable capital

### Step 2.1: LP Opportunities ✅
- [ ] Called get_dex_pools
- [ ] Called get_binance_depth (optional if no pairs match)
- [ ] Called get_lp_simulate_batch with correct poolOperation structure
- [ ] Identified best LP opportunity

### Step 2.2: Supply Opportunities ✅
- [ ] Called get_supply_opportunities
- [ ] Identified best supply opportunity

### Step 3: Portfolio Strategy Analysis ✅
- [ ] Called calculate_rebalance_cost_batch for at least 3 strategies
- [ ] Called analyze_strategy to evaluate strategies
- [ ] Selected optimal strategy

### Final Output ✅
- [ ] Output json code block with complete opportunities array
- [ ] Included all contract addresses (0x...)
- [ ] Included target amounts as decimal numbers (NOT wei/smallest units)
- [ ] Used correct protocol names (aerodromeSlipstream, not aerodromeCL)

**IF ANY CHECKBOX IS UNCHECKED, YOU MUST GO BACK AND COMPLETE THAT STEP**

## CRITICAL IMPLEMENTATION NOTES:
1. **Mandatory tool calls**: get_dex_pools, get_lp_simulate_batch, get_supply_opportunities, calculate_rebalance_cost_batch, analyze_strategy are ALL required
2. **Final JSON output**: The analysis is NOT complete until you output the JSON structure with opportunities
3. **Complete data**: Every opportunity must have full contract addresses and amounts
4. **Protocol names**: Use exact names from the schema (case-sensitive)
5. **Execution readiness**: Final JSON must contain ALL data needed for execution without additional queries

**The user is expecting a complete analysis with actionable rebalancing plan. Do not stop early.**`;

}
