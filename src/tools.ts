/**
 * Agentic Package - Tool Registry
 *
 * Manages tool definitions and execution for agentic workflows.
 */

import { z } from 'zod';
import { DEFAULT_LOGGER, wrapLogger, type Logger } from './logger';

// ===== TYPE DEFINITIONS =====

/**
 * Parameter definition for a tool
 */
export interface ToolParameter {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description: string;
    items?: ToolParameter;
    properties?: Record<string, ToolParameter>;
    required?: string[];
    enum?: string[];
    default?: any;
}

/**
 * Context provided to tool execution
 */
export interface ToolContext {
    workingDirectory?: string;
    storage?: any;
    logger?: Logger;
    conversationState?: any;
    [key: string]: any;
}

/**
 * Example usage of a tool
 */
export interface ToolExample {
    scenario: string;
    params: any;
    expectedResult: string;
}

/**
 * Cost hint for tool execution
 */
export type ToolCost = 'cheap' | 'moderate' | 'expensive';

/**
 * Tool definition
 */
export interface Tool {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, ToolParameter>;
        required?: string[];
    };
    execute: (params: any, context?: ToolContext) => Promise<any>;
    category?: string;
    cost?: ToolCost;
    examples?: ToolExample[];
}

/**
 * OpenAI-compatible tool format
 */
export interface OpenAITool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: 'object';
            properties: Record<string, any>;
            required?: string[];
        };
    };
}

/**
 * Anthropic-compatible tool format
 */
export interface AnthropicTool {
    name: string;
    description: string;
    input_schema: {
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
    };
}

/**
 * Tool execution result
 */
export interface ToolExecutionResult {
    success: boolean;
    result?: any;
    error?: string;
    duration?: number;
}

/**
 * Usage statistics for a tool
 */
export interface ToolUsageStats {
    calls: number;
    failures: number;
    successRate: number;
    averageDuration?: number;
}

/**
 * Tool definition for export
 */
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Tool['parameters'];
    category?: string;
    cost?: ToolCost;
    examples?: ToolExample[];
}

// ===== VALIDATION SCHEMAS =====

const ToolSchema = z
    .object({
        name: z.string().min(1),
        description: z.string().min(1),
        parameters: z
            .object({
                type: z.literal('object'),
                properties: z.record(z.string(), z.any()).default({}),
                required: z.array(z.string()).optional(),
            })
            .passthrough(),
        execute: z.custom<(params: any, context?: any) => Promise<any>>(
            (val) => typeof val === 'function',
        { message: 'execute must be a function' }
        ),
        category: z.string().optional(),
        cost: z.enum(['cheap', 'moderate', 'expensive']).optional(),
        examples: z
            .array(
                z.object({
                    scenario: z.string(),
                    params: z.any(),
                    expectedResult: z.string(),
                })
            )
            .optional(),
    })
    .passthrough();

// ===== TOOL REGISTRY =====

/**
 * ToolRegistry manages tool definitions and execution.
 */
export class ToolRegistry {
    private tools: Map<string, Tool>;
    private context: ToolContext;
    private logger: Logger;
    private usageStats: Map<
        string,
        { calls: number; failures: number; totalDuration: number }
    >;

    private constructor(context: ToolContext = {}, logger?: Logger) {
        this.tools = new Map();
        this.context = context;
        this.logger = wrapLogger(logger || DEFAULT_LOGGER, 'ToolRegistry');
        this.usageStats = new Map();

        this.logger.debug('Created ToolRegistry');
    }

    /**
     * Create a new ToolRegistry instance
     */
    static create(context?: ToolContext, logger?: Logger): ToolRegistry {
        return new ToolRegistry(context, logger);
    }

    /**
     * Register a single tool
     */
    register(tool: Tool): void {
        try {
            ToolSchema.parse(tool);
        } catch (error) {
            throw new Error(`Invalid tool definition for "${tool.name}": ${error}`);
        }

        if (this.tools.has(tool.name)) {
            this.logger.warn(`Tool "${tool.name}" already registered, overwriting`);
        }

        this.tools.set(tool.name, tool);
        this.usageStats.set(tool.name, { calls: 0, failures: 0, totalDuration: 0 });

        this.logger.debug('Registered tool', {
            name: tool.name,
            category: tool.category,
        });
    }

    /**
     * Register multiple tools at once
     */
    registerAll(tools: Tool[]): void {
        this.logger.debug('Registering multiple tools', { count: tools.length });
        tools.forEach((tool) => this.register(tool));
    }

    /**
     * Get a tool by name
     */
    get(name: string): Tool | undefined {
        return this.tools.get(name);
    }

    /**
     * Get all registered tools
     */
    getAll(): Tool[] {
        return Array.from(this.tools.values());
    }

