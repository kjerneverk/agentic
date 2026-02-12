/**
 * Agentic Package - Conversation Manager
 *
 * Manages conversation history for multi-turn agent interactions.
 */

import { DEFAULT_LOGGER, wrapLogger, type Logger } from './logger';
import type { ConversationMessage, ToolCall, TokenBudgetConfig, TokenUsage, CompressionStats } from './types';

// ===== TYPES =====

/**
 * Options for creating a ConversationManager
 */
export interface ConversationManagerOptions {
    /** Optional logger */
    logger?: Logger;
    /** Token budget configuration for context window management */
    tokenBudget?: TokenBudgetConfig;
    /** Function to count tokens in a message */
    tokenCounter?: (message: ConversationMessage) => number;
}

/**
 * Serialized conversation state for persistence
 */
export interface SerializedConversation {
    messages: ConversationMessage[];
    metadata: {
        createdAt: string;
        updatedAt: string;
        messageCount: number;
        systemPrompt?: string;
    };
}

// ===== CONVERSATION MANAGER =====

/**
 * ConversationManager manages message history for agent conversations.
 * 
 * Features:
 * - Add/retrieve messages
 * - Handle provider-specific format differences
 * - Serialize/deserialize for persistence
 * - Token budget awareness and compression
 */
export class ConversationManager {
    private messages: ConversationMessage[] = [];
    private logger: Logger;
    private tokenBudget?: TokenBudgetConfig;
    private tokenCounter?: (message: ConversationMessage) => number;
    private createdAt: Date;
    private updatedAt: Date;

    private constructor(options: ConversationManagerOptions = {}) {
        this.logger = wrapLogger(options.logger || DEFAULT_LOGGER, 'ConversationManager');
        this.tokenBudget = options.tokenBudget;
        this.tokenCounter = options.tokenCounter;
        this.createdAt = new Date();
        this.updatedAt = new Date();
        
        this.logger.debug('Created ConversationManager');
    }

    /**
     * Create a new ConversationManager instance
     */
    static create(options?: ConversationManagerOptions): ConversationManager {
        return new ConversationManager(options);
    }

    /**
     * Create from serialized state
     */
    static fromSerialized(
        data: SerializedConversation,
        options?: ConversationManagerOptions
    ): ConversationManager {
        const manager = new ConversationManager(options);
        manager.messages = [...data.messages];
        manager.createdAt = new Date(data.metadata.createdAt);
        manager.updatedAt = new Date(data.metadata.updatedAt);
        return manager;
    }

    /**
     * Add a system message (will be placed at the beginning)
     */
    addSystemMessage(content: string): void {
        // Remove existing system messages and add new one at the start
        this.messages = this.messages.filter(m => m.role !== 'system');
        this.messages.unshift({
            role: 'system',
            content,
        });
        this.updatedAt = new Date();
        this.logger.debug('Added system message');
    }

    /**
     * Add a user message
     */
    addUserMessage(content: string): void {
        this.messages.push({
            role: 'user',
            content,
        });
        this.updatedAt = new Date();
        this.logger.debug('Added user message');
        this.checkTokenBudget();
    }

    /**
     * Add an assistant message (text response)
     */
    addAssistantMessage(content: string): void {
        this.messages.push({
            role: 'assistant',
            content,
        });
        this.updatedAt = new Date();
        this.logger.debug('Added assistant message');
        this.checkTokenBudget();
    }

    /**
     * Add an assistant message with tool calls
     */
    addAssistantToolCalls(toolCalls: ToolCall[], content?: string): void {
        this.messages.push({
            role: 'assistant',
            content: content || null,
            tool_calls: toolCalls,
        });
        this.updatedAt = new Date();
        this.logger.debug('Added assistant tool calls', { count: toolCalls.length });
        this.checkTokenBudget();
    }

    /**
     * Add a tool result message
     */
    addToolResult(toolCallId: string, result: string): void {
        this.messages.push({
            role: 'tool',
            content: result,
            tool_call_id: toolCallId,
        });
        this.updatedAt = new Date();
        this.logger.debug('Added tool result', { toolCallId });
        this.checkTokenBudget();
    }

