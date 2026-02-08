import { EnvBindings } from './types';

export type TradingSignal = {
	symbol: string;
	timestamp: number;
	type: 'ENTRY' | 'EXIT' | 'HOLD' | 'NO_ACTION' | 'ADJUSTMENT' | 'STOP_LOSS' | 'TAKE_PROFIT';
	direction?: 'LONG' | 'SHORT';
	action?: 'OPEN' | 'CLOSE' | 'INCREASE' | 'DECREASE';
	reason?:
		| 'TA_SCORE'
		| 'STOP_LOSS'
		| 'TAKE_PROFIT'
		| 'SIGNAL_REVERSAL'
		| 'BELOW_THRESHOLD'
		| 'PROFIT_TAKING'
		| 'TIME_DECAY'
		| 'STRENGTHENED_SIGNAL'
		| 'WEAKENED_SIGNAL';
	taScore: number;
	threshold: number;
	price: number;
	positionSize?: number;
	entryPrice?: number;
	unrealizedPnl?: number;
	realizedPnl?: number;
	indicators?: {
		vwap?: number;
		bbands?: number;
		rsi?: number;
		obv?: number;
		total?: number;
	};
	// Dynamic position sizing fields
	targetSize?: number;
	currentSize?: number;
	initialNotionalSize?: number;
	intensity?: number;
	availableLeverage?: number;
	// Score multipliers
	profitScore?: number;
	timeDecayScore?: number;
	// Consensus check info
	consensusStatus?: 'long' | 'short' | 'none';
};

export type SignalsResult = {
	signals: TradingSignal[];
	nextCursor?: string;
	totalCount: number;
};

// Keep constants for backwards compatibility
const SIGNALS_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;

/**
 * Convert database row to TradingSignal
 */
function rowToSignal(row: Record<string, unknown>): TradingSignal {
	return {
		symbol: row.symbol as string,
		timestamp: row.timestamp as number,
		type: row.type as TradingSignal['type'],
		direction: row.direction as TradingSignal['direction'],
		action: row.action as TradingSignal['action'],
		reason: row.reason as TradingSignal['reason'],
		taScore: row.ta_score as number,
		threshold: row.threshold as number,
		price: row.price as number,
		positionSize: row.position_size as number | undefined,
		entryPrice: row.entry_price as number | undefined,
		unrealizedPnl: row.unrealized_pnl as number | undefined,
		realizedPnl: row.realized_pnl as number | undefined,
		indicators: row.indicators ? JSON.parse(row.indicators as string) : undefined,
		targetSize: row.target_size as number | undefined,
		currentSize: row.current_size as number | undefined,
		initialNotionalSize: row.initial_notional_size as number | undefined,
		intensity: row.intensity as number | undefined,
		availableLeverage: row.available_leverage as number | undefined,
		profitScore: row.profit_score as number | undefined,
		timeDecayScore: row.time_decay_score as number | undefined,
		consensusStatus: row.consensus_status as TradingSignal['consensusStatus']
	};
}

/**
 * Convert TradingSignal to database row
 * Converts undefined values to null for D1 compatibility
 */
function signalToRow(signal: TradingSignal): Record<string, unknown> {
	return {
		symbol: signal.symbol,
		timestamp: signal.timestamp,
		type: signal.type,
		direction: signal.direction ?? null,
		action: signal.action ?? null,
		reason: signal.reason ?? null,
		ta_score: signal.taScore,
		threshold: signal.threshold,
		price: signal.price,
		position_size: signal.positionSize ?? null,
		entry_price: signal.entryPrice ?? null,
		unrealized_pnl: signal.unrealizedPnl ?? null,
		realized_pnl: signal.realizedPnl ?? null,
		indicators: signal.indicators ? JSON.stringify(signal.indicators) : null,
		target_size: signal.targetSize ?? null,
		current_size: signal.currentSize ?? null,
		initial_notional_size: signal.initialNotionalSize ?? null,
		intensity: signal.intensity ?? null,
		available_leverage: signal.availableLeverage ?? null,
		profit_score: signal.profitScore ?? null,
		time_decay_score: signal.timeDecayScore ?? null,
		consensus_status: signal.consensusStatus ?? null
	};
}

/**
 * Store a trading signal in D1
 */
export async function storeSignal(env: EnvBindings, signal: TradingSignal): Promise<void> {
	const row = signalToRow(signal);

	const columns = Object.keys(row).join(', ');
	const placeholders = Object.keys(row)
		.map(() => '?')
		.join(', ');
	const values = Object.values(row);

	await env.DB.prepare(`INSERT INTO signals (${columns}) VALUES (${placeholders})`)
		.bind(...values)
		.run();
}

