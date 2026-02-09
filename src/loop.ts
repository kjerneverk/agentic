/**
 * Agentic Package - Agent Loop
 *
 * Orchestrates multi-turn LLM conversations with tool use.
 */

import { DEFAULT_LOGGER, wrapLogger, type Logger } from './logger';
import { ToolRegistry } from './tools';
import { ConversationManager } from './conversation';
import type { ConversationMessage, ToolCall } from './types';

// ===== TYPES =====

/**
 * Streaming chunk types from the agent loop
 */
export type AgentChunkType = 
    | 'text'           // Text content from LLM
    | 'tool_start'     // Tool execution starting
    | 'tool_result'    // Tool execution completed
    | 'turn_complete'  // LLM turn completed (may have more turns)
    | 'done'           // Agent loop finished
    | 'error';         // Error occurred

/**
 * A chunk yielded during agent execution
 */
export interface AgentChunk {
    type: AgentChunkType;
    /** Text content (for type='text') */
    text?: string;
    /** Tool information (for tool_start/tool_result) */
    tool?: {
        id: string;
        name: string;
        arguments?: Record<string, any>;
        result?: string;
        error?: string;
        duration?: number;
    };
    /** Error information (for type='error') */
    error?: {
        message: string;
        code?: string;
    };
    /** Metadata */
    meta?: {
        iteration?: number;
        tokenUsage?: { input: number; output: number };
    };
}

/**
 * Events emitted by the agent loop
 */
export interface AgentLoopEvents {
    onToolCallStart?: (toolName: string, args: Record<string, any>) => void;
    onToolCallComplete?: (toolName: string, result: any, duration: number) => void;
    onToolCallError?: (toolName: string, error: Error) => void;
    onLLMRequest?: (messages: ConversationMessage[]) => void;
    onLLMResponse?: (content: string | null, toolCalls?: ToolCall[]) => void;
    onIterationStart?: (iteration: number) => void;
    onIterationComplete?: (iteration: number) => void;
}

/**
 * Provider interface for the agent loop
 * Compatible with execution package providers
 */
export interface AgentProvider {
    readonly name: string;
    execute(request: AgentRequest, options?: AgentExecutionOptions): Promise<AgentProviderResponse>;
    executeStream?(request: AgentRequest, options?: AgentExecutionOptions): AsyncIterable<AgentStreamChunk>;
}

/**
 * Request to the provider
 */
export interface AgentRequest {
    messages: ConversationMessage[];
    model: string;
    tools?: AgentToolDefinition[];
    addMessage(message: ConversationMessage): void;
}

/**
 * Tool definition for the agent
 */
export interface AgentToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
    };
}

/**
 * Execution options
 */
export interface AgentExecutionOptions {
    apiKey?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
}

/**
 * Response from the provider
 */
export interface AgentProviderResponse {
    content: string;
    model: string;
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
    toolCalls?: ToolCall[];
}

/**
 * Streaming chunk from provider
 */
export interface AgentStreamChunk {
    type: 'text' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_end' | 'usage' | 'done';
    text?: string;
    toolCall?: {
        id?: string;
        index?: number;
        name?: string;
        argumentsDelta?: string;
    };
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
}

/**
 * Options for creating an AgentLoop
 */
export interface AgentLoopOptions {
    /** The LLM provider to use */
    provider: AgentProvider;
    /** Tool registry with available tools */
    toolRegistry: ToolRegistry;
    /** Conversation manager (optional, will create one if not provided) */
    conversation?: ConversationManager;
    /** Model to use */
    model?: string;
    /** Maximum iterations before stopping (default: 10) */
    maxIterations?: number;
    /** Event handlers */
    events?: AgentLoopEvents;
    /** Logger */
    logger?: Logger;
    /** Execution options passed to provider */
    executionOptions?: AgentExecutionOptions;
}

/**
 * Result of running the agent loop
 */
export interface AgentLoopResult {
    /** Final text response from the agent */
    response: string;
    /** Number of iterations executed */
    iterations: number;
    /** Tool calls made during execution */
    toolCalls: Array<{
        name: string;
        arguments: Record<string, any>;
        result: any;
        duration: number;
    }>;
    /** Total token usage */
    tokenUsage?: {
        input: number;
        output: number;
    };
    /** Whether the loop was cancelled */
    cancelled: boolean;
}