    /**
     * Add a raw message (any role)
     */
    addMessage(message: ConversationMessage): void {
        if (message.role === 'system') {
            this.addSystemMessage(message.content || '');
        } else {
            this.messages.push(message);
            this.updatedAt = new Date();
            this.checkTokenBudget();
        }
    }

    /**
     * Get all messages
     */
    getMessages(): ConversationMessage[] {
        return [...this.messages];
    }

    /**
     * Get messages in a format suitable for the provider
     * This handles any provider-specific transformations
     */
    getMessagesForProvider(_provider: 'anthropic' | 'openai'): ConversationMessage[] {
        // For now, both providers use the same format
        // The execution packages handle the actual transformation
        return this.getMessages();
    }

    /**
     * Get the system prompt (if any)
     */
    getSystemPrompt(): string | undefined {
        const systemMsg = this.messages.find(m => m.role === 'system');
        return systemMsg?.content || undefined;
    }

    /**
     * Get the last message
     */
    getLastMessage(): ConversationMessage | undefined {
        return this.messages[this.messages.length - 1];
    }

    /**
     * Get the last assistant message
     */
    getLastAssistantMessage(): ConversationMessage | undefined {
        for (let i = this.messages.length - 1; i >= 0; i--) {
            if (this.messages[i].role === 'assistant') {
                return this.messages[i];
            }
        }
        return undefined;
    }

    /**
     * Get message count
     */
    count(): number {
        return this.messages.length;
    }

    /**
     * Check if conversation is empty
     */
    isEmpty(): boolean {
        return this.messages.length === 0;
    }

    /**
     * Clear all messages except system prompt
     */
    clearHistory(): void {
        const systemMsg = this.messages.find(m => m.role === 'system');
        this.messages = systemMsg ? [systemMsg] : [];
        this.updatedAt = new Date();
        this.logger.debug('Cleared conversation history');
    }

    /**
     * Clear everything including system prompt
     */
    clear(): void {
        this.messages = [];
        this.updatedAt = new Date();
        this.logger.debug('Cleared all messages');
    }

    /**
     * Serialize conversation for persistence
     */
    serialize(): SerializedConversation {
        return {
            messages: [...this.messages],
            metadata: {
                createdAt: this.createdAt.toISOString(),
                updatedAt: this.updatedAt.toISOString(),
                messageCount: this.messages.length,
                systemPrompt: this.getSystemPrompt(),
            },
        };
    }

    /**
     * Get token usage information
     */
    getTokenUsage(): TokenUsage | undefined {
        if (!this.tokenBudget || !this.tokenCounter) {
            return undefined;
        }

        const used = this.messages.reduce(
            (total, msg) => total + this.tokenCounter!(msg),
            0
        );

        return {
            used,
            max: this.tokenBudget.max,
            remaining: Math.max(0, this.tokenBudget.max - used),
            percentage: (used / this.tokenBudget.max) * 100,
        };
    }

    /**
     * Check token budget and compress if needed
     */
    private checkTokenBudget(): void {
        if (!this.tokenBudget || !this.tokenCounter) {
            return;
        }

        const usage = this.getTokenUsage()!;

        // Check warning threshold
        if (this.tokenBudget.warningThreshold && 
            usage.percentage >= this.tokenBudget.warningThreshold) {
            this.tokenBudget.onWarning?.(usage);
        }

        // Check if we need to compress
        const effectiveMax = this.tokenBudget.max - this.tokenBudget.reserveForResponse;
        if (usage.used > effectiveMax) {
            this.handleBudgetExceeded(usage);
        }
    }

    /**
     * Handle budget exceeded based on configuration
     */
    private handleBudgetExceeded(usage: TokenUsage): void {
        if (!this.tokenBudget) return;

        switch (this.tokenBudget.onBudgetExceeded) {
        case 'compress':
            this.compressConversation();
            break;
        case 'truncate':
            this.truncateConversation();
            break;
        case 'error':
            throw new Error(`Token budget exceeded: ${usage.used}/${this.tokenBudget.max}`);
        case 'warn':
            this.logger.warn('Token budget exceeded', { usage });
            break;
        }
    }

