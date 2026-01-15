/**
 * Agentic Package - Tool Guard
 *
 * Security layer for tool parameter validation and access control.
 */

import { ZodSchema, ZodError } from 'zod';
import { DEFAULT_LOGGER, wrapLogger, type Logger } from './logger';

/**
 * Configuration for tool security
 */
export interface ToolSecurityConfig {
    enabled: boolean;
    validateParams: boolean;
    sandboxExecution: boolean;
    maxExecutionTime: number;
    maxConcurrentCalls: number;
    deniedTools: string[];
    allowedTools?: string[];
}

/**
 * Result of tool parameter validation
 */
export interface ToolValidationResult<T> {
    success: boolean;
    data?: T;
    error?: string;
    violations?: string[];
}

/**
 * Event handlers for security events
 */
export interface ToolGuardEvents {
    onValidationFailed?: (toolName: string, message: string) => void;
    onExecutionBlocked?: (toolName: string, reason: string) => void;
    onPrototypePollution?: (toolName: string) => void;
}

const DEFAULT_CONFIG: ToolSecurityConfig = {
    enabled: true,
    validateParams: true,
    sandboxExecution: false,
    maxExecutionTime: 30000,
    maxConcurrentCalls: 10,
    deniedTools: [],
};

/**
 * ToolGuard provides security validation for tool execution.
 *
 * Features:
 * - Schema-based parameter validation with Zod
 * - Prototype pollution detection
 * - Tool allow/deny lists
 * - Event callbacks for security monitoring
 *
 * @example
 * ```typescript
 * const guard = new ToolGuard({ deniedTools: ['dangerous_tool'] });
 *
 * // Validate parameters
 * const schema = z.object({ path: z.string() });
 * const result = guard.validateParams('read_file', { path: '/test' }, schema);
 *
 * // Check if tool is allowed
 * if (guard.isToolAllowed('my_tool')) {
 *   // execute tool
 * }
 * ```
 */
export class ToolGuard {
    private config: ToolSecurityConfig;
    private logger: Logger;
    private events: ToolGuardEvents;

    constructor(
        config: Partial<ToolSecurityConfig> = {},
        logger?: Logger,
        events: ToolGuardEvents = {}
    ) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.logger = wrapLogger(logger || DEFAULT_LOGGER, 'ToolGuard');
        this.events = events;
    }

    /**
     * Validate tool parameters against a Zod schema
     */
    validateParams<T>(
        toolName: string,
        params: unknown,
        schema: ZodSchema<T>
    ): ToolValidationResult<T> {
        if (!this.config.enabled || !this.config.validateParams) {
            // Bypass validation if disabled
            return { success: true, data: params as T };
        }

        try {
            const data = schema.parse(params);
            return { success: true, data };
        } catch (error) {
            if (error instanceof ZodError) {
                // Zod 4 uses 'issues' instead of 'errors'
                const issues = error.issues || [];
                const violations = issues.map(
                    (e) => `${e.path.join('.')}: ${e.message}`
                );
                const message = `Schema validation failed: ${violations.join('; ')}`;

                this.logger.warn(`Tool validation failed for "${toolName}"`, {
                    violations,
                });
                this.events.onValidationFailed?.(toolName, message);

                return {
                    success: false,
                    error: 'Parameter validation failed',
                    violations,
                };
            }
            throw error;
        }
    }

    /**
     * Safely parse JSON tool arguments
     */
    parseToolArguments(
        toolName: string,
        jsonString: string
    ): ToolValidationResult<Record<string, unknown>> {
        if (!this.config.enabled) {
            return { success: true, data: JSON.parse(jsonString) };
        }

        try {
            // First, try to parse as JSON
            const parsed = JSON.parse(jsonString);

            // Check for prototype pollution attempts
            if (this.hasPrototypePollution(parsed)) {
                this.logger.error(
                    `Prototype pollution attempt detected for tool "${toolName}"`
                );
                this.events.onPrototypePollution?.(toolName);
                return {
                    success: false,
                    error: 'Invalid tool arguments: potentially malicious content detected',
                };
            }

            // Ensure it's an object
            if (
                typeof parsed !== 'object' ||
                parsed === null ||
                Array.isArray(parsed)
            ) {
                return {
                    success: false,
                    error: 'Tool arguments must be a JSON object',
                };
            }

            return { success: true, data: parsed };
        } catch (error) {
            const errorMsg =
                error instanceof Error ? error.message : 'Unknown error';
            this.logger.warn(`JSON parsing failed for tool "${toolName}"`, {
                error: errorMsg,
            });
            this.events.onValidationFailed?.(
                toolName,
                `JSON parsing failed: ${errorMsg}`
            );
            return {
                success: false,
                error: 'Invalid JSON in tool arguments',
            };
        }
    }

    /**
     * Check if a tool is allowed to execute
     */
    isToolAllowed(toolName: string): boolean {
        if (!this.config.enabled) return true;

        // Check deny list
        if (this.config.deniedTools.includes(toolName)) {
            this.logger.warn(`Tool "${toolName}" blocked by deny list`);
            this.events.onExecutionBlocked?.(toolName, 'Tool is in deny list');
            return false;
        }

        // Check allow list if specified
        if (
            this.config.allowedTools &&
            !this.config.allowedTools.includes(toolName)
        ) {
            this.logger.warn(`Tool "${toolName}" not in allow list`);
            this.events.onExecutionBlocked?.(
                toolName,
                'Tool is not in allow list'
            );
            return false;
        }

        return true;
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

    /**
     * Add a tool to the deny list
     */
    denyTool(toolName: string): void {
        if (!this.config.deniedTools.includes(toolName)) {
            this.config.deniedTools.push(toolName);
        }
    }

    /**
     * Remove a tool from the deny list
     */
    allowTool(toolName: string): void {
        const index = this.config.deniedTools.indexOf(toolName);
        if (index !== -1) {
            this.config.deniedTools.splice(index, 1);
        }
    }

    /**
     * Check if security is enabled
     */
    isEnabled(): boolean {
        return this.config.enabled;
    }

    /**
     * Enable or disable security
     */
    setEnabled(enabled: boolean): void {
        this.config.enabled = enabled;
    }

    /**
     * Detect prototype pollution attempts
     */
    private hasPrototypePollution(obj: unknown, depth: number = 0): boolean {
        if (depth > 10) return false; // Prevent stack overflow
        if (typeof obj !== 'object' || obj === null) return false;

        const dangerousKeys = ['__proto__', 'constructor', 'prototype'];

        for (const key of Object.keys(obj)) {
            if (dangerousKeys.includes(key)) {
                return true;
            }

            if (typeof (obj as Record<string, unknown>)[key] === 'object') {
                if (
                    this.hasPrototypePollution(
                        (obj as Record<string, unknown>)[key],
                        depth + 1
                    )
                ) {
                    return true;
                }
            }
        }

        return false;
    }
}

export default ToolGuard;

