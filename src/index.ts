/**
 * Agentic Package
 *
 * Components for building agentic AI workflows:
 * - Tool registry and execution
 * - Context management
 * - Conversation state tracking
 *
 * @packageDocumentation
 */

// Types
export type {
    ConversationMessage,
    ToolCall,
    Model,
    ToolUsagePolicy,
    IterationAction,
    ToolCallAction,
    InjectOptions,
    DynamicContentItem,
    TrackedContextItem,
    LLMClient,
    StrategyState,
    Insight,
    ToolResult,
    PhaseResult,
    TokenUsage,
    CompressionStats,
    CompressionStrategy,
    TokenBudgetConfig,
    LogFormat,
    LogConfig,
} from './types';

// Logger
export type { Logger } from './logger';
export { DEFAULT_LOGGER, wrapLogger, LIBRARY_NAME } from './logger';

// Tool Registry
export type {
    ToolParameter,
    ToolContext,
    ToolExample,
    ToolCost,
    Tool,
    OpenAITool,
    AnthropicTool,
    ToolExecutionResult,
    ToolUsageStats,
    ToolDefinition,
} from './tools';
export { ToolRegistry } from './tools';

// Context Manager
export type { ContextStats } from './context-manager';
export { ContextManager } from './context-manager';

/**
 * Package version
 */
export const VERSION = '0.0.1';