/**
 * Get signals for a symbol with optional filtering and pagination
 * Uses D1 for efficient querying with proper LIMIT support
 */
export async function getSignals(
	env: EnvBindings,
	symbol: string,
	options?: {
		from?: number;
		to?: number;
		type?: 'ENTRY' | 'EXIT' | 'NO_ACTION' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'ADJUSTMENT' | 'HOLD';
		cursor?: string;
		limit?: number;
	}
): Promise<SignalsResult> {
	const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, options?.limit ?? DEFAULT_PAGE_LIMIT));

	// Build query dynamically
	const conditions: string[] = ['symbol = ?'];
	const params: (string | number)[] = [symbol];

	if (options?.type) {
		conditions.push('type = ?');
		params.push(options.type);
	}

	if (options?.from) {
		conditions.push('timestamp >= ?');
		params.push(options.from);
	}

	if (options?.to) {
		conditions.push('timestamp <= ?');
		params.push(options.to);
	}

	// Handle cursor-based pagination (timestamp-based)
	if (options?.cursor) {
		const cursorTimestamp = parseInt(options.cursor, 10);
		if (!isNaN(cursorTimestamp)) {
			conditions.push('timestamp < ?');
			params.push(cursorTimestamp);
		}
	}

	const whereClause = conditions.join(' AND ');

	// Get total count for pagination info
	const countResult = await env.DB.prepare(
		`SELECT COUNT(*) as count FROM signals WHERE ${whereClause}`
	)
		.bind(...params)
		.first<{ count: number }>();
	const totalCount = countResult?.count ?? 0;

	// Get signals with LIMIT - properly bounded query
	const query = `SELECT * FROM signals WHERE ${whereClause} ORDER BY timestamp DESC LIMIT ?`;
	params.push(limit + 1); // Fetch one extra to determine if there's a next page

	const results = await env.DB.prepare(query)
		.bind(...params)
		.all<Record<string, unknown>>();
	const rows = results.results || [];

	// Check if there's a next page
	let nextCursor: string | undefined;
	if (rows.length > limit) {
		const lastRow = rows[limit]; // The extra row
		nextCursor = String(lastRow.timestamp);
		rows.pop(); // Remove the extra row
	}

	const signals = rows.map(rowToSignal);

	return {
		signals,
		nextCursor,
		totalCount
	};
}

/**
 * Get latest signal for a symbol
 * Optimized single-row query
 */
export async function getLatestSignal(
	env: EnvBindings,
	symbol: string
): Promise<TradingSignal | null> {
	const result = await env.DB.prepare(
		'SELECT * FROM signals WHERE symbol = ? ORDER BY timestamp DESC LIMIT 1'
	)
		.bind(symbol)
		.first<Record<string, unknown>>();

	return result ? rowToSignal(result) : null;
}

/**
 * Check if the last N signals have consecutively exceeded the entry threshold in the same direction
 * @returns Object with hasConsecutive flag and count of consecutive signals
 */
export function checkConsecutiveSignals(
	signals: TradingSignal[],
	threshold: number,
	requiredConsecutive: number,
	direction: 'LONG' | 'SHORT'
): { hasConsecutive: boolean; consecutiveCount: number } {
	if (signals.length < requiredConsecutive) {
		return { hasConsecutive: false, consecutiveCount: signals.length };
	}

	// Take only the most recent signals
	const recentSignals = signals.slice(0, requiredConsecutive);

	// Check if all signals exceed threshold in the correct direction
	let consecutiveCount = 0;
	for (const signal of recentSignals) {
		if (direction === 'LONG') {
			if (signal.taScore > threshold) {
				consecutiveCount++;
			} else {
				break;
			}
		} else {
			// SHORT direction
			if (signal.taScore < threshold) {
				consecutiveCount++;
			} else {
				break;
			}
		}
	}

	return {
		hasConsecutive: consecutiveCount >= requiredConsecutive,
		consecutiveCount
	};
}

/**
 * Clean up old signals beyond TTL
 * Should be called periodically to prevent unbounded growth
 */
export async function cleanupOldSignals(env: EnvBindings): Promise<number> {
	const cutoffTime = Date.now() - SIGNALS_TTL;
	const result = await env.DB.prepare('DELETE FROM signals WHERE timestamp < ?')
		.bind(cutoffTime)
		.run();
	return result.meta?.changes ?? 0;
}
