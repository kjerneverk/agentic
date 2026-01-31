# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

## Security Features

The agentic package includes security features for tool execution:

### Tool Validation (ToolGuard)

```typescript
import { ToolGuard } from '@riotprompt/agentic';
import { z } from 'zod';

const guard = new ToolGuard({
  enabled: true,
  validateParams: true,
  detectPrototypePollution: true,
});

// Register tool schemas
guard.registerSchema('read_file', z.object({
  path: z.string().max(1000),
  encoding: z.enum(['utf8', 'base64']).optional(),
}));

// Validate before execution
const result = guard.validate('read_file', params);
if (!result.valid) {
  // Handle validation failure
}
```

### Tool Sandboxing (ToolSandbox)

```typescript
import { ToolSandbox } from '@riotprompt/agentic';

const sandbox = new ToolSandbox({
  enabled: true,
  maxExecutionTime: 30000,
  maxConcurrent: 5,
  maxOutputSize: 1024 * 1024, // 1MB
});

// Execute with sandboxing
const result = await sandbox.execute(
  'my_tool',
  async (signal) => {
    // Tool implementation
    // Check signal.aborted for cancellation
  }
);
```

### Security Features

- **Parameter Validation**: Zod schema validation for all tool parameters
- **Prototype Pollution Prevention**: Blocks `__proto__`, `constructor`, `prototype`
- **Execution Timeouts**: Configurable timeouts for tool execution
- **Concurrency Limits**: Limit concurrent tool executions
- **Output Size Limits**: Prevent memory exhaustion from large outputs
- **Allow/Deny Lists**: Control which tools can be executed
- **Silent Logging**: Library logging disabled by default

## Environment Variables

```bash
# Enable agentic logging
AGENTIC_LOGGING=true

# Or use DEBUG pattern
DEBUG=*agentic*
```

## Security Checklist

- [ ] Define Zod schemas for all tool parameters
- [ ] Enable prototype pollution detection
- [ ] Set appropriate execution timeouts
- [ ] Configure concurrency limits
- [ ] Use allow/deny lists for tools in production
- [ ] Monitor tool execution metrics

