import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolRegistry, type Tool, type ToolContext } from '../src/tools';

describe('ToolRegistry', () => {
    let registry: ToolRegistry;

    beforeEach(() => {
        registry = ToolRegistry.create();
    });

    describe('create', () => {
        it('should create an empty registry', () => {
            expect(registry.count()).toBe(0);
        });

        it('should accept initial context', () => {
            const context: ToolContext = { workingDirectory: '/tmp' };
            const registryWithContext = ToolRegistry.create(context);
            
            expect(registryWithContext.getContext().workingDirectory).toBe('/tmp');
        });
    });

    describe('register', () => {
        it('should register a valid tool', () => {
            const tool: Tool = {
                name: 'test_tool',
                description: 'A test tool',
                parameters: {
                    type: 'object',
                    properties: {
                        input: { type: 'string', description: 'Input value' },
                    },
                    required: ['input'],
                },
                execute: async ({ input }) => `Received: ${input}`,
            };

            registry.register(tool);

            expect(registry.has('test_tool')).toBe(true);
            expect(registry.count()).toBe(1);
        });

        it('should throw for invalid tool definition', () => {
            const invalidTool = {
                name: '',  // Empty name should fail
                description: 'Invalid',
                parameters: { type: 'object', properties: {} },
                execute: async () => {},
            };

            expect(() => registry.register(invalidTool as Tool)).toThrow();
        });

        it('should allow overwriting existing tool with warning', () => {
            const tool1: Tool = {
                name: 'tool',
                description: 'Version 1',
                parameters: { type: 'object', properties: {} },
                execute: async () => 'v1',
            };

            const tool2: Tool = {
                name: 'tool',
                description: 'Version 2',
                parameters: { type: 'object', properties: {} },
                execute: async () => 'v2',
            };

            registry.register(tool1);
            registry.register(tool2);

            expect(registry.count()).toBe(1);
            expect(registry.get('tool')?.description).toBe('Version 2');
        });
    });

    describe('registerAll', () => {
        it('should register multiple tools', () => {
            const tools: Tool[] = [
                {
                    name: 'tool1',
                    description: 'Tool 1',
                    parameters: { type: 'object', properties: {} },
                    execute: async () => 'result1',
                },
                {
                    name: 'tool2',
                    description: 'Tool 2',
                    parameters: { type: 'object', properties: {} },
                    execute: async () => 'result2',
                },
            ];

            registry.registerAll(tools);

            expect(registry.count()).toBe(2);
        });
    });

    describe('get', () => {
        it('should return tool by name', () => {
            const tool: Tool = {
                name: 'my_tool',
                description: 'My tool',
                parameters: { type: 'object', properties: {} },
                execute: async () => 'result',
            };

            registry.register(tool);

            expect(registry.get('my_tool')).toBe(tool);
        });

        it('should return undefined for non-existent tool', () => {
            expect(registry.get('nonexistent')).toBeUndefined();
        });
    });

    describe('getAll', () => {
        it('should return all registered tools', () => {
            registry.register({
                name: 'tool1',
                description: 'Tool 1',
                parameters: { type: 'object', properties: {} },
                execute: async () => {},
            });
            registry.register({
                name: 'tool2',
                description: 'Tool 2',
                parameters: { type: 'object', properties: {} },
                execute: async () => {},
            });

            const tools = registry.getAll();

            expect(tools).toHaveLength(2);
        });
    });

    describe('getByCategory', () => {
        it('should filter tools by category', () => {
            registry.register({
                name: 'file_read',
                description: 'Read file',
                parameters: { type: 'object', properties: {} },
                execute: async () => {},
                category: 'filesystem',
            });
            registry.register({
                name: 'file_write',
                description: 'Write file',
                parameters: { type: 'object', properties: {} },
                execute: async () => {},
                category: 'filesystem',
            });
            registry.register({
                name: 'http_get',
                description: 'HTTP GET',
                parameters: { type: 'object', properties: {} },
                execute: async () => {},
                category: 'network',
            });

            const fsTools = registry.getByCategory('filesystem');

            expect(fsTools).toHaveLength(2);
            expect(fsTools.every(t => t.category === 'filesystem')).toBe(true);
        });
    });

    describe('execute', () => {
        it('should execute tool and return result', async () => {
            registry.register({
                name: 'add',
                description: 'Add numbers',
                parameters: {
                    type: 'object',
                    properties: {
                        a: { type: 'number', description: 'First number' },
                        b: { type: 'number', description: 'Second number' },
                    },
                    required: ['a', 'b'],
                },
                execute: async ({ a, b }) => a + b,
            });

            const result = await registry.execute('add', { a: 2, b: 3 });

            expect(result).toBe(5);
        });

        it('should throw for non-existent tool', async () => {
            await expect(registry.execute('nonexistent', {})).rejects.toThrow(
                'Tool "nonexistent" not found'
            );
        });

        it('should pass context to tool', async () => {
            const context: ToolContext = { 
                workingDirectory: '/test',
                customData: 'test123',
            };
            const registryWithContext = ToolRegistry.create(context);

            let receivedContext: ToolContext | undefined;
            registryWithContext.register({
                name: 'check_context',
                description: 'Check context',
                parameters: { type: 'object', properties: {} },
                execute: async (_params, ctx) => {
                    receivedContext = ctx;
                    return 'done';
                },
            });

            await registryWithContext.execute('check_context', {});

            expect(receivedContext?.workingDirectory).toBe('/test');
            expect(receivedContext?.customData).toBe('test123');
        });

        it('should track usage statistics', async () => {
            registry.register({
                name: 'tracked_tool',
                description: 'Tracked tool',
                parameters: { type: 'object', properties: {} },
                execute: async () => 'result',
            });

            await registry.execute('tracked_tool', {});
            await registry.execute('tracked_tool', {});
            await registry.execute('tracked_tool', {});

            const stats = registry.getUsageStats();
            const toolStats = stats.get('tracked_tool');

            expect(toolStats?.calls).toBe(3);
            expect(toolStats?.failures).toBe(0);
            expect(toolStats?.successRate).toBe(1);
        });

        it('should track failures', async () => {
            registry.register({
                name: 'failing_tool',
                description: 'Failing tool',
                parameters: { type: 'object', properties: {} },
                execute: async () => {
                    throw new Error('Tool failed');
                },
            });

            await expect(registry.execute('failing_tool', {})).rejects.toThrow();

            const stats = registry.getUsageStats();
            const toolStats = stats.get('failing_tool');

            expect(toolStats?.calls).toBe(1);
            expect(toolStats?.failures).toBe(1);
            expect(toolStats?.successRate).toBe(0);
        });
    });

    describe('executeBatch', () => {
        it('should execute multiple tools in sequence', async () => {
            registry.register({
                name: 'double',
                description: 'Double number',
                parameters: { type: 'object', properties: {} },
                execute: async ({ n }) => n * 2,
            });

            const results = await registry.executeBatch([
                { name: 'double', params: { n: 1 } },
                { name: 'double', params: { n: 2 } },
                { name: 'double', params: { n: 3 } },
            ]);

            expect(results).toEqual([2, 4, 6]);
        });

        it('should handle errors in batch without stopping', async () => {
            registry.register({
                name: 'ok',
                description: 'OK',
                parameters: { type: 'object', properties: {} },
                execute: async () => 'ok',
            });

            const results = await registry.executeBatch([
                { name: 'ok', params: {} },
                { name: 'nonexistent', params: {} },
                { name: 'ok', params: {} },
            ]);

            expect(results[0]).toBe('ok');
            expect(results[1]).toHaveProperty('error');
            expect(results[2]).toBe('ok');
        });
    });

    describe('toOpenAIFormat', () => {
        it('should convert tools to OpenAI format', () => {
            registry.register({
                name: 'search',
                description: 'Search for something',
                parameters: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: 'Search query' },
                    },
                    required: ['query'],
                },
                execute: async () => {},
            });

            const openAITools = registry.toOpenAIFormat();

            expect(openAITools).toHaveLength(1);
            expect(openAITools[0].type).toBe('function');
            expect(openAITools[0].function.name).toBe('search');
            expect(openAITools[0].function.description).toBe('Search for something');
            expect(openAITools[0].function.parameters.properties.query).toBeDefined();
        });
    });

    describe('toAnthropicFormat', () => {
        it('should convert tools to Anthropic format', () => {
            registry.register({
                name: 'read_file',
                description: 'Read a file',
                parameters: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'File path' },
                    },
                    required: ['path'],
                },
                execute: async () => {},
            });

            const anthropicTools = registry.toAnthropicFormat();

            expect(anthropicTools).toHaveLength(1);
            expect(anthropicTools[0].name).toBe('read_file');
            expect(anthropicTools[0].description).toBe('Read a file');
            expect(anthropicTools[0].input_schema.type).toBe('object');
            expect(anthropicTools[0].input_schema.properties.path).toBeDefined();
        });
    });

    describe('getDefinitions', () => {
        it('should return tool definitions without execute function', () => {
            registry.register({
                name: 'tool',
                description: 'Tool',
                parameters: { type: 'object', properties: {} },
                execute: async () => {},
                category: 'test',
                cost: 'cheap',
            });

            const definitions = registry.getDefinitions();

            expect(definitions).toHaveLength(1);
            expect(definitions[0].name).toBe('tool');
            expect(definitions[0].category).toBe('test');
            expect(definitions[0].cost).toBe('cheap');
            expect((definitions[0] as any).execute).toBeUndefined();
        });
    });

    describe('updateContext', () => {
        it('should update context', () => {
            registry.updateContext({ workingDirectory: '/new/path' });
            
            expect(registry.getContext().workingDirectory).toBe('/new/path');
        });

        it('should merge with existing context', () => {
            const registryWithContext = ToolRegistry.create({ 
                workingDirectory: '/old',
                storage: 'memory',
            });
            
            registryWithContext.updateContext({ workingDirectory: '/new' });
            
            const ctx = registryWithContext.getContext();
            expect(ctx.workingDirectory).toBe('/new');
            expect(ctx.storage).toBe('memory');
        });
    });

    describe('clear', () => {
        it('should remove all tools', () => {
            registry.register({
                name: 'tool',
                description: 'Tool',
                parameters: { type: 'object', properties: {} },
                execute: async () => {},
            });

            registry.clear();

            expect(registry.count()).toBe(0);
        });
    });

    describe('unregister', () => {
        it('should remove specific tool', () => {
            registry.register({
                name: 'tool1',
                description: 'Tool 1',
                parameters: { type: 'object', properties: {} },
                execute: async () => {},
            });
            registry.register({
                name: 'tool2',
                description: 'Tool 2',
                parameters: { type: 'object', properties: {} },
                execute: async () => {},
            });

            const result = registry.unregister('tool1');

            expect(result).toBe(true);
            expect(registry.has('tool1')).toBe(false);
            expect(registry.has('tool2')).toBe(true);
        });

        it('should return false for non-existent tool', () => {
            const result = registry.unregister('nonexistent');
            
            expect(result).toBe(false);
        });
    });

    describe('getCategories', () => {
        it('should return unique categories', () => {
            registry.register({
                name: 't1',
                description: 'T1',
                parameters: { type: 'object', properties: {} },
                execute: async () => {},
                category: 'a',
            });
            registry.register({
                name: 't2',
                description: 'T2',
                parameters: { type: 'object', properties: {} },
                execute: async () => {},
                category: 'b',
            });
            registry.register({
                name: 't3',
                description: 'T3',
                parameters: { type: 'object', properties: {} },
                execute: async () => {},
                category: 'a',
            });

            const categories = registry.getCategories();

            expect(categories).toEqual(['a', 'b']);
        });
    });

    describe('getMostUsed', () => {
        it('should return most frequently used tools', async () => {
            registry.register({
                name: 'popular',
                description: 'Popular',
                parameters: { type: 'object', properties: {} },
                execute: async () => {},
            });
            registry.register({
                name: 'unpopular',
                description: 'Unpopular',
                parameters: { type: 'object', properties: {} },
                execute: async () => {},
            });

            await registry.execute('popular', {});
            await registry.execute('popular', {});
            await registry.execute('popular', {});
            await registry.execute('unpopular', {});

            const mostUsed = registry.getMostUsed(1);

            expect(mostUsed).toHaveLength(1);
            expect(mostUsed[0].name).toBe('popular');
        });
    });

    describe('resetStats', () => {
        it('should reset all usage statistics', async () => {
            registry.register({
                name: 'tool',
                description: 'Tool',
                parameters: { type: 'object', properties: {} },
                execute: async () => {},
            });

            await registry.execute('tool', {});
            await registry.execute('tool', {});

            registry.resetStats();

            const stats = registry.getUsageStats().get('tool');
            expect(stats?.calls).toBe(0);
        });
    });
});

