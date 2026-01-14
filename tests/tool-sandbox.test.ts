import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import {
    ToolSandbox,
    ToolSandboxEvents,
    createSecureTool,
} from '../src/tool-sandbox';
import { ToolGuard } from '../src/tool-guard';
import { ToolRegistry, Tool } from '../src/tools';

describe('ToolSandbox', () => {
    let sandbox: ToolSandbox;
    let events: {
        concurrencyExceeded: { toolName: string; activeCount: number }[];
        timeout: { toolName: string; timeoutMs: number }[];
        outputSizeExceeded: { toolName: string; size: number; maxSize: number }[];
        cancelled: string[];
    };

    const createTestTool = (
        name: string,
        executeFn?: (params: any, context?: any) => Promise<any>
    ): Tool => ({
        name,
        description: `Test tool ${name}`,
        parameters: {
            type: 'object',
            properties: {
                input: { type: 'string', description: 'Input value' },
            },
        },
        execute: executeFn || (async (params) => ({ result: params.input })),
    });

    beforeEach(() => {
        events = {
            concurrencyExceeded: [],
            timeout: [],
            outputSizeExceeded: [],
            cancelled: [],
        };

        const eventHandlers: ToolSandboxEvents = {
            onConcurrencyExceeded: (toolName, activeCount) =>
                events.concurrencyExceeded.push({ toolName, activeCount }),
            onTimeout: (toolName, timeoutMs) =>
                events.timeout.push({ toolName, timeoutMs }),
            onOutputSizeExceeded: (toolName, size, maxSize) =>
                events.outputSizeExceeded.push({ toolName, size, maxSize }),
            onCancelled: (executionId) => events.cancelled.push(executionId),
        };

        sandbox = new ToolSandbox({}, undefined, eventHandlers);
    });

    describe('basic execution', () => {
        it('should execute a tool successfully', async () => {
            const tool = createTestTool('test_tool');
            const result = await sandbox.execute(tool, { input: 'hello' }, {});
            expect(result).toEqual({ result: 'hello' });
        });

        it('should pass context to tool', async () => {
            const tool = createTestTool('context_tool', async (params, context) => ({
                input: params.input,
                workingDir: context?.workingDirectory,
            }));

            const result = await sandbox.execute(
                tool,
                { input: 'test' },
                { workingDirectory: '/test' }
            );

            expect(result.workingDir).toBe('/test');
        });

        it('should provide sandbox context', async () => {
            const tool = createTestTool('sandbox_tool', async (params, context) => ({
                hasSandbox: !!context?.sandbox,
                executionId: context?.sandbox?.executionId,
            }));

            const result = await sandbox.execute(tool, {}, {});

            expect(result.hasSandbox).toBe(true);
            expect(result.executionId).toMatch(/^exec-\d+-\d+$/);
        });

        it('should bypass sandbox when disabled', async () => {
            const disabledSandbox = new ToolSandbox({ sandboxExecution: false });
            const tool = createTestTool('test_tool', async (params, context) => ({
                hasSandbox: !!context?.sandbox,
            }));

            const result = await disabledSandbox.execute(tool, {}, {});
            expect(result.hasSandbox).toBe(false);
        });
    });

    describe('timeout enforcement', () => {
        it('should timeout long-running tools', async () => {
            const timeoutSandbox = new ToolSandbox(
                { maxExecutionTime: 100 },
                undefined,
                {
                    onTimeout: (toolName, timeoutMs) =>
                        events.timeout.push({ toolName, timeoutMs }),
                }
            );

            const slowTool = createTestTool(
                'slow_tool',
                async () => new Promise((r) => setTimeout(r, 5000))
            );

            await expect(
                timeoutSandbox.execute(slowTool, {}, {})
            ).rejects.toThrow('timed out');

            expect(events.timeout).toHaveLength(1);
            expect(events.timeout[0].toolName).toBe('slow_tool');
        });

        it('should allow custom timeout per execution', async () => {
            const tool = createTestTool(
                'slow_tool',
                async () => new Promise((r) => setTimeout(r, 200))
            );

            // Should succeed with longer timeout
            const result = await sandbox.execute(tool, {}, {}, {
                maxExecutionTime: 500,
            });
            expect(result).toBeUndefined(); // setTimeout resolves with undefined
        });
    });

    describe('concurrency limits', () => {
        it('should limit concurrent executions', async () => {
            const limitedSandbox = new ToolSandbox(
                { maxConcurrentCalls: 2 },
                undefined,
                {
                    onConcurrencyExceeded: (toolName, activeCount) =>
                        events.concurrencyExceeded.push({ toolName, activeCount }),
                }
            );

            const slowTool = createTestTool(
                'slow_tool',
                async () => new Promise((r) => setTimeout(r, 500))
            );

            // Start two executions
            const p1 = limitedSandbox.execute(slowTool, {}, {});
            const p2 = limitedSandbox.execute(slowTool, {}, {});

            // Third should fail
            await expect(
                limitedSandbox.execute(slowTool, {}, {})
            ).rejects.toThrow('Too many concurrent');

            expect(events.concurrencyExceeded).toHaveLength(1);

            // Wait for others to complete
            await Promise.all([p1, p2]);
        });

        it('should track active execution count', async () => {
            const slowTool = createTestTool(
                'slow_tool',
                async () => new Promise((r) => setTimeout(r, 100))
            );

            expect(sandbox.getActiveCount()).toBe(0);

            const p = sandbox.execute(slowTool, {}, {});
            expect(sandbox.getActiveCount()).toBe(1);

            await p;
            expect(sandbox.getActiveCount()).toBe(0);
        });
    });

    describe('output size limits', () => {
        it('should reject oversized output', async () => {
            const largeTool = createTestTool('large_tool', async () => ({
                data: 'x'.repeat(1024 * 1024 * 2), // 2MB string
            }));

            await expect(
                sandbox.execute(largeTool, {}, {}, { maxOutputSize: 1024 * 100 })
            ).rejects.toThrow('exceeded maximum size');

            expect(events.outputSizeExceeded).toHaveLength(1);
        });

        it('should allow output within limits', async () => {
            const smallTool = createTestTool('small_tool', async () => ({
                data: 'small output',
            }));

            const result = await sandbox.execute(smallTool, {}, {});
            expect(result.data).toBe('small output');
        });
    });

    describe('execution hooks', () => {
        it('should call onBeforeExecution', async () => {
            const beforeCalls: { tool: string; params: any }[] = [];
            const tool = createTestTool('test_tool');

            await sandbox.execute(tool, { input: 'test' }, {}, {
                onBeforeExecution: async (t, params) => {
                    beforeCalls.push({ tool: t.name, params });
                },
            });

            expect(beforeCalls).toHaveLength(1);
            expect(beforeCalls[0].tool).toBe('test_tool');
        });

        it('should call onAfterExecution on success', async () => {
            const afterCalls: { tool: string; result: any; error?: Error }[] = [];
            const tool = createTestTool('test_tool');

            await sandbox.execute(tool, { input: 'test' }, {}, {
                onAfterExecution: async (t, result, error) => {
                    afterCalls.push({ tool: t.name, result, error });
                },
            });

            expect(afterCalls).toHaveLength(1);
            expect(afterCalls[0].result).toEqual({ result: 'test' });
            expect(afterCalls[0].error).toBeUndefined();
        });

        it('should call onAfterExecution on error', async () => {
            const afterCalls: { tool: string; result: any; error?: Error }[] = [];
            const failingTool = createTestTool('failing_tool', async () => {
                throw new Error('Tool failed');
            });

            await expect(
                sandbox.execute(failingTool, {}, {}, {
                    onAfterExecution: async (t, result, error) => {
                        afterCalls.push({ tool: t.name, result, error });
                    },
                })
            ).rejects.toThrow('Tool failed');

            expect(afterCalls).toHaveLength(1);
            expect(afterCalls[0].error?.message).toBe('Tool failed');
        });
    });

    describe('cancellation', () => {
        it('should track active execution IDs', async () => {
            const tool = createTestTool('fast_tool');
            
            // Before execution
            expect(sandbox.getActiveExecutionIds()).toHaveLength(0);
            
            // During execution (use a slightly slow tool)
            const slowTool = createTestTool(
                'slow_tool',
                async () => {
                    await new Promise((r) => setTimeout(r, 50));
                    return { done: true };
                }
            );
            
            const p = sandbox.execute(slowTool, {}, {});
            expect(sandbox.getActiveExecutionIds()).toHaveLength(1);
            expect(sandbox.getActiveExecutionIds()[0]).toMatch(/^exec-\d+-\d+$/);
            
            await p;
            expect(sandbox.getActiveExecutionIds()).toHaveLength(0);
        });

        it('should clear active executions on cancelAll', async () => {
            const slowTool = createTestTool(
                'slow_tool',
                async () => new Promise((r) => setTimeout(r, 100))
            );

            // Start execution
            sandbox.execute(slowTool, {}, {}).catch(() => {}); // Ignore rejection
            sandbox.execute(slowTool, {}, {}).catch(() => {}); // Ignore rejection

            expect(sandbox.getActiveCount()).toBe(2);

            // Cancel all
            sandbox.cancelAll();

            // Active count should be 0 immediately after cancelAll
            expect(sandbox.getActiveCount()).toBe(0);
            expect(events.cancelled).toHaveLength(2);
        });

        it('should cancel specific execution by ID', async () => {
            const slowTool = createTestTool(
                'slow_tool',
                async () => new Promise((r) => setTimeout(r, 100))
            );

            // Start execution
            sandbox.execute(slowTool, {}, {}).catch(() => {}); // Ignore rejection
            const ids = sandbox.getActiveExecutionIds();

            expect(ids).toHaveLength(1);

            // Cancel specific
            const cancelled = sandbox.cancel(ids[0]);
            expect(cancelled).toBe(true);
            expect(sandbox.getActiveCount()).toBe(0);
            expect(events.cancelled).toContain(ids[0]);
        });

        it('should return false when cancelling non-existent execution', () => {
            const cancelled = sandbox.cancel('non-existent-id');
            expect(cancelled).toBe(false);
        });
    });

    describe('configuration', () => {
        it('should check enabled status', () => {
            expect(sandbox.isEnabled()).toBe(true);

            const disabledSandbox = new ToolSandbox({
                enabled: false,
                sandboxExecution: true,
            });
            expect(disabledSandbox.isEnabled()).toBe(false);
        });

        it('should return config copy', () => {
            const config = sandbox.getConfig();
            expect(config.maxExecutionTime).toBe(30000);
            expect(config.maxConcurrentCalls).toBe(10);
        });

        it('should update config', () => {
            sandbox.updateConfig({ maxExecutionTime: 60000 });
            expect(sandbox.getConfig().maxExecutionTime).toBe(60000);
        });
    });
});

