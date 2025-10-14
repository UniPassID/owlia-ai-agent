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
   - **protocol field is REQUIRED** - must be one of: "aave", "euler", "venus"
   - **All contract addresses are already in the opportunities data**
   - **Amount should be converted to string** (e.g., amount: "1000.25")

4. **targetLiquidityPositions**: Extract from plan.opportunities where protocol in ["uniswapV3", "aerodromeSlipstream"]
   - Map to format: { protocol, poolAddress, token0Address, token1Address, targetTickLower, targetTickUpper, targetAmount0, targetAmount1 }
   - **protocol field is REQUIRED** - must be one of: "uniswapV3", "aerodromeSlipstream"
   - **All addresses and tick ranges are already in the opportunities data**
   - **Amounts should be converted to strings** (e.g., targetAmount0: "100.5", targetAmount1: "200.75")
   - **⚠️ CRITICAL**: When copying protocol field from plan.opportunities:
     * If you see "aerodrome" → MUST change it to "aerodromeSlipstream"
     * If you see "aerodromeSlipstream" → Use it as-is (correct)
     * Always use "aerodromeSlipstream", never "aerodrome" in the execution call

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
- Use amounts directly from plan data as decimal numbers (NOT wei/smallest units)
- The plan already contains decimal amounts (e.g., 100.5 USDC)
- Convert decimal amounts to strings for the API call
- DO NOT multiply by 10^decimals or convert to wei
- Example:
  * LP position: targetAmount0: "100.5", targetAmount1: "200.75" (from plan)
  * Supply position: amount: "1000.25" (from plan)
- Extract amounts from the provided plan structure and convert to strings

Call rebalance_position MCP tool:
\`\`\`
rebalance_position({
  safeAddress: "${safeAddress}",        // Required: Safe wallet address
  walletAddress: "${safeAddress}",      // Required: User wallet address (same as safe)
  chainId: "${chainId}",                // Chain ID
  targetLendingSupplyPositions: [       // Required: Target lending positions
    {
      protocol: "aave",                  // REQUIRED: "aave", "euler", or "venus"
      token: "0x...",                    // REQUIRED: Token contract address
      vToken: "0x...",                   // REQUIRED: vToken address from plan
      amount: "1.1"                      // REQUIRED: Amount from plan (as decimal string)
    }
  ],
  targetLiquidityPositions: [           // Optional: Target LP positions
    {
      protocol: "aerodromeSlipstream",   // REQUIRED: "uniswapV3" or "aerodromeSlipstream"
      poolAddress: "0x...",              // REQUIRED: Pool contract address
      token0Address: "0x...",            // REQUIRED: Token0 contract address
      token1Address: "0x...",            // REQUIRED: Token1 contract address
      targetTickLower: -887272,          // REQUIRED: Lower tick
      targetTickUpper: 887272,           // REQUIRED: Upper tick
      targetAmount0: "1.1",              // REQUIRED: Amount from plan (as decimal string)
      targetAmount1: "2.2"               // REQUIRED: Amount from plan (as decimal string)
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
