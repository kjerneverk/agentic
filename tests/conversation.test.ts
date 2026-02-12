/**
 * Tests for ConversationManager
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationManager } from '../src/conversation';

describe('ConversationManager', () => {
    let manager: ConversationManager;

    beforeEach(() => {
        manager = ConversationManager.create();
    });

    describe('creation', () => {
        it('should create an empty conversation', () => {
            expect(manager.isEmpty()).toBe(true);
            expect(manager.count()).toBe(0);
        });

        it('should create from serialized state', () => {
            manager.addSystemMessage('You are helpful');
            manager.addUserMessage('Hello');
            manager.addAssistantMessage('Hi there!');

            const serialized = manager.serialize();
            const restored = ConversationManager.fromSerialized(serialized);

            expect(restored.count()).toBe(3);
            expect(restored.getSystemPrompt()).toBe('You are helpful');
        });
    });

    describe('message management', () => {
        it('should add system message at the beginning', () => {
            manager.addUserMessage('First');
            manager.addSystemMessage('System');

            const messages = manager.getMessages();
            expect(messages[0].role).toBe('system');
            expect(messages[0].content).toBe('System');
        });

        it('should replace existing system message', () => {
            manager.addSystemMessage('First system');
            manager.addSystemMessage('Second system');

            const messages = manager.getMessages();
            const systemMessages = messages.filter(m => m.role === 'system');
            expect(systemMessages.length).toBe(1);
            expect(systemMessages[0].content).toBe('Second system');
        });

        it('should add user messages', () => {
            manager.addUserMessage('Hello');
            
            const messages = manager.getMessages();
            expect(messages.length).toBe(1);
            expect(messages[0].role).toBe('user');
            expect(messages[0].content).toBe('Hello');
        });

        it('should add assistant messages', () => {
            manager.addAssistantMessage('Hi there!');
            
            const messages = manager.getMessages();
            expect(messages.length).toBe(1);
            expect(messages[0].role).toBe('assistant');
            expect(messages[0].content).toBe('Hi there!');
        });

        it('should add assistant tool calls', () => {
            const toolCalls = [
                {
                    id: 'call_1',
                    type: 'function' as const,
                    function: {
                        name: 'read_file',
                        arguments: '{"path": "/test.txt"}',
                    },
                },
            ];

            manager.addAssistantToolCalls(toolCalls, 'Let me read that file');
            
            const messages = manager.getMessages();
            expect(messages.length).toBe(1);
            expect(messages[0].role).toBe('assistant');
            expect(messages[0].content).toBe('Let me read that file');
            expect(messages[0].tool_calls).toEqual(toolCalls);
        });

        it('should add tool results', () => {
            manager.addToolResult('call_1', 'File contents here');
            
            const messages = manager.getMessages();
            expect(messages.length).toBe(1);
            expect(messages[0].role).toBe('tool');
            expect(messages[0].content).toBe('File contents here');
            expect(messages[0].tool_call_id).toBe('call_1');
        });
    });

    describe('message retrieval', () => {
        beforeEach(() => {
            manager.addSystemMessage('You are helpful');
            manager.addUserMessage('Hello');
            manager.addAssistantMessage('Hi!');
            manager.addUserMessage('How are you?');
        });

        it('should get all messages', () => {
            const messages = manager.getMessages();
            expect(messages.length).toBe(4);
        });

        it('should get system prompt', () => {
            expect(manager.getSystemPrompt()).toBe('You are helpful');
        });

        it('should get last message', () => {
            const last = manager.getLastMessage();
            expect(last?.role).toBe('user');
            expect(last?.content).toBe('How are you?');
        });

        it('should get last assistant message', () => {
            const lastAssistant = manager.getLastAssistantMessage();
            expect(lastAssistant?.role).toBe('assistant');
            expect(lastAssistant?.content).toBe('Hi!');
        });

        it('should return undefined for last assistant when none exist', () => {
            const emptyManager = ConversationManager.create();
            emptyManager.addUserMessage('Hello');
            expect(emptyManager.getLastAssistantMessage()).toBeUndefined();
        });
    });

    describe('clearing', () => {
        beforeEach(() => {
            manager.addSystemMessage('You are helpful');
            manager.addUserMessage('Hello');
            manager.addAssistantMessage('Hi!');
        });

        it('should clear history but keep system prompt', () => {
            manager.clearHistory();
            
            expect(manager.count()).toBe(1);
            expect(manager.getSystemPrompt()).toBe('You are helpful');
        });

        it('should clear everything including system prompt', () => {
            manager.clear();
            
            expect(manager.count()).toBe(0);
            expect(manager.getSystemPrompt()).toBeUndefined();
        });
    });

    describe('serialization', () => {
        it('should serialize conversation state', () => {
            manager.addSystemMessage('You are helpful');
            manager.addUserMessage('Hello');

            const serialized = manager.serialize();

            expect(serialized.messages.length).toBe(2);
            expect(serialized.metadata.messageCount).toBe(2);
            expect(serialized.metadata.systemPrompt).toBe('You are helpful');
            expect(serialized.metadata.createdAt).toBeDefined();
            expect(serialized.metadata.updatedAt).toBeDefined();
        });
    });

    describe('summary', () => {
        it('should provide conversation summary', () => {
            manager.addSystemMessage('You are helpful');
            manager.addUserMessage('Hello');
            manager.addAssistantMessage('Hi!');
            manager.addUserMessage('Bye');

            const summary = manager.getSummary();

            expect(summary.messageCount).toBe(4);
            expect(summary.roles.system).toBe(1);
            expect(summary.roles.user).toBe(2);
            expect(summary.roles.assistant).toBe(1);
            expect(summary.hasSystemPrompt).toBe(true);
            expect(summary.lastRole).toBe('user');
        });
    });

    describe('provider format', () => {
        it('should return messages for anthropic provider', () => {
            manager.addUserMessage('Hello');
            
            const messages = manager.getMessagesForProvider('anthropic');
            expect(messages.length).toBe(1);
        });

        it('should return messages for openai provider', () => {
            manager.addUserMessage('Hello');
            
            const messages = manager.getMessagesForProvider('openai');
            expect(messages.length).toBe(1);
        });
    });
});
