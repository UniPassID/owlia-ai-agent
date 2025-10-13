# 架构决策记录 (Architecture Decision Record)

## ADR-001: Agent 实例创建策略

**日期**: 2025-10-09
**状态**: ✅ 已实施

### 上下文

在使用 OpenAI Agents SDK 时，需要决定如何管理 Agent 实例的生命周期：
1. 每次请求创建新实例
2. 全局单例复用
3. 混合方案

### 问题

- **性能考虑**: 每次创建 Agent 实例和 MCP Server 连接都有开销
- **上下文隔离**: 不同用户/任务的请求不应相互影响
- **资源消耗**: MCP Server 连接建立成本较高

### 决策

**采用混合方案**：
- ✅ MCP Server 连接：全局单例，在服务初始化时创建一次
- ✅ Agent 实例：每次请求创建新实例，确保上下文隔离

### 实现

```typescript
@Injectable()
export class AgentService implements OnModuleInit {
  private mcpServer: MCPServerStdio;  // 单例，复用
  private model: string;

  async onModuleInit() {
    // 只连接一次 MCP Server（成本高）
    this.mcpServer = new MCPServerStdio({ ... });
    await this.mcpServer.connect();
  }

  private createAgent(): Agent {
    // 每次创建新 Agent（成本低），复用 MCP 连接
    return new Agent({
      model: this.model,
      instructions: SYSTEM_PROMPT,
      mcpServers: [this.mcpServer], // 复用连接
    });
  }

  async runRebalanceAgent(context: AgentContext) {
    const agent = this.createAgent(); // 新实例，干净上下文
    return await run(agent, userContext);
  }
}
```

### 优势

1. **上下文隔离** ✅
   - 每个用户的请求使用独立的 Agent 实例
   - 避免用户A的对话历史影响用户B
   - 避免任务间的状态污染

2. **性能优化** ✅
   - MCP Server 连接只建立一次
   - 避免重复的 stdio 进程启动
   - Agent 创建成本远低于 MCP 连接

3. **资源效率** ✅
   - 单个 MCP Server 进程服务所有请求
   - 减少系统资源占用
   - 降低网络/IO 开销

### 场景分析

#### 场景1: 并发请求
```
时刻 T1: 用户A触发调仓
  → 创建 Agent_A → run(Agent_A, context_A) → 使用 MCP_Shared

时刻 T2: 用户B触发调仓
  → 创建 Agent_B → run(Agent_B, context_B) → 使用 MCP_Shared

结果: Agent_A 和 Agent_B 完全独立，无状态污染 ✅
```

#### 场景2: 定时任务
```
每5分钟监控任务:
  for user in enabled_users:
    agent = createAgent()  // 每个用户新实例
    run(agent, user_context)

结果: 每个用户的分析完全独立 ✅
```

#### 场景3: MCP Server 故障
```
MCP Server 崩溃
  → onModuleInit 时连接失败
  → 应用启动失败，而非运行时错误

结果: 快速失败，便于诊断 ✅
```

### 性能对比

| 方案 | MCP 连接次数 | Agent 创建次数 | 上下文隔离 | 内存占用 |
|------|-------------|---------------|-----------|---------|
| 全局单例 | 1 | 1 | ❌ 差 | ⭐ 最低 |
| 每次创建 | N | N | ✅ 好 | ❌ 高 |
| **混合方案** | **1** | **N** | **✅ 好** | **⭐ 低** |

### 替代方案（未采用）

#### 方案A: 全局单例 Agent
```typescript
// ❌ 未采用
private agent: Agent;

async onModuleInit() {
  this.agent = new Agent(...);
}

async run(context) {
  return await run(this.agent, context); // 可能污染
}
```

**拒绝理由**:
- 上下文可能在请求间泄露
- 用户A的对话可能影响用户B
- OpenAI SDK 可能保留内部状态

#### 方案B: 每次创建 MCP 连接
```typescript
// ❌ 未采用
async run(context) {
  const mcp = new MCPServerStdio(...);
  await mcp.connect();
  const agent = new Agent({ mcpServers: [mcp] });
  const result = await run(agent, context);
  await mcp.close();
}
```

**拒绝理由**:
- MCP Server 进程启动开销大（stdio fork）
- 并发请求会创建大量进程
- 资源浪费严重

### 监控指标

建议监控以下指标验证决策效果：

1. **MCP 连接健康度**
   - MCP Server 进程数量（应为1）
   - MCP 连接重连次数

2. **Agent 性能**
   - Agent 创建耗时
   - 每次 run() 调用耗时

3. **内存使用**
   - AgentService 内存占用
   - 并发请求时的内存峰值

### 未来优化方向

如果出现性能瓶颈，可考虑：

1. **Agent 对象池**
   ```typescript
   private agentPool: Agent[] = [];

   private getAgent(): Agent {
     return this.agentPool.pop() || this.createAgent();
   }

   private releaseAgent(agent: Agent) {
     // 清理状态后归还
     this.agentPool.push(agent);
   }
   ```

2. **多 MCP Server 实例**
   ```typescript
   // 如果 MCP Server 成为瓶颈
   private mcpServers: MCPServerStdio[];

   private getMcpServer(): MCPServerStdio {
     // 轮询或负载均衡
   }
   ```

### 参考

- [OpenAI Agents SDK - MCP Integration](https://openai.github.io/openai-agents-js/guides/mcp/)
- [Model Context Protocol](https://modelcontextprotocol.io/)

---

## 总结

**当前方案在上下文隔离和性能之间取得了最佳平衡**，适合生产环境使用。