// ===== AGENT LOOP =====

/**
 * AgentLoop orchestrates multi-turn LLM conversations with tool use.
 * 
 * The loop:
 * 1. Sends messages + tool definitions to LLM
 * 2. Parses response for tool calls
 * 3. Executes tool calls via ToolRegistry
 * 4. Formats tool results as messages
 * 5. Feeds back to LLM
 * 6. Repeats until LLM responds with text (no tool calls)
 */
export class AgentLoop {
    private provider: AgentProvider;
    private toolRegistry: ToolRegistry;
    private conversation: ConversationManager;
    private model: string;
    private maxIterations: number;
    private events: AgentLoopEvents;
    private logger: Logger;
    private executionOptions: AgentExecutionOptions;
    private cancelled: boolean = false;

    private constructor(options: AgentLoopOptions) {
        this.provider = options.provider;
        this.toolRegistry = options.toolRegistry;
        this.conversation = options.conversation || ConversationManager.create();
        this.model = options.model || 'claude-sonnet-4-20250514';
        this.maxIterations = options.maxIterations || 10;
        this.events = options.events || {};
        this.logger = wrapLogger(options.logger || DEFAULT_LOGGER, 'AgentLoop');
        this.executionOptions = options.executionOptions || {};

        this.logger.debug('Created AgentLoop', {
            provider: this.provider.name,
            model: this.model,
            maxIterations: this.maxIterations,
            toolCount: this.toolRegistry.count(),
        });
    }

    /**
     * Create a new AgentLoop instance
     */
    static create(options: AgentLoopOptions): AgentLoop {
        return new AgentLoop(options);
    }

    /**
     * Set the system prompt
     */
    setSystemPrompt(prompt: string): void {
        this.conversation.addSystemMessage(prompt);
    }

    /**
     * Get the conversation manager
     */
    getConversation(): ConversationManager {
        return this.conversation;
    }

    /**
     * Cancel the current execution
     */
    cancel(): void {
        this.cancelled = true;
        this.logger.debug('Agent loop cancelled');
    }

    /**
     * Reset cancellation state
     */
    resetCancellation(): void {
        this.cancelled = false;
    }

    /**
     * Run the agent loop with a user message (non-streaming)
     */
    async run(userMessage: string): Promise<AgentLoopResult> {
        this.conversation.addUserMessage(userMessage);
        
        const toolCalls: AgentLoopResult['toolCalls'] = [];
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let iteration = 0;
        let finalResponse = '';

        while (iteration < this.maxIterations && !this.cancelled) {
            iteration++;
            this.events.onIterationStart?.(iteration);
            this.logger.debug('Starting iteration', { iteration });

            // Build request
            const request = this.buildRequest();

            // Call LLM
            this.events.onLLMRequest?.(request.messages);
            const response = await this.provider.execute(request, {
                ...this.executionOptions,
                model: this.model,
            });

            // Track usage
            if (response.usage) {
                totalInputTokens += response.usage.inputTokens;
                totalOutputTokens += response.usage.outputTokens;
            }

            this.events.onLLMResponse?.(response.content, response.toolCalls);

            // Check for tool calls
            if (response.toolCalls && response.toolCalls.length > 0) {
                // Add assistant message with tool calls
                this.conversation.addAssistantToolCalls(response.toolCalls, response.content || undefined);

                // Execute each tool call
                for (const toolCall of response.toolCalls) {
                    if (this.cancelled) break;

                    const args = JSON.parse(toolCall.function.arguments);
                    this.events.onToolCallStart?.(toolCall.function.name, args);

                    const startTime = Date.now();
                    try {
                        const result = await this.toolRegistry.execute(
                            toolCall.function.name,
                            args
                        );
                        const duration = Date.now() - startTime;

                        // Format result as string
                        const resultStr = typeof result === 'string' 
                            ? result 
                            : JSON.stringify(result, null, 2);

                        // Add tool result to conversation
                        this.conversation.addToolResult(toolCall.id, resultStr);

                        toolCalls.push({
                            name: toolCall.function.name,
                            arguments: args,
                            result,
                            duration,
                        });

                        this.events.onToolCallComplete?.(toolCall.function.name, result, duration);
                    } catch (error) {
                        const duration = Date.now() - startTime;
                        const errorMsg = error instanceof Error ? error.message : String(error);

                        // Add error as tool result
                        this.conversation.addToolResult(
                            toolCall.id,
                            JSON.stringify({ error: errorMsg })
                        );

                        toolCalls.push({
                            name: toolCall.function.name,
                            arguments: args,
                            result: { error: errorMsg },
                            duration,
                        });

                        this.events.onToolCallError?.(
                            toolCall.function.name,
                            error instanceof Error ? error : new Error(errorMsg)
                        );
                    }
                }
            } else {
                // No tool calls - we have the final response
                finalResponse = response.content;
                this.conversation.addAssistantMessage(response.content);
                this.events.onIterationComplete?.(iteration);
                break;
            }

            this.events.onIterationComplete?.(iteration);
        }

        if (iteration >= this.maxIterations && !finalResponse) {
            this.logger.warn('Max iterations reached without final response');
            finalResponse = '[Agent reached maximum iterations without completing]';
        }

        return {
            response: finalResponse,
            iterations: iteration,
            toolCalls,
            tokenUsage: {
                input: totalInputTokens,
                output: totalOutputTokens,
            },
            cancelled: this.cancelled,
        };
    }

