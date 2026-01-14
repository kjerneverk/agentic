import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { ToolGuard, ToolGuardEvents } from '../src/tool-guard';
import { ToolRegistry, Tool } from '../src/tools';

describe('ToolGuard', () => {
    let guard: ToolGuard;
    let events: {
        validationFailed: { toolName: string; message: string }[];
        executionBlocked: { toolName: string; reason: string }[];
        prototypePollution: string[];
    };

    beforeEach(() => {
        events = {
            validationFailed: [],
            executionBlocked: [],
            prototypePollution: [],
        };

        const eventHandlers: ToolGuardEvents = {
            onValidationFailed: (toolName, message) =>
                events.validationFailed.push({ toolName, message }),
            onExecutionBlocked: (toolName, reason) =>
                events.executionBlocked.push({ toolName, reason }),
            onPrototypePollution: (toolName) =>
                events.prototypePollution.push(toolName),
        };

        guard = new ToolGuard({}, undefined, eventHandlers);
    });

    describe('validateParams', () => {
        it('should validate params against schema', () => {
            const schema = z.object({
                path: z.string(),
                recursive: z.boolean().optional(),
            });

            const result = guard.validateParams('read_file', { path: '/test' }, schema);
            expect(result.success).toBe(true);
            expect(result.data).toEqual({ path: '/test' });
        });

        it('should reject invalid params', () => {
            const schema = z.object({ path: z.string() });

            const result = guard.validateParams('read_file', { path: 123 }, schema);
            expect(result.success).toBe(false);
            expect(result.error).toBe('Parameter validation failed');
            expect(result.violations).toBeDefined();
            expect(result.violations!.length).toBeGreaterThan(0);
        });

        it('should call onValidationFailed event', () => {
            const schema = z.object({ path: z.string() });

            guard.validateParams('read_file', { path: 123 }, schema);

            expect(events.validationFailed).toHaveLength(1);
            expect(events.validationFailed[0].toolName).toBe('read_file');
        });

        it('should bypass validation when disabled', () => {
            const disabledGuard = new ToolGuard({ validateParams: false });
            const schema = z.object({ path: z.string() });

            const result = disabledGuard.validateParams(
                'read_file',
                { path: 123 },
                schema
            );
            expect(result.success).toBe(true);
            expect(result.data).toEqual({ path: 123 });
        });

        it('should bypass validation when guard is disabled', () => {
            const disabledGuard = new ToolGuard({ enabled: false });
            const schema = z.object({ path: z.string() });

            const result = disabledGuard.validateParams(
                'read_file',
                { path: 123 },
                schema
            );
            expect(result.success).toBe(true);
        });

        it('should handle complex schemas', () => {
            const schema = z.object({
                files: z.array(z.string()),
                options: z.object({
                    recursive: z.boolean(),
                    maxDepth: z.number().optional(),
                }),
            });

            const result = guard.validateParams('process_files', {
                files: ['a.txt', 'b.txt'],
                options: { recursive: true },
            }, schema);

            expect(result.success).toBe(true);
        });
    });

    describe('parseToolArguments', () => {
        it('should parse valid JSON', () => {
            const result = guard.parseToolArguments(
                'test',
                '{"path": "/test", "recursive": true}'
            );

            expect(result.success).toBe(true);
            expect(result.data).toEqual({ path: '/test', recursive: true });
        });

        it('should reject invalid JSON', () => {
            const result = guard.parseToolArguments('test', 'not valid json');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Invalid JSON in tool arguments');
        });

        it('should detect prototype pollution - __proto__', () => {
            const result = guard.parseToolArguments(
                'test',
                '{"__proto__": {"polluted": true}}'
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('malicious content');
            expect(events.prototypePollution).toContain('test');
        });

        it('should detect prototype pollution - constructor', () => {
            const result = guard.parseToolArguments(
                'test',
                '{"constructor": {"prototype": {"polluted": true}}}'
            );

            expect(result.success).toBe(false);
        });

        it('should detect nested prototype pollution', () => {
            const result = guard.parseToolArguments(
                'test',
                '{"a": {"b": {"__proto__": {"polluted": true}}}}'
            );

            expect(result.success).toBe(false);
        });

        it('should reject non-object JSON', () => {
            const result = guard.parseToolArguments('test', '"just a string"');
            expect(result.success).toBe(false);
            expect(result.error).toBe('Tool arguments must be a JSON object');
        });

        it('should reject array JSON', () => {
            const result = guard.parseToolArguments('test', '[1, 2, 3]');
            expect(result.success).toBe(false);
            expect(result.error).toBe('Tool arguments must be a JSON object');
        });

        it('should reject null JSON', () => {
            const result = guard.parseToolArguments('test', 'null');
            expect(result.success).toBe(false);
        });

        it('should bypass checks when disabled', () => {
            const disabledGuard = new ToolGuard({ enabled: false });
            const result = disabledGuard.parseToolArguments(
                'test',
                '{"__proto__": {"polluted": true}}'
            );

            expect(result.success).toBe(true);
        });
    });

    describe('isToolAllowed', () => {
        it('should allow tools not in deny list', () => {
            const guardWithDeny = new ToolGuard({ deniedTools: ['dangerous_tool'] });

            expect(guardWithDeny.isToolAllowed('safe_tool')).toBe(true);
            expect(guardWithDeny.isToolAllowed('dangerous_tool')).toBe(false);
        });

        it('should enforce allow list when specified', () => {
            const guardWithAllow = new ToolGuard({
                allowedTools: ['read_file', 'write_file'],
            });

            expect(guardWithAllow.isToolAllowed('read_file')).toBe(true);
            expect(guardWithAllow.isToolAllowed('delete_file')).toBe(false);
        });

        it('should call onExecutionBlocked for denied tools', () => {
            guard = new ToolGuard(
                { deniedTools: ['blocked_tool'] },
                undefined,
                {
                    onExecutionBlocked: (toolName, reason) =>
                        events.executionBlocked.push({ toolName, reason }),
                }
            );

            guard.isToolAllowed('blocked_tool');

            expect(events.executionBlocked).toHaveLength(1);
            expect(events.executionBlocked[0].toolName).toBe('blocked_tool');
        });

        it('should allow all tools when disabled', () => {
            const disabledGuard = new ToolGuard({ enabled: false, deniedTools: ['blocked'] });

            expect(disabledGuard.isToolAllowed('blocked')).toBe(true);
        });
    });

    describe('configuration', () => {
        it('should return config copy', () => {
            const config = guard.getConfig();
            expect(config.enabled).toBe(true);
            expect(config.validateParams).toBe(true);
        });

        it('should update config', () => {
            guard.updateConfig({ maxExecutionTime: 60000 });
            expect(guard.getConfig().maxExecutionTime).toBe(60000);
        });

        it('should add tool to deny list', () => {
            guard.denyTool('new_blocked_tool');
            expect(guard.isToolAllowed('new_blocked_tool')).toBe(false);
        });

        it('should remove tool from deny list', () => {
            guard = new ToolGuard({ deniedTools: ['blocked'] });
            guard.allowTool('blocked');
            expect(guard.isToolAllowed('blocked')).toBe(true);
        });

        it('should check enabled status', () => {
            expect(guard.isEnabled()).toBe(true);
            guard.setEnabled(false);
            expect(guard.isEnabled()).toBe(false);
        });
    });
});

describe('ToolRegistry with ToolGuard', () => {
    let registry: ToolRegistry;
    let guard: ToolGuard;

    const createTestTool = (name: string, schema?: z.ZodSchema<any>): Tool => ({
        name,
        description: `Test tool ${name}`,
        parameters: {
            type: 'object',
            properties: {
                input: { type: 'string', description: 'Input value' },
            },
        },
        execute: async (params) => ({ result: params.input }),
        schema,
    });

    beforeEach(() => {
        guard = new ToolGuard({ deniedTools: ['blocked_tool'] });
        registry = ToolRegistry.create().withSecurity(guard);
    });

    it('should configure security guard', () => {
        expect(registry.getSecurityGuard()).toBe(guard);
    });

    it('should block denied tools', async () => {
        registry.register(createTestTool('blocked_tool'));

        await expect(
            registry.execute('blocked_tool', { input: 'test' })
        ).rejects.toThrow('Tool "blocked_tool" is not allowed');
    });

    it('should allow non-denied tools', async () => {
        registry.register(createTestTool('allowed_tool'));

        const result = await registry.execute('allowed_tool', { input: 'test' });
        expect(result).toEqual({ result: 'test' });
    });

    it('should validate params with schema', async () => {
        const schema = z.object({ input: z.string() });
        registry.register(createTestTool('validated_tool', schema));

        // Valid params
        const result = await registry.execute('validated_tool', { input: 'test' });
        expect(result).toEqual({ result: 'test' });

        // Invalid params
        await expect(
            registry.execute('validated_tool', { input: 123 })
        ).rejects.toThrow('Parameter validation failed');
    });

    it('should work without guard', async () => {
        const noGuardRegistry = ToolRegistry.create();
        noGuardRegistry.register(createTestTool('test_tool'));

        const result = await noGuardRegistry.execute('test_tool', { input: 'test' });
        expect(result).toEqual({ result: 'test' });
    });

    describe('executeFromJSON', () => {
        it('should parse and execute from JSON', async () => {
            registry.register(createTestTool('json_tool'));

            const result = await registry.executeFromJSON(
                'json_tool',
                '{"input": "test"}'
            );
            expect(result).toEqual({ result: 'test' });
        });

        it('should reject malicious JSON', async () => {
            registry.register(createTestTool('json_tool'));

            await expect(
                registry.executeFromJSON(
                    'json_tool',
                    '{"__proto__": {"polluted": true}}'
                )
            ).rejects.toThrow('malicious content');
        });

        it('should reject invalid JSON', async () => {
            registry.register(createTestTool('json_tool'));

            await expect(
                registry.executeFromJSON('json_tool', 'not json')
            ).rejects.toThrow('Invalid JSON');
        });

        it('should work without guard', async () => {
            const noGuardRegistry = ToolRegistry.create();
            noGuardRegistry.register(createTestTool('json_tool'));

            const result = await noGuardRegistry.executeFromJSON(
                'json_tool',
                '{"input": "test"}'
            );
            expect(result).toEqual({ result: 'test' });
        });
    });
});

