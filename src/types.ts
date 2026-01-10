/**
 * Agentic Package - Types
 *
 * Core type definitions for agentic workflows.
 */

// ===== INLINE TYPES (from 'execution' package) =====

export type Model = string;

export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export interface ConversationMessage {
    role: 'system' | 'user' | 'assistant' | 'tool' | 'developer';
    content: string | null;
    name?: string;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
}

// ===== TOOL USAGE AND STRATEGY TYPES =====

/**
 * Tool usage policy for a phase
 */
export type ToolUsagePolicy = 'required' | 'encouraged' | 'optional' | 'forbidden';

/**
 * Action to take after iteration
 */
export type IterationAction = 'continue' | 'stop' | 'next-phase';

/**
 * Action to take for tool call
 */
export type ToolCallAction = 'execute' | 'skip' | 'defer';

// ===== CONTEXT TYPES =====

/**
 * Options for injecting context
 */
export interface InjectOptions {
    position?: 'end' | 'before-last' | 'after-system' | number;
    format?: 'structured' | 'inline' | 'reference';
    deduplicate?: boolean;
    deduplicateBy?: 'id' | 'content' | 'hash';
    priority?: 'high' | 'medium' | 'low';
    weight?: number;
    category?: string;
    source?: string;
}

/**
 * Dynamic content item with enhanced tracking and lifecycle
 */
export interface DynamicContentItem {
    content: string;
    title?: string;
    weight?: number;
    id?: string;
    category?: string;
    source?: string;
    priority?: 'high' | 'medium' | 'low';
    timestamp?: Date;
}

/**
 * Tracked context item with metadata
 */
export interface TrackedContextItem extends DynamicContentItem {
    id: string;
    hash: string;
    position: number;
    injectedAt: Date;
}

// ===== STRATEGY TYPES =====

/**
 * LLM client interface (generic, provider-agnostic)
 */
export interface LLMClient {
    complete(
        messages: ConversationMessage[],
        tools?: any[]
    ): Promise<{
        content: string | null;
        tool_calls?: ToolCall[];
    }>;
}

/**
 * Current state of strategy execution
 */
export interface StrategyState {
    phase: string | number;
    iteration: number;
    toolCallsExecuted: number;
    startTime: number;
    insights: Insight[];
    findings: any[];
    errors: Error[];
    toolFailures: Map<string, number>;
    [key: string]: any;
}

/**
 * Insight discovered during execution
 */
export interface Insight {
    source: string;
    content: string;
    confidence: number;
    relatedTo?: string[];
}

/**
 * Result of tool execution
 */
export interface ToolResult {
    callId: string;
    toolName: string;
    result: any;
    error?: Error;
    duration: number;
}

/**
 * Result of a phase
 */
export interface PhaseResult {
    name: string;
    iterations: number;
    toolCalls: number;
    success: boolean;
    insights?: Insight[];
}

// ===== TOKEN BUDGET TYPES =====

/**
 * Token usage information
 */
export interface TokenUsage {
    used: number;
    max: number;
    remaining: number;
    percentage: number;
}

/**
 * Compression statistics
 */
export interface CompressionStats {
    messagesBefore: number;
    messagesAfter: number;
    tokensBefore: number;
    tokensAfter: number;
    tokensSaved: number;
    strategy: CompressionStrategy;
}

/**
 * Compression strategy
 */
export type CompressionStrategy =
    | 'priority-based'
    | 'fifo'
    | 'summarize'
    | 'adaptive';

/**
 * Token budget configuration
 */
export interface TokenBudgetConfig {
    max: number;
    reserveForResponse: number;
    warningThreshold?: number;
    strategy: CompressionStrategy;
    onBudgetExceeded: 'compress' | 'error' | 'warn' | 'truncate';
    preserveRecent?: number;
    preserveSystem?: boolean;
    preserveHighPriority?: boolean;
    onWarning?: (usage: TokenUsage) => void;
    onCompression?: (stats: CompressionStats) => void;
}

// ===== LOGGING TYPES =====

/**
 * Log format
 */
export type LogFormat = 'json' | 'markdown' | 'jsonl';

/**
 * Log configuration
 */
export interface LogConfig {
    enabled: boolean;
    outputPath?: string;
    format?: LogFormat;
    filenameTemplate?: string;
    includeMetadata?: boolean;
    includePrompt?: boolean;
    redactSensitive?: boolean;
    redactPatterns?: RegExp[];
    onSaved?: (path: string) => void;
    onError?: (error: Error) => void;
}