    /**
     * Compress conversation to fit within budget
     */
    private compressConversation(): void {
        if (!this.tokenBudget || !this.tokenCounter) return;

        const tokensBefore = this.messages.reduce(
            (total, msg) => total + this.tokenCounter!(msg),
            0
        );
        const messagesBefore = this.messages.length;

        // Preserve system message
        const systemMsg = this.messages.find(m => m.role === 'system');
        const workingMessages = this.messages.filter(m => m.role !== 'system');

        // Preserve recent messages
        const preserveRecent = this.tokenBudget.preserveRecent || 4;
        const recentMessages = workingMessages.slice(-preserveRecent);
        const olderMessages = workingMessages.slice(0, -preserveRecent);

        // Remove older messages based on strategy
        switch (this.tokenBudget.strategy) {
        case 'fifo':
            // Remove oldest messages first
            while (olderMessages.length > 0 && this.isOverBudget()) {
                olderMessages.shift();
                this.messages = systemMsg 
                    ? [systemMsg, ...olderMessages, ...recentMessages]
                    : [...olderMessages, ...recentMessages];
            }
            break;
        case 'priority-based':
        case 'adaptive':
        default:
            // For now, fall back to FIFO
            while (olderMessages.length > 0 && this.isOverBudget()) {
                olderMessages.shift();
                this.messages = systemMsg 
                    ? [systemMsg, ...olderMessages, ...recentMessages]
                    : [...olderMessages, ...recentMessages];
            }
            break;
        }

        const tokensAfter = this.messages.reduce(
            (total, msg) => total + this.tokenCounter!(msg),
            0
        );

        const stats: CompressionStats = {
            messagesBefore,
            messagesAfter: this.messages.length,
            tokensBefore,
            tokensAfter,
            tokensSaved: tokensBefore - tokensAfter,
            strategy: this.tokenBudget.strategy,
        };

        this.tokenBudget.onCompression?.(stats);
        this.logger.debug('Compressed conversation', stats);
    }

    /**
     * Truncate conversation to fit within budget
     */
    private truncateConversation(): void {
        if (!this.tokenBudget || !this.tokenCounter) return;

        const systemMsg = this.messages.find(m => m.role === 'system');
        const preserveRecent = this.tokenBudget.preserveRecent || 4;

        // Keep system + recent messages only
        const nonSystemMessages = this.messages.filter(m => m.role !== 'system');
        const recentMessages = nonSystemMessages.slice(-preserveRecent);

        this.messages = systemMsg 
            ? [systemMsg, ...recentMessages]
            : recentMessages;

        this.logger.debug('Truncated conversation', { 
            remaining: this.messages.length 
        });
    }

    /**
     * Check if currently over budget
     */
    private isOverBudget(): boolean {
        if (!this.tokenBudget || !this.tokenCounter) return false;

        const used = this.messages.reduce(
            (total, msg) => total + this.tokenCounter!(msg),
            0
        );

        return used > (this.tokenBudget.max - this.tokenBudget.reserveForResponse);
    }

    /**
     * Get a summary of the conversation for debugging
     */
    getSummary(): {
        messageCount: number;
        roles: Record<string, number>;
        hasSystemPrompt: boolean;
        lastRole?: string;
        tokenUsage?: TokenUsage;
        } {
        const roles: Record<string, number> = {};
        for (const msg of this.messages) {
            roles[msg.role] = (roles[msg.role] || 0) + 1;
        }

        return {
            messageCount: this.messages.length,
            roles,
            hasSystemPrompt: this.messages.some(m => m.role === 'system'),
            lastRole: this.messages[this.messages.length - 1]?.role,
            tokenUsage: this.getTokenUsage(),
        };
    }
}

export default ConversationManager;
