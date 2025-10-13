/**
 * Analysis prompt template for complete DeFi analysis
 * Based on MCP complete_defi_analysis prompt
 */

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
- Save the complete analysis data using save_analysis_resource tool:
  - sessionId: "${address}"
  - resourceType: "account"
  - data: Simple JSON structure with only statistics:
    {
      "walletAddress": "${address}",
      "chainId": "${chainId}",
      "totalAssets": number,
      "currentAPY": number,
      "timestamp": "ISO-8601"
    }
- Continue immediately to Step 2 without any output

### ✅ Step 2: Market Opportunities Analysis

**MANDATORY: You MUST complete BOTH LP Opportunities AND Supply Opportunities analysis**

#### 2.1 LP Opportunities with Tick Status Analysis (MANDATORY)

## Load Account Analysis Data

Use load_analysis_resource:
- sessionId: "${address}"
- resourceType: "account"
- Extract deployableCapital from loaded data

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
      "timeHorizon": 60
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

### Save Analysis Results
Use save_analysis_resource:
- sessionId: "${address}"
- resourceType: "lp"
- data: Complete JSON structure

## EXECUTION:
1. Perform complete analysis silently
2. Display ONLY the best LP strategy line
3. Save complete data to resource without notification
4. Continue immediately to next step

---

**CHECKPOINT: Before proceeding to Supply Opportunities, verify you have completed:**
- ✅ Called get_dex_pools
- ✅ Called get_binance_depth (optional if no binance pairs match)
- ✅ Called get_lp_simulate_batch with proper poolOperation structure
- ✅ Saved LP analysis results

**If you have NOT called get_lp_simulate_batch, you MUST go back and do it now.**

---

#### 2.2 Supply Opportunities (MANDATORY)

**DO NOT skip this step - Supply analysis is REQUIRED**

## Load Account Analysis Data

Use load_analysis_resource:
- sessionId: "${address}"
- resourceType: "account"
- Extract deployableCapital from loaded data

## Required Analysis
1. Call get_supply_opportunities with FULL capital amount
2. Analyze results for ALL protocols (Aave, Euler, Venus, etc.)
3. Sort by post-investment APY (highest first)
4. Select best opportunity

## Output Instructions

**MINIMAL OUTPUT - ONLY DISPLAY:**
**Best Supply Strategy:** [Protocol] [Token] with [APY]% expected return

### Save Analysis Results
Use save_analysis_resource:
- sessionId: "${address}"
- resourceType: "supply"
- data: Complete JSON structure

## EXECUTION:
1. Perform complete analysis silently
2. Display ONLY the best supply strategy line
3. Save complete data to resource without notification
4. Continue immediately to next step

### ✅ Step 3: Basic Portfolio Rebalancing Analysis

## Load Analysis Data

Load from saved resources using load_analysis_resource:
- Load account resource: sessionId="${address}", resourceType="account"
- Load LP resource: sessionId="${address}", resourceType="lp"
- Load supply resource: sessionId="${address}", resourceType="supply"

Extract:
- totalCapital from account analysis (deployableCapital field)
- currentPortfolio APY and value from account analysis
- Best LP strategy details from LP opportunities (topStrategy field)
- Best supply strategy details from supply opportunities (topStrategy field)

## MANDATORY: Test These Allocation Strategies

### Base Strategies (Must Test All)
1. **Status Quo** - Keep current allocation
2. **100% LP** - All capital to LP strategy
3. **100% Supply** - All capital to Supply strategy
4. **75-25** - 75% LP, 25% Supply
5. **50-50** - 50% LP, 50% Supply
6. **25-75** - 25% LP, 75% Supply

### For EACH Strategy:
1. **Calculate target positions**:
   - LP portion: Use requiredTokens ratio from LP topStrategy
   - Supply portion: Use target token from Supply topStrategy

2. **Call calculate_rebalance_cost_batch (MANDATORY)**
3. **Analyze strategies using analyze_strategy tool (MANDATORY)**

## Output Instructions

**MINIMAL OUTPUT - ONLY DISPLAY:**

### Current Portfolio Allocation
**Current Portfolio Allocation:**
| Category | Protocol | Token | Amount | USD Value | APY | Details |
|----------|----------|-------|--------|-----------|-----|---------|
| [category] | [protocol] | [symbol/pair] | [amount] | $[value] | [apy]% | [details] |

### Target Portfolio Allocation
**Target Portfolio Allocation:**
| Category | Protocol | Token | Amount | USD Value | APY | Details |
|----------|----------|-------|--------|-----------|-----|---------|
| [category] | [protocol] | [symbol/pair] | [amount] | $[value] | [apy]% | [details] |

### Save Analysis Results
Use save_analysis_resource:
- sessionId: "${address}"
- resourceType: "rebalance"
- data: Complete JSON structure with target portfolio positions

## EXECUTION:
1. Perform complete rebalancing analysis silently
2. Test all required strategies using calculate_rebalance_cost_batch
3. Use analyze_strategy tool for strategy evaluation
4. Display ONLY the two portfolio allocation tables
5. Save complete data to resource without notification
6. Analysis complete

## CRITICAL: Final Output Structure

After completing all analysis steps, you MUST output a structured JSON block containing ALL execution details needed for rebalancing:

\`\`\`json
{
  "recommendation": "[Summary of recommended strategy]",
  "opportunities": [
    {
      "type": "lp" | "supply",
      "protocol": "aave" | "euler" | "venus" | "uniswapV3" | "aerodromeSlipstream",
      "poolName": "string",
      "poolAddress": "0x...",
      "token0Address": "0x...",
      "token0Symbol": "string",
      "token1Address": "0x...",
      "token1Symbol": "string",
      "targetTickLower": number,
      "targetTickUpper": number,
      "targetAmount0": "string",
      "targetAmount1": "string",
      "amount": "string",
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
      "amount": "string",
      "value": number
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
- All amounts must be in wei/smallest unit as strings
- All APY values must be in percentage (e.g., 5.23 for 5.23%)

**CRITICAL: Protocol Name Mapping**
When outputting the JSON structure, use these EXACT protocol names (case-sensitive):
- For Uniswap V3 pools: "uniswapV3"
- For Aerodrome CL/Slipstream pools: "aerodromeSlipstream"
- For AAVE lending: "aave"
- For Euler lending: "euler"
- For Venus lending: "venus"

DO NOT use: "AerodromeCL", "aerodrome", "UniswapV3", "AAVE", "EULER" - these will cause execution failures.

This JSON output is CRITICAL for execution - without complete contract addresses, correct protocol names, and amounts, the rebalancing cannot be executed.

## CRITICAL IMPLEMENTATION NOTES:
1. **Silent execution**: Steps execute without verbose output
2. **Minimal display**: Only show specified outputs AND the final JSON structure
3. **Complete analysis**: All calculations and tool calls remain unchanged
4. **Data persistence**: All data saved to resources for later use
5. **Streamlined UX**: User sees only essential information
6. **Execution readiness**: Final JSON contains ALL data needed for execution without additional queries`;
}
