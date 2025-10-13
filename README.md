# DeFi AI Agent Backend

基于 NestJS + OpenAI Agents SDK 的 DeFi 自动调仓与收益优化 Agent 平台后端。

## 功能特性

- ✅ **自动收益优化**：智能分析用户在 AAVE、EULER、Uniswap V3、Aerodrome CL 等协议的仓位，寻找更优收益策略
- ✅ **风控先行**：强制仿真 → 审批 → 执行流程，多层风控保护
- ✅ **智能监控**：定时检测 APR、LP out-of-range 等指标，自动触发调仓
- ✅ **OpenAI Agent**：使用 OpenAI Agents SDK + Responses API 实现智能决策
- ✅ **MCP 工具集成**：通过 MCP 协议调用链上数据与执行模块

## 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                      前端 Web 应用                           │
│              (钱包授权 / 仓位查看 / 调仓控制)                 │
└─────────────────────┬───────────────────────────────────────┘
                      │ REST API
┌─────────────────────▼───────────────────────────────────────┐
│                  NestJS Backend (本项目)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Agent Module │  │ Guard Module │  │Monitor Module│     │
│  │ (OpenAI SDK) │  │  (风控审核)  │  │  (定时调度)  │     │
│  │   + Stdio    │  └──────────────┘  └──────────────┘     │
│  │     MCP      │  ┌──────────────┐  ┌──────────────┐     │
│  └──────┬───────┘  │   Database   │  │  API Module  │     │
│         │          │  (Postgres)  │  │ (REST接口)   │     │
│         │          └──────────────┘  └──────────────┘     │
└─────────┼───────────────────────────────────────────────────┘
          │ Stdio (stdin/stdout)
┌─────────▼─────────────────────────────────────────────────┐
│                    MCP Server (已实现)                      │
│   get_positions / analyze_yields / plan_rebalance         │
│   simulate / execute_steps                                 │
└─────────┬─────────────────────────────────────────────────┘
          │
┌─────────▼─────────────────────────────────────────────────┐
│              链上 DeFi 协议                                 │
│      AAVE / EULER / UniswapV3 / AerodromeCL                │
└───────────────────────────────────────────────────────────┘
```

## 项目结构

```
src/
├── agent/              # Agent 核心模块 (OpenAI Agents SDK + Stdio MCP)
│   ├── agent.service.ts      # Agent 执行服务
│   ├── agent.types.ts        # Agent 类型定义
│   ├── agent.prompt.ts       # System Prompt & 上下文构建
│   └── agent.module.ts
├── guard/              # 风控审核模块
│   ├── guard.service.ts      # 风控逻辑
│   └── guard.module.ts
├── monitor/            # 监控调度模块
│   ├── monitor.service.ts    # 定时任务与触发逻辑
│   └── monitor.module.ts
├── api/                # REST API 模块
│   ├── rebalance.controller.ts  # API 控制器
│   ├── dto/                     # 请求 DTO
│   └── api.module.ts
├── entities/           # 数据库实体
│   ├── user-policy.entity.ts   # 用户风控策略
│   └── rebalance-job.entity.ts # 调仓任务记录
├── config/             # 配置
│   └── database.config.ts
├── app.module.ts       # 主应用模块
└── main.ts             # 入口文件
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并填写配置：

```bash
cp .env.example .env
```

必需配置：
- `OPENAI_API_KEY`: OpenAI API 密钥
- `OPENAI_MODEL`: OpenAI 模型 (默认 gpt-4o)
- `DB_*`: PostgreSQL 数据库配置
- `MCP_SERVER_COMMAND`: MCP Server 启动命令 (如 `npx` 或 `node`)
- `MCP_SERVER_ARGS`: MCP Server 参数 (逗号分隔，如 `-y,@modelcontextprotocol/server-defi`)

### 3. 启动数据库

确保 PostgreSQL 已启动并创建数据库：

```bash
createdb defi_agent
```

### 4. 启动服务

```bash
# 开发模式
npm run start:dev

# 生产模式
npm run build
npm run start:prod
```

## API 文档

### 用户策略管理

#### 获取用户策略
```
GET /api/policy/:userId
```

#### 更新用户策略
```
PUT /api/policy/:userId
Body: {
  "minAprLiftBps": 50,
  "minNetUsd": 10,
  "autoEnabled": true,
  ...
}
```

### 仓位查询

#### 获取用户仓位
```
GET /api/positions/:userId?chains=ethereum,base
```

### 调仓操作

