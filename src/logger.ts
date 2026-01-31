/**
 * Agentic Package - Logger
 *
 * Shared logging infrastructure backed by @fjell/logging for
 * comprehensive sensitive data masking and structured logging.
 */

import Logging from '@fjell/logging';

export const LIBRARY_NAME = 'agentic';

// Get the library-level logger from Fjell
const LibLogger = Logging.getLogger('@riotprompt/agentic');

/**
 * Create a silent logger with the given name
 */
function createSilentLogger(name: string): Logger {
    return {
        name,
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        verbose: () => {},
        silly: () => {},
        get: (...components: string[]) => createSilentLogger(`${name}:${components.join(':')}`),
    };
}

/**
 * Silent logger that discards all output
 * Use this as default to prevent accidental information disclosure
 */
export const SILENT_LOGGER: Logger = createSilentLogger('silent');

/**
 * Check if logging is explicitly enabled via environment variable
 */
const isLoggingEnabled = (): boolean => {
    return process.env.AGENTIC_LOGGING === 'true' ||
           process.env.DEBUG?.includes('agentic') ||
           process.env.NODE_ENV === 'development';
};

export interface Logger {
  name: string;
  debug: (message: string, ...args: any[]) => void;
  info: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
  verbose: (message: string, ...args: any[]) => void;
  silly: (message: string, ...args: any[]) => void;
  /** Get a child logger for a component */
  get?: (...components: string[]) => Logger;
}

/**
 * Create a Logger from a Fjell logger instance
 */
function createLoggerFromFjell(fjellLogger: ReturnType<typeof LibLogger.get>, name: string): Logger {
    return {
        name,
        debug: (message: string, ...args: any[]) => fjellLogger.debug(message, ...args),
        info: (message: string, ...args: any[]) => fjellLogger.info(message, ...args),
        warn: (message: string, ...args: any[]) => fjellLogger.warning(message, ...args),
        error: (message: string, ...args: any[]) => fjellLogger.error(message, ...args),
        verbose: (message: string, ...args: any[]) => fjellLogger.debug(message, ...args),
        silly: (message: string, ...args: any[]) => fjellLogger.debug(message, ...args),
        get: (...components: string[]) => {
            const childLogger = fjellLogger.get(...components);
            return createLoggerFromFjell(childLogger, `${name}:${components.join(':')}`);
        },
    };
}

/**
 * Fjell-backed logger with sensitive data masking
 * 
 * Features:
 * - Automatic sensitive data masking (API keys, passwords, etc.)
 * - Circular reference protection
 * - Hierarchical component logging
 */
const FJELL_LOGGER: Logger = {
    name: 'fjell',
    debug: (message: string, ...args: any[]) => LibLogger.debug(message, ...args),
    info: (message: string, ...args: any[]) => LibLogger.info(message, ...args),
    warn: (message: string, ...args: any[]) => LibLogger.warning(message, ...args),
    error: (message: string, ...args: any[]) => LibLogger.error(message, ...args),
    verbose: (message: string, ...args: any[]) => LibLogger.debug(message, ...args),
    silly: (message: string, ...args: any[]) => LibLogger.debug(message, ...args),
    get: (...components: string[]) => {
        const childLogger = LibLogger.get(...components);
        return createLoggerFromFjell(childLogger, components.join(':'));
    },
};

/**
 * Default logger - silent by default to prevent information disclosure
 * 
 * Enable logging by setting one of:
 * - AGENTIC_LOGGING=true
 * - DEBUG=*agentic*
 * - NODE_ENV=development
 */
export const DEFAULT_LOGGER: Logger = isLoggingEnabled() ? FJELL_LOGGER : SILENT_LOGGER;

export function wrapLogger(toWrap: Logger, name?: string): Logger {
    const requiredMethods: (keyof Logger)[] = [
        'debug',
        'info',
        'warn',
        'error',
        'verbose',
        'silly',
    ];
    const missingMethods = requiredMethods.filter(
        (method) => typeof toWrap[method] !== 'function'
    );

    if (missingMethods.length > 0) {
        throw new Error(
            `Logger is missing required methods: ${missingMethods.join(', ')}`
        );
    }

    const log = (level: keyof Logger, message: string, ...args: any[]) => {
        message = `[${LIBRARY_NAME}] ${name ? `[${name}]` : ''}: ${message}`;

        if (level === 'debug') toWrap.debug(message, ...args);
        else if (level === 'info') toWrap.info(message, ...args);
        else if (level === 'warn') toWrap.warn(message, ...args);
        else if (level === 'error') toWrap.error(message, ...args);
        else if (level === 'verbose') toWrap.verbose(message, ...args);
        else if (level === 'silly') toWrap.silly(message, ...args);
    };

    return {
        name: name || 'wrapped',
        debug: (message: string, ...args: any[]) => log('debug', message, ...args),
        info: (message: string, ...args: any[]) => log('info', message, ...args),
        warn: (message: string, ...args: any[]) => log('warn', message, ...args),
        error: (message: string, ...args: any[]) => log('error', message, ...args),
        verbose: (message: string, ...args: any[]) =>
            log('verbose', message, ...args),
        silly: (message: string, ...args: any[]) => log('silly', message, ...args),
        get: (...components: string[]) => wrapLogger(toWrap, name ? `${name}:${components.join(':')}` : components.join(':')),
    };
}
