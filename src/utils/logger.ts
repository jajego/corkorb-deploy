/**
 * Logger utility for standardized logging across the application.
 * 
 * In development, logs to console. In production, can be configured to
 * send logs to a logging service or be disabled.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LoggerOptions {
  level?: LogLevel
  prefix?: string
}

const isDevelopment = import.meta.env.DEV

class Logger {
  private prefix: string
  private level: LogLevel

  constructor(options: LoggerOptions = {}) {
    this.prefix = options.prefix || ''
    this.level = options.level || (isDevelopment ? 'debug' : 'error')
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error']
    return levels.indexOf(level) >= levels.indexOf(this.level)
  }

  private formatMessage(_level: LogLevel, message: string): string {
    const prefix = this.prefix ? `[${this.prefix}]` : ''
    return `${prefix} ${message}`
  }

  debug(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('debug')) return
    // Debug logs only in development mode - use console.log for better visibility
    if (isDevelopment) {
      console.log(this.formatMessage('debug', message), ...args)
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('info')) return
    // Info logs only in development mode
    if (isDevelopment) {
      console.info(this.formatMessage('info', message), ...args)
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('warn')) return
    // Warn logs always visible (helps catch issues in production)
    console.warn(this.formatMessage('warn', message), ...args)
  }

  error(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('error')) return
    // Error logs always visible (critical issues)
    console.error(this.formatMessage('error', message), ...args)
  }
}

/**
 * Create a logger with a specific prefix.
 */
export function createLogger(prefix: string, options?: Omit<LoggerOptions, 'prefix'>): Logger {
  return new Logger({ ...options, prefix })
}

/**
 * Default logger (no prefix).
 */
export const logger = new Logger()

