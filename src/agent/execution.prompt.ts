/**
 * Execution prompt template for rebalance execution
 * Based on MCP prepare_and_execute_rebalance but adapted to use provided plan data
 */

export interface ExecutionPromptParams {
  userId: string;
  safeAddress: string;
  idempotencyKey: string;
  plan: any;
  chainId?: string;
}

export function buildExecutionPrompt(params: ExecutionPromptParams): string {
  const { userId, safeAddress, idempotencyKey, plan, chainId = '8453' } = params;

  return `Execute portfolio rebalancing using provided plan data

## Step 1: Extract Plan Data

**User Information:**
- User ID: ${userId}
- Safe Address: ${safeAddress}
- Chain ID: ${chainId}
- Idempotency Key: ${idempotencyKey}

**Provided Plan:**
${JSON.stringify(plan, null, 2)}

**EXECUTION: Extract data silently, no output needed**

## Step 2: Prepare Rebalance Call

**Extract data from provided plan:**

1. **safeAddress**: ${safeAddress}

2. **opportunities data**: Plan contains "opportunities" array with complete position information including:
   - Contract addresses: poolAddress, tokenAddress, vToken, token0Address, token1Address
   - Amounts: amount, targetAmount0, targetAmount1
   - Tick ranges: targetTickLower, targetTickUpper (for LP positions)
   - Protocol information and asset details

3. **targetLendingSupplyPositions**: Extract from plan.opportunities where protocol in ["aave", "euler", "venus"]
   - Map to format: { protocol, token: tokenAddress, vToken, amount }
   - **All contract addresses are already in the opportunities data**

4. **targetLiquidityPositions**: Extract from plan.opportunities where protocol in ["uniswapV3", "aerodromeSlipstream", "aerodrome"]
   - Map to format: { protocol, poolAddress, token0Address, token1Address, targetTickLower, targetTickUpper, targetAmount0, targetAmount1 }
   - **All addresses and tick ranges are already in the opportunities data**

**IMPORTANT**:
- The plan.opportunities array contains COMPLETE position data with ALL required contract addresses
- Extract positions directly from opportunities objects
- Do NOT ask for missing addresses - they are all present in the opportunities data
- If plan.opportunities is missing or empty, THEN inform user that plan is incomplete

**EXECUTION: Prepare data silently, no output needed**

## Step 3: Execute Rebalance

**⚠️ CRITICAL: Validate Plan Data**
1. Verify plan contains valid position data
2. Confirm target positions are not empty
3. Extract safeAddress and ensure it's valid
4. If missing critical data, STOP and inform user

**⚠️ CRITICAL: Token Amounts**

When preparing positions for rebalance_position tool:
- Use amounts directly from plan data
- Each position's amount reflects its specific allocation
- Example:
  * LP position: targetAmount0, targetAmount1 from plan
  * Supply position: tokenAmount from plan
- Extract amounts from the provided plan structure

Call rebalance_position MCP tool:
\`\`\`
rebalance_position({
  safeAddress: "${safeAddress}",        // Required: Safe wallet address
  walletAddress: "${safeAddress}",      // Required: User wallet address (same as safe)
  chainId: "${chainId}",                // Chain ID
  targetLendingSupplyPositions: [       // Required: Target lending positions
    {
      protocol: "aave",                  // "aave", "euler", or "venus"
      token: "0x...",                    // Token contract address
      vToken: "0x...",                   // vToken address from plan
      amount: "1.1"                      // Amount from plan
    }
  ],
  targetLiquidityPositions: [           // Optional: Target LP positions
    {
      protocol: "aerodromeSlipstream",   // "uniswapV3" or "aerodromeSlipstream"
      poolAddress: "0x...",              // Pool contract address
      token0Address: "0x...",            // Token0 contract address
      token1Address: "0x...",            // Token1 contract address
      targetTickLower: -887272,          // Lower tick
      targetTickUpper: 887272,           // Upper tick
      targetAmount0: "1.1",              // Amount from plan
      targetAmount1: "2.2"               // Amount from plan
    }
  ]
})
\`\`\`

**Important:** If plan data is incomplete or missing positions:
- DO NOT proceed with rebalance
- Inform user that plan is incomplete
- Request complete plan data with position details

**EXECUTION: Execute rebalance call silently, no output needed**

## Step 4: Display Results

**MINIMAL OUTPUT - ONLY DISPLAY:**

If execution successful:
**Rebalancing Executed:**
✅ Successfully deployed strategy (Expected APY from plan)
📎 Transaction: https://basescan.org/tx/[transaction_hash]

If execution failed:
**Rebalancing Failed:**
❌ Error: [error message]
Please check Safe wallet gas balance and approvals.

**FORBIDDEN:**
- Do NOT display execution summaries with multiple sections
- Do NOT list next steps separately
- Do NOT show gas details or other verbose information
- Keep output to 2-3 lines maximum

## Error Handling

If rebalance_position fails:
1. Check if Safe Module service is available
2. Verify Safe wallet has sufficient gas
3. Ensure all required approvals are in place
4. Display error concisely as shown above

Execute the rebalance now.`;
}
