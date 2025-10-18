# DeFi AI Agent Backend

Backend for DeFi automated rebalancing and yield optimization agent platform based on NestJS + Anthropic Claude SDK.

## Features

- ✅ **Automated Yield Optimization**: Intelligently analyze user positions across AAVE, EULER, Uniswap V3, Aerodrome CL, Venus and other protocols to find better yield strategies
- ✅ **Risk Control First**: Enforced simulation → approval → execution workflow with multi-layer risk protection
- ✅ **Intelligent Monitoring**: Scheduled detection of APR, LP out-of-range and other metrics, automatic rebalancing triggers
- ✅ **Anthropic Claude Agent**: Intelligent decision making using Anthropic Claude SDK with multi-step analysis
- ✅ **MCP Tool Integration**: Call on-chain data and execution modules through MCP protocol
- ✅ **Queue System**: BullMQ-based job queue for async rebalancing task processing

## Architecture Design

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend Web App                        │
│         (Wallet Auth / Position View / Rebalance Control)    │
└─────────────────────┬───────────────────────────────────────┘
                      │ REST API
┌─────────────────────▼───────────────────────────────────────┐
│                  NestJS Backend (This Project)               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Agent Module │  │ Guard Module │  │Monitor Module│     │
│  │(Anthropic SDK│  │(Risk Control)│  │  (Scheduler) │     │
│  │   + Stdio    │  └──────────────┘  └──────────────┘     │
│  │     MCP)     │  ┌──────────────┐  ┌──────────────┐     │
│  └──────┬───────┘  │ Queue Module │  │  API Module  │     │
│         │          │   (BullMQ)   │  │  (REST API)  │     │
│         │          └──────────────┘  └──────────────┘     │
└─────────┼───────────────────────────────────────────────────┘
          │ Stdio (stdin/stdout)
┌─────────▼─────────────────────────────────────────────────┐
│                    MCP Server (Implemented)                 │
│   get_idle_assets / get_active_investments /              │
│   get_account_yield_summary / get_dex_pools /             │
│   get_binance_depth / get_lp_simulate_batch /             │
│   get_supply_opportunities / analyze_strategy /           │
│   calculate_rebalance_cost_batch / rebalance_position     │
└─────────┬─────────────────────────────────────────────────┘
          │
┌─────────▼─────────────────────────────────────────────────┐
│              On-chain DeFi Protocols                        │
│      AAVE / EULER / Venus / UniswapV3 / AerodromeCL        │
└───────────────────────────────────────────────────────────┘
```

## Project Structure

```
src/
├── agent/              # Agent core module (Anthropic Claude SDK + Stdio MCP)
│   ├── agent.service.ts      # Agent execution service
│   ├── agent.types.ts        # Agent type definitions
│   ├── agent.prompt.ts       # System Prompt & context builder
│   ├── analysis.prompt.ts    # Multi-step analysis prompts
│   ├── types/
│   │   └── mcp.types.ts      # MCP tool types
│   └── agent.module.ts
├── guard/              # Risk control module
│   ├── guard.service.ts      # Risk control logic
│   └── guard.module.ts
├── monitor/            # Monitoring scheduler module
│   ├── monitor.service.ts           # Scheduled tasks & trigger logic
│   ├── monitor.controller.ts        # Monitor API endpoints
│   ├── rebalance-precheck.service.ts # Pre-check logic
│   └── monitor.module.ts
├── queue/              # Queue module
│   ├── rebalance-queue.service.ts   # BullMQ queue service
│   └── queue.module.ts
├── api/                # REST API module
│   ├── rebalance.controller.ts  # Rebalance API controller
│   ├── user.controller.ts       # User API controller
│   ├── user.service.ts          # User service
│   ├── dto/                     # Request DTOs
│   │   ├── rebalance.dto.ts
│   │   ├── user.dto.ts
│   │   └── execution-steps.dto.ts
│   └── api.module.ts
├── entities/           # Database entities
│   ├── user.entity.ts          # User entity
│   ├── user-policy.entity.ts   # User risk control policy
│   └── rebalance-job.entity.ts # Rebalance job records
├── utils/              # Utilities
│   ├── chain-verifier.util.ts  # Chain transaction verifier
│   └── plan-to-steps.util.ts   # Plan to execution steps converter
├── config/             # Configuration
│   └── database.config.ts
├── migrations/         # Database migrations
├── app.module.ts       # Main application module
└── main.ts             # Entry point
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in the configuration:

```bash
cp .env.example .env
```

Required configuration:
- `ANTHROPIC_API_KEY`: Anthropic API key
- `MODEL`: Anthropic model (default claude-3-5-sonnet-20241022)
- `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`: Database configuration
- `REDIS_HOST`, `REDIS_PORT`: Redis configuration for BullMQ
- `MCP_SERVER_COMMAND`: MCP Server startup command (e.g. `npx` or `node`)
- `MCP_SERVER_ARGS`: MCP Server arguments (comma-separated, e.g. `-y,@modelcontextprotocol/server-defi`)

