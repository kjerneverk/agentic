/**
 * Agentic Package - Tool Sandbox
 *
 * Capability-based sandboxing for tool execution with timeout,
 * concurrency limits, and output size restrictions.
 */

import { ToolContext, Tool } from './tools';
import { ToolSecurityConfig, ToolGuard } from './tool-guard';
import { DEFAULT_LOGGER, wrapLogger, type Logger } from './logger';

/**
 * Extended context with sandbox restrictions
 */
export interface SandboxedContext extends ToolContext {
    readonly sandbox: {
        allowedOperations: Set<string>;
        maxOutputSize: number;
        executionId: string;
    };
}

/**
 * Options for sandbox execution
 */
export interface SandboxOptions {
    maxExecutionTime: number;
    maxOutputSize: number;
    allowedOperations?: string[];
    onBeforeExecution?: (
        tool: Tool,
        params: unknown
    ) => void | Promise<void>;
    onAfterExecution?: (
        tool: Tool,
        result: unknown,
        error?: Error
    ) => void | Promise<void>;
}

/**
 * Event handlers for sandbox events
 */
export interface ToolSandboxEvents {
    onConcurrencyExceeded?: (toolName: string, activeCount: number) => void;
    onTimeout?: (toolName: string, timeoutMs: number) => void;
    onOutputSizeExceeded?: (
        toolName: string,
        size: number,
        maxSize: number
    ) => void;
    onCancelled?: (executionId: string) => void;
}

/**
 * ToolSandbox provides capability-based sandboxing for tool execution.
 *
 * Features:
 * - Execution timeout enforcement
 * - Concurrent execution limits
 * - Output size limits
 * - Pre/post execution hooks
 * - Cancellation support
 *
 * Note: This provides capability-based restrictions, not true process isolation.
 * For maximum security, consider running untrusted tools in separate processes.
 *
 * @example
 * ```typescript
 * const sandbox = new ToolSandbox({
 *   maxExecutionTime: 5000,
 *   maxConcurrentCalls: 5,
 * });
 *
 * const result = await sandbox.execute(tool, params, context);
 * ```
 */
export class ToolSandbox {
    private config: ToolSecurityConfig;
    private logger: Logger;
    private events: ToolSandboxEvents;
    private activeExecutions: Map<string, AbortController> = new Map();
    private executionCount: number = 0;

    constructor(
        config: Partial<ToolSecurityConfig> = {},
        logger?: Logger,
        events: ToolSandboxEvents = {}
    ) {
        this.config = {
            enabled: true,
            validateParams: true,
            sandboxExecution: true,
            maxExecutionTime: 30000,
            maxConcurrentCalls: 10,
            deniedTools: [],
            ...config,
        };
        this.logger = wrapLogger(logger || DEFAULT_LOGGER, 'ToolSandbox');
        this.events = events;
    }

    /**
     * Execute a tool with sandbox restrictions
     */
    async execute<T>(
        tool: Tool,
        params: unknown,
        baseContext: ToolContext,
        options: Partial<SandboxOptions> = {}
    ): Promise<T> {
        if (!this.config.enabled || !this.config.sandboxExecution) {
            // Bypass sandboxing if disabled
            return tool.execute(params, baseContext);
        }

        // Check concurrent execution limit
        if (this.activeExecutions.size >= this.config.maxConcurrentCalls) {
            this.logger.warn('Max concurrent executions reached', {
                toolName: tool.name,
                activeCount: this.activeExecutions.size,
                limit: this.config.maxConcurrentCalls,
            });
            this.events.onConcurrencyExceeded?.(
                tool.name,
                this.activeExecutions.size
            );
            throw new Error('Too many concurrent tool executions');
        }

        const executionId = `exec-${++this.executionCount}-${Date.now()}`;
        const controller = new AbortController();
        this.activeExecutions.set(executionId, controller);

        const sandboxedContext: SandboxedContext = {
            ...baseContext,
            sandbox: {
                allowedOperations: new Set(options.allowedOperations || []),
                maxOutputSize: options.maxOutputSize || 1024 * 1024, // 1MB default
                executionId,
            },
        };

        const timeout = options.maxExecutionTime || this.config.maxExecutionTime;

        try {
            // Pre-execution hook
            await options.onBeforeExecution?.(tool, params);

            // Execute with timeout
            const result = await this.executeWithTimeout(
                () => tool.execute(params, sandboxedContext),
                timeout,
                controller.signal,
                tool.name
            );

            // Check output size
            const outputSize = this.estimateSize(result);
            if (outputSize > sandboxedContext.sandbox.maxOutputSize) {
                this.logger.warn('Tool output exceeded max size', {
                    toolName: tool.name,
                    outputSize,
                    maxSize: sandboxedContext.sandbox.maxOutputSize,
                });
                this.events.onOutputSizeExceeded?.(
                    tool.name,
                    outputSize,
                    sandboxedContext.sandbox.maxOutputSize
                );
                throw new Error('Tool output exceeded maximum size limit');
            }

            // Post-execution hook
            await options.onAfterExecution?.(tool, result);

            return result as T;
        } catch (error) {
            await options.onAfterExecution?.(tool, undefined, error as Error);
            throw error;
        } finally {
            this.activeExecutions.delete(executionId);
        }
    }

