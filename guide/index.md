# AI Agent Guide: agentic

Shared framework for multi-turn AI conversations and tool orchestration.

## Core Components

### ConversationBuilder

Build and manage multi-turn conversations:

```typescript
import { ConversationBuilder } from 'agentic';

const conversation = ConversationBuilder.fromPrompt(prompt)
  .addUserMessage('Hello!')
  .addAssistantMessage('Hi!')
  .addAssistantWithToolCalls([{ name: 'search', args: { q: 'test' } }])
  .addToolResult('result-id', 'Search results...')
  .build();
```

### ToolRegistry

Register and execute tools:

```typescript
import { ToolRegistry } from 'agentic';

const registry = new ToolRegistry();

registry.register({
  name: 'search',
  description: 'Search the web',
  parameters: {
    query: { type: 'string', required: true }
  },
  execute: async ({ query }) => ({ results: [] })
});

// Export for different LLM formats
registry.toOpenAIFormat();
registry.toAnthropicFormat();
```

### IterationStrategy

Define phased execution:

```typescript
import { IterationStrategyFactory, StrategyExecutor } from 'agentic';

const strategy = IterationStrategyFactory.create('iterative-refinement', {
  maxIterations: 5
});

const executor = new StrategyExecutor(strategy, llmClient);
```

### Reflection

Analyze execution:

```typescript
import { MetricsCollector, ReflectionReportGenerator } from 'agentic';

const collector = new MetricsCollector();
collector.recordToolCall('search', 150, true);

const report = ReflectionReportGenerator.generate(collector.getMetrics());
```

## Dependencies

- `zod` - Schema validation
- `execution` - Provider interfaces (peer, optional)

## Source

Components extracted from `riotprompt`:
- `conversation.ts` → ConversationBuilder
- `context-manager.ts` → ContextManager
- `token-budget.ts` → TokenBudgetManager
- `tools.ts` → ToolRegistry
- `iteration-strategy.ts` → StrategyExecutor, IterationStrategyFactory
- `reflection.ts` → MetricsCollector, ReflectionReportGenerator