describe('createSecureTool', () => {
    it('should wrap tool with security checks', async () => {
        const guard = new ToolGuard({ deniedTools: ['blocked'] });
        const sandbox = new ToolSandbox();

        const tool: Tool = {
            name: 'test_tool',
            description: 'Test',
            parameters: { type: 'object', properties: {} },
            execute: async () => ({ success: true }),
        };

        const secureTool = createSecureTool(tool, sandbox, guard);

        const result = await secureTool.execute({}, {});
        expect(result).toEqual({ success: true });
    });

    it('should block denied tools', async () => {
        const guard = new ToolGuard({ deniedTools: ['blocked_tool'] });
        const sandbox = new ToolSandbox();

        const tool: Tool = {
            name: 'blocked_tool',
            description: 'Blocked',
            parameters: { type: 'object', properties: {} },
            execute: async () => ({ success: true }),
        };

        const secureTool = createSecureTool(tool, sandbox, guard);

        await expect(secureTool.execute({}, {})).rejects.toThrow('not allowed');
    });

    it('should validate params with schema', async () => {
        const guard = new ToolGuard();
        const sandbox = new ToolSandbox();

        const tool: Tool = {
            name: 'validated_tool',
            description: 'Validated',
            parameters: { type: 'object', properties: {} },
            execute: async (params) => ({ input: params.input }),
            schema: z.object({ input: z.string() }),
        };

        const secureTool = createSecureTool(tool, sandbox, guard);

        // Valid params
        const result = await secureTool.execute({ input: 'test' }, {});
        expect(result.input).toBe('test');

        // Invalid params
        await expect(
            secureTool.execute({ input: 123 }, {})
        ).rejects.toThrow('Validation failed');
    });
});