    /**
     * Run the agent loop with streaming output
     */
    async *runStream(userMessage: string): AsyncIterable<AgentChunk> {
        this.conversation.addUserMessage(userMessage);
        
        let iteration = 0;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;

        while (iteration < this.maxIterations && !this.cancelled) {
            iteration++;
            this.events.onIterationStart?.(iteration);
            this.logger.debug('Starting iteration', { iteration });

            // Build request
            const request = this.buildRequest();
            this.events.onLLMRequest?.(request.messages);

            // Check if provider supports streaming
            if (!this.provider.executeStream) {
                // Fall back to non-streaming
                const response = await this.provider.execute(request, {
                    ...this.executionOptions,
                    model: this.model,
                });

                if (response.usage) {
                    totalInputTokens += response.usage.inputTokens;
                    totalOutputTokens += response.usage.outputTokens;
                }

                this.events.onLLMResponse?.(response.content, response.toolCalls);

                if (response.toolCalls && response.toolCalls.length > 0) {
                    this.conversation.addAssistantToolCalls(response.toolCalls, response.content || undefined);
                    yield* this.executeToolCallsStreaming(response.toolCalls, iteration);
                } else {
                    // Final response
                    yield { type: 'text', text: response.content };
                    this.conversation.addAssistantMessage(response.content);
                    yield { 
                        type: 'done',
                        meta: { 
                            iteration,
                            tokenUsage: { input: totalInputTokens, output: totalOutputTokens }
                        }
                    };
                    return;
                }
            } else {
                // Use streaming
                const stream = this.provider.executeStream(request, {
                    ...this.executionOptions,
                    model: this.model,
                });

                let accumulatedText = '';
                const toolCallsInProgress: Map<number, { id: string; name: string; arguments: string }> = new Map();
                let hasToolCalls = false;

                for await (const chunk of stream) {
                    if (this.cancelled) {
                        yield { type: 'done', meta: { iteration } };
                        return;
                    }

                    if (chunk.type === 'text' && chunk.text) {
                        accumulatedText += chunk.text;
                        yield { type: 'text', text: chunk.text };
                    } else if (chunk.type === 'tool_call_start' && chunk.toolCall) {
                        hasToolCalls = true;
                        const index = chunk.toolCall.index ?? 0;
                        toolCallsInProgress.set(index, {
                            id: chunk.toolCall.id || `call_${index}`,
                            name: chunk.toolCall.name || '',
                            arguments: '',
                        });
                    } else if (chunk.type === 'tool_call_delta' && chunk.toolCall) {
                        const index = chunk.toolCall.index ?? 0;
                        const tc = toolCallsInProgress.get(index);
                        if (tc && chunk.toolCall.argumentsDelta) {
                            tc.arguments += chunk.toolCall.argumentsDelta;
                        }
                    } else if (chunk.type === 'usage' && chunk.usage) {
                        totalInputTokens += chunk.usage.inputTokens;
                        totalOutputTokens += chunk.usage.outputTokens;
                    }
                }

                this.events.onLLMResponse?.(
                    accumulatedText || null,
                    hasToolCalls ? this.buildToolCalls(toolCallsInProgress) : undefined
                );

                if (hasToolCalls) {
                    const toolCalls = this.buildToolCalls(toolCallsInProgress);
                    this.conversation.addAssistantToolCalls(toolCalls, accumulatedText || undefined);
                    
                    yield { type: 'turn_complete', meta: { iteration } };
                    yield* this.executeToolCallsStreaming(toolCalls, iteration);
                } else {
                    // Final response
                    if (accumulatedText) {
                        this.conversation.addAssistantMessage(accumulatedText);
                    }
                    yield { 
                        type: 'done',
                        meta: { 
                            iteration,
                            tokenUsage: { input: totalInputTokens, output: totalOutputTokens }
                        }
                    };
                    return;
                }
            }

            this.events.onIterationComplete?.(iteration);
        }

        if (iteration >= this.maxIterations) {
            this.logger.warn('Max iterations reached');
            yield { 
                type: 'error',
                error: { 
                    message: 'Maximum iterations reached without completing',
                    code: 'MAX_ITERATIONS'
                }
            };
        }

        yield { type: 'done', meta: { iteration } };
    }