    /**
     * Cancel all active executions
     */
    cancelAll(): void {
        for (const [id, controller] of this.activeExecutions) {
            controller.abort();
            this.logger.info('Execution cancelled', { executionId: id });
            this.events.onCancelled?.(id);
        }
        this.activeExecutions.clear();
    }

    /**
     * Cancel a specific execution by ID
     */
    cancel(executionId: string): boolean {
        const controller = this.activeExecutions.get(executionId);
        if (controller) {
            controller.abort();
            this.activeExecutions.delete(executionId);
            this.logger.info('Execution cancelled', { executionId });
            this.events.onCancelled?.(executionId);
            return true;
        }
        return false;
    }

    /**
     * Get active execution count
     */
    getActiveCount(): number {
        return this.activeExecutions.size;
    }

    /**
     * Get list of active execution IDs
     */
    getActiveExecutionIds(): string[] {
        return Array.from(this.activeExecutions.keys());
    }

    /**
     * Check if sandbox is enabled
     */
    isEnabled(): boolean {
        return this.config.enabled && this.config.sandboxExecution;
    }

    /**
     * Get current configuration
     */
    getConfig(): Readonly<ToolSecurityConfig> {
        return { ...this.config };
    }

    /**
     * Update configuration
     */
    updateConfig(config: Partial<ToolSecurityConfig>): void {
        this.config = { ...this.config, ...config };
    }

    private async executeWithTimeout<T>(
        fn: () => Promise<T>,
        timeoutMs: number,
        signal: AbortSignal,
        toolName: string
    ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.logger.warn('Tool execution timed out', {
                    toolName,
                    timeoutMs,
                });
                this.events.onTimeout?.(toolName, timeoutMs);
                reject(
                    new Error(`Tool execution timed out after ${timeoutMs}ms`)
                );
            }, timeoutMs);

            const abortHandler = () => {
                clearTimeout(timeoutId);
                reject(new Error('Tool execution was cancelled'));
            };
            signal.addEventListener('abort', abortHandler, { once: true });

            fn()
                .then((result) => {
                    clearTimeout(timeoutId);
                    signal.removeEventListener('abort', abortHandler);
                    resolve(result);
                })
                .catch((error) => {
                    clearTimeout(timeoutId);
                    signal.removeEventListener('abort', abortHandler);
                    reject(error);
                });
        });
    }

    private estimateSize(value: unknown): number {
        if (value === null || value === undefined) return 0;
        if (typeof value === 'string') return value.length * 2; // UTF-16
        if (typeof value === 'number') return 8;
        if (typeof value === 'boolean') return 4;
        if (Buffer.isBuffer(value)) return value.length;
        try {
            return JSON.stringify(value).length * 2;
        } catch {
            return 0;
        }
    }
}

/**
 * Create a security-wrapped version of a tool
 */
export function createSecureTool(
    tool: Tool,
    sandbox: ToolSandbox,
    guard: ToolGuard
): Tool {
    return {
        ...tool,
        execute: async (params, context) => {
            // Check if tool is allowed
            if (!guard.isToolAllowed(tool.name)) {
                throw new Error(`Tool "${tool.name}" is not allowed`);
            }

            // Validate params if schema exists
            if (tool.schema) {
                const validation = guard.validateParams(
                    tool.name,
                    params,
                    tool.schema
                );
                if (!validation.success) {
                    throw new Error(`Validation failed: ${validation.error}`);
                }
                params = validation.data;
            }

            // Execute in sandbox
            return sandbox.execute(tool, params, context || {});
        },
    };
}

export default ToolSandbox;

