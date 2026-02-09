/**
 * Tests for AgentLoop
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentLoop, type AgentProvider, type AgentProviderResponse, type AgentChunk } from '../src/loop';
import { ToolRegistry } from '../src/tools';
import { ConversationManager } from '../src/conversation';

// Mock provider for testing
function createMockProvider(responses: AgentProviderResponse[]): AgentProvider {
    let callIndex = 0;
    
    return {
        name: 'mock',
        async execute() {
            const response = responses[callIndex] || responses[responses.length - 1];
            callIndex++;
            return response;
        },
    };
}

// Mock streaming provider
function createMockStreamingProvider(responses: AgentProviderResponse[]): AgentProvider {
    let callIndex = 0;
    
    return {
        name: 'mock-streaming',
        async execute() {
            const response = responses[callIndex] || responses[responses.length - 1];
            callIndex++;
            return response;
        },
        async *executeStream() {
            const response = responses[callIndex] || responses[responses.length - 1];
            callIndex++;
            
            // Simulate streaming text
            if (response.content) {
                for (const char of response.content) {
                    yield { type: 'text' as const, text: char };
                }
            }
            
            // Simulate tool calls
            if (response.toolCalls) {
                for (let i = 0; i < response.toolCalls.length; i++) {
                    const tc = response.toolCalls[i];
                    yield {
                        type: 'tool_call_start' as const,
                        toolCall: {
                            id: tc.id,
                            index: i,
                            name: tc.function.name,
                        },
                    };
                    yield {
                        type: 'tool_call_delta' as const,
                        toolCall: {
                            index: i,
                            argumentsDelta: tc.function.arguments,
                        },
                    };
                }
            }
            
            yield { type: 'done' as const };
        },
    };
}

describe('AgentLoop', () => {
    let toolRegistry: ToolRegistry;

    beforeEach(() => {
        toolRegistry = ToolRegistry.create();
        
        // Register a simple calculator tool
        toolRegistry.register({
            name: 'add',
            description: 'Add two numbers',
            parameters: {
                type: 'object',
                properties: {
                    a: { type: 'number', description: 'First number' },
                    b: { type: 'number', description: 'Second number' },
                },
                required: ['a', 'b'],
            },
            execute: async (params) => params.a + params.b,
        });

        // Register a tool that throws
        toolRegistry.register({
            name: 'fail',
            description: 'A tool that always fails',
            parameters: {
                type: 'object',
                properties: {},
            },
            execute: async () => {
                throw new Error('Tool failed intentionally');
            },
        });
    });

    describe('creation', () => {
        it('should create an agent loop', () => {
            const provider = createMockProvider([{ content: 'Hello', model: 'test' }]);
            const loop = AgentLoop.create({ provider, toolRegistry });
            
            expect(loop).toBeDefined();
        });

        it('should accept a conversation manager', () => {
            const provider = createMockProvider([{ content: 'Hello', model: 'test' }]);
            const conversation = ConversationManager.create();
            conversation.addSystemMessage('You are helpful');
            
            const loop = AgentLoop.create({ provider, toolRegistry, conversation });
            
            expect(loop.getConversation().getSystemPrompt()).toBe('You are helpful');
        });
    });

    describe('run (non-streaming)', () => {
        it('should handle simple text response', async () => {
            const provider = createMockProvider([
                { content: 'Hello! How can I help?', model: 'test' },
            ]);
            const loop = AgentLoop.create({ provider, toolRegistry });

            const result = await loop.run('Hello');

            expect(result.response).toBe('Hello! How can I help?');
            expect(result.iterations).toBe(1);
            expect(result.toolCalls).toHaveLength(0);
            expect(result.cancelled).toBe(false);
        });

        it('should handle tool call and response', async () => {
            const provider = createMockProvider([
                // First response: tool call
                {
                    content: '',
                    model: 'test',
                    toolCalls: [
                        {
                            id: 'call_1',
                            type: 'function',
                            function: {
                                name: 'add',
                                arguments: '{"a": 2, "b": 3}',
                            },
                        },
                    ],
                },
                // Second response: final answer
                {
                    content: 'The sum is 5',
                    model: 'test',
                },
            ]);
            const loop = AgentLoop.create({ provider, toolRegistry });

            const result = await loop.run('What is 2 + 3?');

            expect(result.response).toBe('The sum is 5');
            expect(result.iterations).toBe(2);
            expect(result.toolCalls).toHaveLength(1);
            expect(result.toolCalls[0].name).toBe('add');
            expect(result.toolCalls[0].result).toBe(5);
        });

        it('should handle tool errors gracefully', async () => {
            const provider = createMockProvider([
                {
                    content: '',
                    model: 'test',
                    toolCalls: [
                        {
                            id: 'call_1',
                            type: 'function',
                            function: {
                                name: 'fail',
                                arguments: '{}',
                            },
                        },
                    ],
                },
                {
                    content: 'Sorry, the tool failed',
                    model: 'test',
                },
            ]);
            const loop = AgentLoop.create({ provider, toolRegistry });

            const result = await loop.run('Try the failing tool');

            expect(result.response).toBe('Sorry, the tool failed');
            expect(result.toolCalls).toHaveLength(1);
            expect(result.toolCalls[0].result).toEqual({ error: 'Tool failed intentionally' });
        });

        it('should respect max iterations', async () => {
            // Provider that always returns tool calls
            const provider = createMockProvider([
                {
                    content: '',
                    model: 'test',
                    toolCalls: [
                        {
                            id: 'call_1',
                            type: 'function',
                            function: {
                                name: 'add',
                                arguments: '{"a": 1, "b": 1}',
                            },
                        },
                    ],
                },
            ]);
            const loop = AgentLoop.create({ 
                provider, 
                toolRegistry,
                maxIterations: 3,
            });

            const result = await loop.run('Keep adding');

            expect(result.iterations).toBe(3);
            expect(result.response).toContain('maximum iterations');
        });

        it('should track token usage', async () => {
            const provider = createMockProvider([
                { 
                    content: 'Hello!', 
                    model: 'test',
                    usage: { inputTokens: 10, outputTokens: 5 },
                },
            ]);
            const loop = AgentLoop.create({ provider, toolRegistry });

            const result = await loop.run('Hi');

            expect(result.tokenUsage).toEqual({ input: 10, output: 5 });
        });
    });

    describe('runStream', () => {
        it('should stream text response', async () => {
            const provider = createMockStreamingProvider([
                { content: 'Hi!', model: 'test' },
            ]);
            const loop = AgentLoop.create({ provider, toolRegistry });

            const chunks: AgentChunk[] = [];
            for await (const chunk of loop.runStream('Hello')) {
                chunks.push(chunk);
            }

            const textChunks = chunks.filter(c => c.type === 'text');
            expect(textChunks.length).toBe(3); // 'H', 'i', '!'
            expect(chunks.some(c => c.type === 'done')).toBe(true);
        });

        it('should stream tool execution', async () => {
            const provider = createMockStreamingProvider([
                {
                    content: '',
                    model: 'test',
                    toolCalls: [
                        {
                            id: 'call_1',
                            type: 'function',
                            function: {
                                name: 'add',
                                arguments: '{"a": 1, "b": 2}',
                            },
                        },
                    ],
                },
                { content: 'Result is 3', model: 'test' },
            ]);
            const loop = AgentLoop.create({ provider, toolRegistry });

            const chunks: AgentChunk[] = [];
            for await (const chunk of loop.runStream('Add 1 and 2')) {
                chunks.push(chunk);
            }

            expect(chunks.some(c => c.type === 'tool_start')).toBe(true);
            expect(chunks.some(c => c.type === 'tool_result')).toBe(true);
            expect(chunks.some(c => c.type === 'done')).toBe(true);
        });

        it('should fall back to non-streaming when provider does not support it', async () => {
            const provider = createMockProvider([
                { content: 'Hello!', model: 'test' },
            ]);
            const loop = AgentLoop.create({ provider, toolRegistry });

            const chunks: AgentChunk[] = [];
            for await (const chunk of loop.runStream('Hi')) {
                chunks.push(chunk);
            }

            expect(chunks.some(c => c.type === 'text')).toBe(true);
            expect(chunks.some(c => c.type === 'done')).toBe(true);
        });
    });

    describe('cancellation', () => {
        it('should support cancellation', async () => {
            const provider = createMockProvider([
                {
                    content: '',
                    model: 'test',
                    toolCalls: [
                        {
                            id: 'call_1',
                            type: 'function',
                            function: {
                                name: 'add',
                                arguments: '{"a": 1, "b": 1}',
                            },
                        },
                    ],
                },
            ]);
            const loop = AgentLoop.create({ provider, toolRegistry });

            // Cancel immediately
            loop.cancel();

            const result = await loop.run('Test');

            expect(result.cancelled).toBe(true);
        });

        it('should reset cancellation state', async () => {
            const provider = createMockProvider([{ content: 'Hi', model: 'test' }]);
            const loop = AgentLoop.create({ provider, toolRegistry });

            loop.cancel();
            loop.resetCancellation();

            // Should be able to run again
            const result = await loop.run('Test');
            expect(result).toBeDefined();
        });
    });

    describe('events', () => {
        it('should emit events during execution', async () => {
            const provider = createMockProvider([
                {
                    content: '',
                    model: 'test',
                    toolCalls: [
                        {
                            id: 'call_1',
                            type: 'function',
                            function: {
                                name: 'add',
                                arguments: '{"a": 2, "b": 2}',
                            },
                        },
                    ],
                },
                { content: 'Done', model: 'test' },
            ]);

            const events = {
                onToolCallStart: vi.fn(),
                onToolCallComplete: vi.fn(),
                onLLMRequest: vi.fn(),
                onLLMResponse: vi.fn(),
                onIterationStart: vi.fn(),
                onIterationComplete: vi.fn(),
            };

            const loop = AgentLoop.create({ provider, toolRegistry, events });
            await loop.run('Test');

            expect(events.onToolCallStart).toHaveBeenCalledWith('add', { a: 2, b: 2 });
            expect(events.onToolCallComplete).toHaveBeenCalledWith('add', 4, expect.any(Number));
            expect(events.onLLMRequest).toHaveBeenCalled();
            expect(events.onLLMResponse).toHaveBeenCalled();
            expect(events.onIterationStart).toHaveBeenCalledWith(1);
            expect(events.onIterationComplete).toHaveBeenCalled();
        });
    });

    describe('system prompt', () => {
        it('should set system prompt', async () => {
            const provider = createMockProvider([{ content: 'Hi', model: 'test' }]);
            const loop = AgentLoop.create({ provider, toolRegistry });

            loop.setSystemPrompt('You are a helpful assistant');

            const conversation = loop.getConversation();
            expect(conversation.getSystemPrompt()).toBe('You are a helpful assistant');
        });
    });
});