    /**
     * Get tools by category
     */
    getByCategory(category: string): Tool[] {
        return this.getAll().filter((tool) => tool.category === category);
    }

    /**
     * Check if a tool is registered
     */
    has(name: string): boolean {
        return this.tools.has(name);
    }

    /**
     * Get number of registered tools
     */
    count(): number {
        return this.tools.size;
    }

    /**
     * Execute a tool by name
     */
    async execute(name: string, params: any): Promise<any> {
        const tool = this.tools.get(name);

        if (!tool) {
            throw new Error(`Tool "${name}" not found`);
        }

        this.logger.debug('Executing tool', { name, params });

        const startTime = Date.now();
        const stats = this.usageStats.get(name)!;
        stats.calls++;

        try {
            const result = await tool.execute(params, this.context);

            const duration = Date.now() - startTime;
            stats.totalDuration += duration;

            this.logger.debug('Tool execution succeeded', { name, duration });

            return result;
        } catch (error) {
            stats.failures++;

            this.logger.error('Tool execution failed', { name, error });

            throw error;
        }
    }

    /**
     * Execute multiple tools in sequence
     */
    async executeBatch(
        calls: Array<{ name: string; params: any }>
    ): Promise<any[]> {
        this.logger.debug('Executing batch', { count: calls.length });

        const results: any[] = [];

        for (const call of calls) {
            try {
                const result = await this.execute(call.name, call.params);
                results.push(result);
            } catch (error) {
                results.push({ error: String(error) });
            }
        }

        return results;
    }

    /**
     * Export tools in OpenAI format
     */
    toOpenAIFormat(): OpenAITool[] {
        return this.getAll().map((tool) => ({
            type: 'function' as const,
            function: {
                name: tool.name,
                description: tool.description,
                parameters: {
                    type: 'object' as const,
                    properties: tool.parameters.properties,
                    required: tool.parameters.required,
                },
            },
        }));
    }

    /**
     * Export tools in Anthropic format
     */
    toAnthropicFormat(): AnthropicTool[] {
        return this.getAll().map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: {
                type: 'object' as const,
                properties: tool.parameters.properties,
                required: tool.parameters.required,
            },
        }));
    }

    /**
     * Get tool definitions (without execute function)
     */
    getDefinitions(): ToolDefinition[] {
        return this.getAll().map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            category: tool.category,
            cost: tool.cost,
            examples: tool.examples,
        }));
    }

    /**
     * Get usage statistics for all tools
     */
    getUsageStats(): Map<string, ToolUsageStats> {
        const stats = new Map<string, ToolUsageStats>();

        this.usageStats.forEach((rawStats, name) => {
            stats.set(name, {
                calls: rawStats.calls,
                failures: rawStats.failures,
                successRate:
                    rawStats.calls > 0
                        ? (rawStats.calls - rawStats.failures) / rawStats.calls
                        : 0,
                averageDuration:
                    rawStats.calls > 0
                        ? rawStats.totalDuration / rawStats.calls
                        : undefined,
            });
        });

        return stats;
    }

    /**
     * Get most frequently used tools
     */
    getMostUsed(limit: number = 5): Tool[] {
        const sorted = Array.from(this.usageStats.entries())
            .sort((a, b) => b[1].calls - a[1].calls)
            .slice(0, limit)
            .map(([name]) => this.tools.get(name)!)
            .filter((tool) => tool !== undefined);

        return sorted;
    }

    /**
     * Get list of all categories
     */
    getCategories(): string[] {
        const categories = new Set<string>();

        this.getAll().forEach((tool) => {
            if (tool.category) {
                categories.add(tool.category);
            }
        });

        return Array.from(categories).sort();
    }

    /**
     * Update execution context
     */
    updateContext(context: Partial<ToolContext>): void {
        this.context = { ...this.context, ...context };
        this.logger.debug('Updated context', { keys: Object.keys(context) });
    }

    /**
     * Get current context
     */
    getContext(): ToolContext {
        return { ...this.context };
    }

    /**
     * Clear all tools
     */
    clear(): void {
        this.logger.debug('Clearing all tools');
        this.tools.clear();
        this.usageStats.clear();
    }

    /**
     * Unregister a specific tool
     */
    unregister(name: string): boolean {
        if (this.tools.has(name)) {
            this.tools.delete(name);
            this.usageStats.delete(name);
            this.logger.debug('Unregistered tool', { name });
            return true;
        }

        return false;
    }

    /**
     * Reset usage statistics
     */
    resetStats(): void {
        this.logger.debug('Resetting usage statistics');

        this.usageStats.forEach((stats) => {
            stats.calls = 0;
            stats.failures = 0;
            stats.totalDuration = 0;
        });
    }
}

export default ToolRegistry;