    /**
     * Execute tool calls and yield streaming results
     */
    private async *executeToolCallsStreaming(
        toolCalls: ToolCall[],
        iteration: number
    ): AsyncIterable<AgentChunk> {
        for (const toolCall of toolCalls) {
            if (this.cancelled) break;

            const args = JSON.parse(toolCall.function.arguments);
            
            yield {
                type: 'tool_start',
                tool: {
                    id: toolCall.id,
                    name: toolCall.function.name,
                    arguments: args,
                },
                meta: { iteration },
            };

            this.events.onToolCallStart?.(toolCall.function.name, args);

            const startTime = Date.now();
            try {
                const result = await this.toolRegistry.execute(
                    toolCall.function.name,
                    args
                );
                const duration = Date.now() - startTime;

                const resultStr = typeof result === 'string' 
                    ? result 
                    : JSON.stringify(result, null, 2);

                this.conversation.addToolResult(toolCall.id, resultStr);

                yield {
                    type: 'tool_result',
                    tool: {
                        id: toolCall.id,
                        name: toolCall.function.name,
                        result: resultStr,
                        duration,
                    },
                    meta: { iteration },
                };

                this.events.onToolCallComplete?.(toolCall.function.name, result, duration);
            } catch (error) {
                const duration = Date.now() - startTime;
                const errorMsg = error instanceof Error ? error.message : String(error);

                this.conversation.addToolResult(
                    toolCall.id,
                    JSON.stringify({ error: errorMsg })
                );

                yield {
                    type: 'tool_result',
                    tool: {
                        id: toolCall.id,
                        name: toolCall.function.name,
                        error: errorMsg,
                        duration,
                    },
                    meta: { iteration },
                };

                this.events.onToolCallError?.(
                    toolCall.function.name,
                    error instanceof Error ? error : new Error(errorMsg)
                );
            }
        }
    }

    /**
     * Build a request object for the provider
     */
    private buildRequest(): AgentRequest {
        const messages = this.conversation.getMessages();
        const tools = this.getToolDefinitions();

        return {
            messages,
            model: this.model,
            tools: tools.length > 0 ? tools : undefined,
            addMessage: (msg: ConversationMessage) => {
                this.conversation.addMessage(msg);
            },
        };
    }

    /**
     * Get tool definitions in provider-agnostic format
     */
    private getToolDefinitions(): AgentToolDefinition[] {
        return this.toolRegistry.getAll().map(tool => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        }));
    }

    /**
     * Build ToolCall array from accumulated streaming data
     */
    private buildToolCalls(
        toolCallsInProgress: Map<number, { id: string; name: string; arguments: string }>
    ): ToolCall[] {
        return Array.from(toolCallsInProgress.values()).map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
                name: tc.name,
                arguments: tc.arguments,
            },
        }));
    }
}

export default AgentLoop;
