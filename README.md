# agentic

Components for building agentic AI workflows - tool registry, context management, and conversation state tracking.

## Installation

```bash
npm install agentic
```

## Features

- **ToolRegistry** - Register, execute, and manage tools with usage tracking
- **ContextManager** - Track and deduplicate injected context
- **OpenAI/Anthropic Format** - Export tools in provider-specific formats

## Usage

### Tool Registry

```typescript
import { ToolRegistry, type Tool } from 'agentic';

// Create registry
const registry = ToolRegistry.create({
  workingDirectory: process.cwd(),
});

// Register a tool
registry.register({
  name: 'read_file',
  description: 'Read contents of a file',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to read' },
    },
    required: ['path'],
  },
  execute: async ({ path }) => {
    const fs = await import('fs/promises');
    return await fs.readFile(path, 'utf-8');
  },
  category: 'filesystem',
  cost: 'cheap',
});

// Execute a tool
const content = await registry.execute('read_file', { path: './README.md' });

// Export for OpenAI
const openAITools = registry.toOpenAIFormat();

// Export for Anthropic
const anthropicTools = registry.toAnthropicFormat();

// Get usage statistics
const stats = registry.getUsageStats();
console.log(stats.get('read_file')); // { calls: 5, failures: 0, successRate: 1 }
```

### Context Manager

```typescript
import { ContextManager } from 'agentic';

const context = new ContextManager();

// Track context with deduplication
context.track({
  id: 'file:main.ts',
  content: fileContent,
  title: 'Main File',
  category: 'source-code',
  priority: 'high',
}, 5); // position in conversation

// Check for duplicates
if (context.hasContext('file:main.ts')) {
  console.log('Already provided');
}

// Query by category
const sourceFiles = context.getByCategory('source-code');

// Get statistics
const stats = context.getStats();
console.log(stats.totalItems);
console.log(stats.byCategory);
```

### Tool Definition

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
  execute: (params: any, context?: ToolContext) => Promise<any>;
  category?: string;
  cost?: 'cheap' | 'moderate' | 'expensive';
  examples?: ToolExample[];
}
```

### Context Item

```typescript
interface DynamicContentItem {
  content: string;
  title?: string;
  weight?: number;
  id?: string;
  category?: string;
  source?: string;
  priority?: 'high' | 'medium' | 'low';
  timestamp?: Date;
}
```

## API Reference

### ToolRegistry

| Method | Description |
|--------|-------------|
| `create(context?)` | Create a new registry |
| `register(tool)` | Register a tool |
| `registerAll(tools)` | Register multiple tools |
| `execute(name, params)` | Execute a tool |
| `executeBatch(calls)` | Execute multiple tools |
| `toOpenAIFormat()` | Export for OpenAI |
| `toAnthropicFormat()` | Export for Anthropic |
| `getUsageStats()` | Get usage statistics |
| `getMostUsed(limit)` | Get most used tools |
| `getByCategory(category)` | Filter by category |

### ContextManager

| Method | Description |
|--------|-------------|
| `track(item, position)` | Track a context item |
| `hasContext(id)` | Check if ID exists |
| `hasContentHash(content)` | Check by content hash |
| `hasSimilarContent(content)` | Fuzzy content match |
| `getByCategory(category)` | Filter by category |
| `getByPriority(priority)` | Filter by priority |
| `getStats()` | Get statistics |
| `remove(id)` | Remove by ID |
| `clear()` | Clear all |

## Related Packages

- `execution` - Core provider interfaces
- `execution-openai` - OpenAI provider
- `execution-anthropic` - Anthropic provider
- `execution-gemini` - Gemini provider

## License

Apache-2.0

<!-- v1.0.0 -->