### 3. Start Database and Redis

Ensure MySQL and Redis are running:

```bash
# Create database (MySQL)
mysql -u root -p -e "CREATE DATABASE defi_agent;"

# Start Redis (if not already running)
redis-server
```

### 4. Start Service

```bash
# Development mode
npm run start:dev

# Production mode
npm run build
npm run start:prod
```

## Core Workflow

### Automated Rebalancing Workflow

1. **Monitoring Trigger** (Scheduled, currently disabled)
   - Check all users with `autoEnabled=true`
   - Run precheck to filter users who need rebalancing
   - Add eligible users to rebalancing queue

2. **Queue Processing**
   - BullMQ worker picks up jobs from queue
   - Execute agent analysis for each job
   - Handle retries and failures

3. **Multi-Step Agent Analysis**
   - **Step 1**: Fetch account yield summary (`get_account_yield_summary`)
   - **Step 2**: Analyze LP opportunities with market data (`get_dex_pools`, `get_binance_depth`, `get_lp_simulate_batch`, `get_supply_opportunities`)
   - **Step 3**: Evaluate best strategy and generate rebalance plan (`analyze_strategy`, `calculate_rebalance_cost_batch`)

4. **Risk Control Approval**
   - Check net profit, APR improvement, health factor, slippage, gas cost
   - Approved → job status updated to APPROVED
   - Rejected → record reason

5. **On-chain Execution** (Manual or automatic)
   - Call MCP `rebalance_position` with execution plan
   - Verify transaction on-chain
   - Record transaction hash and status

## MCP Server Integration

This project integrates MCP Server using **Stdio MCP** approach. The Agent communicates with MCP Server through standard input/output.

### MCP Server Requirements

MCP Server must implement the following tools (following [MCP Protocol](https://modelcontextprotocol.io/)):

| Tool Name | Function |
|--------|------|
| `get_idle_assets` | Get user's idle assets |
| `get_active_investments` | Get user's active investment positions |
| `get_account_yield_summary` | Get comprehensive account yield summary |
| `get_dex_pools` | Get DEX pool information and recent active ticks |
| `get_binance_depth` | Get Binance order book depth data |
| `get_lp_simulate_batch` | Batch simulate LP position scenarios |
| `get_supply_opportunities` | Get lending/supply opportunities across protocols |
| `analyze_strategy` | Analyze rebalancing strategy (optional) |
| `calculate_rebalance_cost_batch` | Calculate rebalancing costs (optional) |
| `rebalance_position` | Execute actual rebalancing transaction |

### Launch Configuration

Configure in `.env`:

```bash
# Use npx to launch npm package
MCP_SERVER_COMMAND=npx
MCP_SERVER_ARGS=-y,@modelcontextprotocol/server-defi

# Or use node to launch local script
MCP_SERVER_COMMAND=node
MCP_SERVER_ARGS=/path/to/your/mcp-server.js

# Or use Python
MCP_SERVER_COMMAND=python
MCP_SERVER_ARGS=/path/to/your/mcp_server.py
```

### How to Configure Your MCP Server

If you have already implemented the MCP Server, simply configure the startup command in `.env`. For example:

```bash
# If your MCP Server is a Node.js script
MCP_SERVER_COMMAND=node
MCP_SERVER_ARGS=/path/to/your/defi-mcp-server/index.js

# If you use TypeScript + tsx
MCP_SERVER_COMMAND=npx
MCP_SERVER_ARGS=tsx,/path/to/your/defi-mcp-server/index.ts

# If your MCP Server is a Python script
MCP_SERVER_COMMAND=python3
MCP_SERVER_ARGS=/path/to/your/defi-mcp-server/server.py
```

The backend will automatically connect to the MCP Server on startup and call MCP tools via Stdio during each Agent run.

## Risk Control Parameters

Each user can configure the following risk control parameters:

| Parameter | Description | Default |
|------|------|--------|
| `minAprLiftBps` | Minimum APR improvement (basis points) | 50 |
| `minNetUsd` | Minimum net profit (USD) | 10 |
| `minHealthFactor` | Minimum health factor | 1.5 |
| `maxSlippageBps` | Maximum slippage (basis points) | 100 |
| `maxGasUsd` | Maximum gas cost (USD) | 50 |
| `maxPerTradeUsd` | Maximum trade amount per transaction (USD) | 10000 |
| `autoEnabled` | Enable automatic rebalancing | false |


## Monitoring & Logging

All operations are recorded in the `rebalance_jobs` table, including:
- Input context
- Simulation report
- Execution results
- Status changes
- Error messages


## License

MIT
