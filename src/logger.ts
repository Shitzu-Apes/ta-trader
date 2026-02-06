import { EnvBindings } from './types';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogContext {
	symbol?: string;
	operation?: string;
	requestId?: string;
	[indicator: string]: unknown;
}

export interface LogEntry {
	timestamp: string;
	level: LogLevel;
	message: string;
	context?: LogContext;
	data?: Record<string, unknown>;
	error?: {
		message: string;
		stack?: string;
		code?: string;
	};
}

class Logger {
	private env?: EnvBindings;
	private requestId: string;
	private logs: LogEntry[] = [];
	private readonly maxBatchSize = 20;
	private readonly flushIntervalMs = 5000;
	private flushTimer?: number;

	constructor(requestId?: string) {
		this.requestId = requestId || this.generateRequestId();
	}

	setEnv(env: EnvBindings) {
		this.env = env;
	}

	private generateRequestId(): string {
		return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	}

	private createEntry(
		level: LogLevel,
		message: string,
		context?: LogContext,
		data?: Record<string, unknown>,
		error?: Error
	): LogEntry {
		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			level,
			message,
			context: {
				...context,
				requestId: this.requestId
			},
			data
		};

		if (error) {
			entry.error = {
				message: error.message,
				stack: error.stack,
				code: (error as { code?: string }).code
			};
		}

		return entry;
	}

	private async flush(): Promise<void> {
		if (this.logs.length === 0) return;

		const logsToFlush = [...this.logs];
		this.logs = [];

		// Always log to console for Cloudflare Workers visibility
		logsToFlush.forEach((entry) => {
			const prefix = `[${entry.timestamp}] [${entry.level}] [${entry.context?.requestId}]`;
			const symbol = entry.context?.symbol ? `[${entry.context.symbol}]` : '';
			const operation = entry.context?.operation ? `[${entry.context.operation}]` : '';

			const logMessage = `${prefix}${symbol}${operation} ${entry.message}`;

			switch (entry.level) {
				case 'ERROR':
					console.error(logMessage, {
						data: entry.data,
						error: entry.error
					});
					break;
				case 'WARN':
					console.warn(logMessage, { data: entry.data });
					break;
				case 'DEBUG':
					console.debug(logMessage, { data: entry.data });
					break;
				default:
					console.log(logMessage, { data: entry.data });
					break;
			}
		});

		// Store logs in D1
		if (this.env) {
			try {
				await this.writeLogsToD1(logsToFlush);
				// Rotate logs: delete entries older than 24 hours
				await this.rotateLogs();
			} catch (e) {
				console.error('[LOGGER] Failed to store logs in D1:', e);
				console.error('[LOGGER] Error details:', JSON.stringify(e));
			}
		} else {
			console.error('[LOGGER] No env available, cannot write to D1');
		}
	}

	private async writeLogsToD1(logsToFlush: LogEntry[]): Promise<void> {
		if (!this.env || logsToFlush.length === 0) return;

		console.log(`[LOGGER] Writing ${logsToFlush.length} logs to D1`);
		let insertedCount = 0;

		// Use individual INSERT statements to avoid SQL variable limits
		for (const entry of logsToFlush) {
			const sql = `
				INSERT INTO logs (timestamp, request_id, level, message, symbol, operation, data, error)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`;

			await this.env.DB.prepare(sql)
				.bind(
					Date.parse(entry.timestamp),
					entry.context?.requestId || this.requestId,
					entry.level,
					entry.message,
					entry.context?.symbol || null,
					entry.context?.operation || null,
					entry.data ? JSON.stringify(entry.data) : null,
					entry.error ? JSON.stringify(entry.error) : null
				)
				.run();
			insertedCount++;
		}

		console.log(`[LOGGER] Successfully wrote ${insertedCount} logs to D1`);
	}

	private async rotateLogs(): Promise<void> {
		if (!this.env) return;

		const cutoffTime = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago

		try {
			const result = await this.env.DB.prepare('DELETE FROM logs WHERE timestamp < ?')
				.bind(cutoffTime)
				.run();

			if (result.meta?.changes && result.meta.changes > 0) {
				console.log(`[LOGGER] Rotated ${result.meta.changes} old log entries`);
			}
		} catch (e) {
			console.error('[LOGGER] Failed to rotate logs:', e);
		}
	}

	private scheduleFlush(): void {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
		}
		this.flushTimer = setTimeout(() => this.flush(), this.flushIntervalMs) as unknown as number;
	}

	private addLog(entry: LogEntry): void {
		this.logs.push(entry);

		if (this.logs.length >= this.maxBatchSize) {
			this.flush();
		} else {
			this.scheduleFlush();
		}
	}

	debug(message: string, context?: LogContext, data?: Record<string, unknown>): void {
		this.addLog(this.createEntry('DEBUG', message, context, data));
	}

	info(message: string, context?: LogContext, data?: Record<string, unknown>): void {
		this.addLog(this.createEntry('INFO', message, context, data));
	}

	warn(message: string, context?: LogContext, data?: Record<string, unknown>): void {
		this.addLog(this.createEntry('WARN', message, context, data));
	}

	error(
		message: string,
		error?: Error,
		context?: LogContext,
		data?: Record<string, unknown>
	): void {
		this.addLog(this.createEntry('ERROR', message, context, data, error));
	}

	async flushNow(): Promise<void> {
		await this.flush();
	}

	getRequestId(): string {
		return this.requestId;
	}
}

// Global logger instance
let globalLogger: Logger | null = null;

export function getLogger(env?: EnvBindings, requestId?: string): Logger {
	if (!globalLogger || requestId) {
		globalLogger = new Logger(requestId);
	}
	if (env) {
		globalLogger.setEnv(env);
	}
	return globalLogger;
}

export function resetLogger(): void {
	globalLogger = null;
}

// Helper to create operation context
export function createContext(
	symbol?: string,
	operation?: string,
	extra?: Record<string, unknown>
): LogContext {
	return {
		symbol,
		operation,
		...extra
	};
}

// Performance tracking helper
export async function withTiming<T>(
	logger: Logger,
	operation: string,
	fn: () => Promise<T>,
	context?: LogContext
): Promise<T> {
	const start = Date.now();
	const ctx = { ...context, operation };

	try {
		logger.info(`Starting ${operation}`, ctx);
		const result = await fn();
		const duration = Date.now() - start;
		logger.info(`Completed ${operation}`, ctx, { durationMs: duration });
		return result;
	} catch (error) {
		const duration = Date.now() - start;
		logger.error(`Failed ${operation}`, error as Error, ctx, { durationMs: duration });
		throw error;
	}
}

export { Logger };
export default Logger;