describe('ToolRegistry with ToolSandbox', () => {
    it('should configure sandbox', () => {
        const sandbox = new ToolSandbox();
        const registry = ToolRegistry.create().withSandbox(sandbox);

        expect(registry.getSandbox()).toBe(sandbox);
    });

    it('should execute tools through sandbox', async () => {
        const sandbox = new ToolSandbox();
        const registry = ToolRegistry.create().withSandbox(sandbox);

        const tool: Tool = {
            name: 'sandboxed_tool',
            description: 'Test',
            parameters: { type: 'object', properties: {} },
            execute: async (params, context) => ({
                hasSandbox: !!context?.sandbox,
            }),
        };

        registry.register(tool);

        const result = await registry.execute('sandboxed_tool', {});
        expect(result.hasSandbox).toBe(true);
    });

    it('should enforce sandbox timeout', async () => {
        const sandbox = new ToolSandbox({ maxExecutionTime: 100 });
        const registry = ToolRegistry.create().withSandbox(sandbox);

        const slowTool: Tool = {
            name: 'slow_tool',
            description: 'Slow',
            parameters: { type: 'object', properties: {} },
            execute: async () => new Promise((r) => setTimeout(r, 5000)),
        };

        registry.register(slowTool);

        await expect(registry.execute('slow_tool', {})).rejects.toThrow(
            'timed out'
        );
    });

    it('should work with both guard and sandbox', async () => {
        const guard = new ToolGuard({ deniedTools: ['blocked'] });
        const sandbox = new ToolSandbox();
        const registry = ToolRegistry.create()
            .withSecurity(guard)
            .withSandbox(sandbox);

        const tool: Tool = {
            name: 'secure_tool',
            description: 'Secure',
            parameters: { type: 'object', properties: {} },
            execute: async (params, context) => ({
                hasSandbox: !!context?.sandbox,
            }),
            schema: z.object({ input: z.string().optional() }),
        };

        registry.register(tool);

        const result = await registry.execute('secure_tool', {});
        expect(result.hasSandbox).toBe(true);
    });
});