#### 预览调仓 (仅仿真)
```
POST /api/preview
Body: {
  "userId": "0x123...",
  "trigger": "manual_preview"
}
```

#### 触发调仓任务
```
POST /api/rebalance
Body: {
  "userId": "0x123...",
  "trigger": "manual_trigger"
}
```

#### 查询任务状态
```
GET /api/jobs/:jobId
```

#### 查询用户任务历史
```
GET /api/jobs/user/:userId?limit=50
```

#### 手动执行已审批任务
```
POST /api/execute
Body: {
  "jobId": "uuid"
}
```

## 核心流程

### 自动调仓流程

1. **监控触发** (每 5 分钟)
   - 检查所有 `autoEnabled=true` 的用户
   - 获取链上仓位
   - 分析收益率
   - 判断是否需要调仓

2. **Agent 分析**
   - OpenAI Agent 调用 MCP 工具
   - 执行：`get_positions` → `analyze_yields` → `plan_rebalance` → `simulate`
   - 生成仿真报告

3. **风控审批**
   - 检查净收益、APR 提升、健康因子、滑点、Gas 成本
   - 通过 → 进入执行阶段
   - 拒绝 → 记录原因

4. **执行上链**
   - 调用 MCP `execute_steps`
   - 记录交易哈希
   - 更新任务状态

## MCP Server 集成

本项目使用 **Stdio MCP** 方式集成 MCP Server。Agent 通过标准输入输出与 MCP Server 通信。

### MCP Server 要求

MCP Server 需实现以下工具（遵循 [MCP 协议](https://modelcontextprotocol.io/)）：

| 工具名 | 功能 |
|--------|------|
| `get_positions` | 获取用户链上仓位 |
| `analyze_yields` | 分析收益率并找出优化机会 |
| `plan_rebalance` | 生成调仓执行计划 |
| `simulate` | 仿真执行计划 |
| `execute_steps` | 实际执行调仓 |

### 启动方式

在 `.env` 中配置：

```bash
# 使用 npx 启动 npm 包
MCP_SERVER_COMMAND=npx
MCP_SERVER_ARGS=-y,@modelcontextprotocol/server-defi

# 或使用 node 启动本地脚本
MCP_SERVER_COMMAND=node
MCP_SERVER_ARGS=/path/to/your/mcp-server.js

# 或使用 Python
MCP_SERVER_COMMAND=python
MCP_SERVER_ARGS=/path/to/your/mcp_server.py
```

### 如何配置你的MCP Server

由于你已经实现了MCP Server，只需要在 `.env` 中配置启动命令。例如：

```bash
# 如果你的MCP Server是一个Node.js脚本
MCP_SERVER_COMMAND=node
MCP_SERVER_ARGS=/path/to/your/defi-mcp-server/index.js

# 如果你使用TypeScript + tsx
MCP_SERVER_COMMAND=npx
MCP_SERVER_ARGS=tsx,/path/to/your/defi-mcp-server/index.ts

# 如果你的MCP Server是Python脚本
MCP_SERVER_COMMAND=python3
MCP_SERVER_ARGS=/path/to/your/defi-mcp-server/server.py
```

后端会在启动时自动连接到MCP Server，并在每次Agent运行时通过Stdio调用MCP工具。

## 风控参数

每个用户可配置以下风控参数：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `minAprLiftBps` | 最小 APR 提升 (基点) | 50 |
| `minNetUsd` | 最小净收益 (USD) | 10 |
| `minHealthFactor` | 最小健康因子 | 1.5 |
| `maxSlippageBps` | 最大滑点 (基点) | 100 |
| `maxGasUsd` | 最大 Gas 成本 (USD) | 50 |
| `maxPerTradeUsd` | 单笔最大交易额 (USD) | 10000 |
| `autoEnabled` | 是否开启自动调仓 | false |

## 安全考虑

- ✅ 强制仿真阶段，禁止直接执行
- ✅ 多层风控审核
- ✅ 协议白名单限制
- ✅ 资产白名单限制
- ✅ 执行幂等性保证
- ✅ 完整的任务审计日志

## 监控与日志

所有操作均记录在 `rebalance_jobs` 表中，包括：
- 输入上下文
- 仿真报告
- 执行结果
- 状态变化
- 错误信息

## 开发计划

- [ ] 添加更多协议支持 (Compound, Morpho, Curve)
- [ ] 实现 WebSocket 实时推送
- [ ] Agent 协同架构 (多 Agent 分工)
- [ ] Prometheus 监控指标
- [ ] 前端 Dashboard

## License

MIT

## 作者

张兰西
