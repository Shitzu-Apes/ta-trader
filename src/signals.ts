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
	targetSize?: number; // Target position size calculated
	currentSize?: number; // Current position size before adjustment
	initialNotionalSize?: number; // Initial notional size when position was opened
	intensity?: number; // TA score intensity (0-1)
	availableLeverage?: number; // Available leverage at decision time
	// Score multipliers
	profitScore?: number; // Profit score applied (if any)
	timeDecayScore?: number; // Time decay score applied (if any)
	// Consensus check info
	consensusStatus?: 'long' | 'short' | 'none'; // Indicates if indicators agreed on direction
};

export type SignalsResult = {
	signals: TradingSignal[];
	nextCursor?: string;
	totalCount: number;
};

const SIGNALS_PREFIX = 'signals:';
const SIGNALS_TTL = 7 * 24 * 60 * 60; // 7 days in seconds (reduced from 30)
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;

/**
 * Store a trading signal in KV
 */
export async function storeSignal(env: EnvBindings, signal: TradingSignal): Promise<void> {
	const key = `${SIGNALS_PREFIX}${signal.symbol}:${signal.timestamp}`;
	await env.LOGS.put(key, JSON.stringify(signal), {
		expirationTtl: SIGNALS_TTL
	});
}

/**
 * Get signals for a symbol with optional filtering and pagination
 * Fetches all values in parallel for better performance
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
	const prefix = `${SIGNALS_PREFIX}${symbol}:`;
	const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, options?.limit ?? DEFAULT_PAGE_LIMIT));

	// List all keys with the prefix
	const list = await env.LOGS.list({ prefix });

	// Fetch all values in parallel (much faster than sequential N+1)
	const signalPromises = list.keys.map(async (key) => {
		const value = await env.LOGS.get(key.name);
		if (!value) return null;

		try {
			const signal: TradingSignal = JSON.parse(value);

			// Apply filters
			if (options?.from && signal.timestamp < options.from) return null;
			if (options?.to && signal.timestamp > options.to) return null;
			if (options?.type && signal.type !== options.type) return null;

			return signal;
		} catch {
			return null;
		}
	});

	const results = await Promise.all(signalPromises);
	let signals = results.filter((s): s is TradingSignal => s !== null);

	// Sort by timestamp descending (newest first)
	signals.sort((a, b) => b.timestamp - a.timestamp);

	const totalCount = signals.length;

	// Apply cursor-based pagination
	if (options?.cursor) {
		const cursorTimestamp = parseInt(options.cursor, 10);
		if (!isNaN(cursorTimestamp)) {
			// Find the index of the first signal after the cursor timestamp
			const cursorIndex = signals.findIndex((s) => s.timestamp <= cursorTimestamp);
			if (cursorIndex >= 0) {
				signals = signals.slice(cursorIndex);
			} else {
				// Cursor timestamp is before all signals, return empty
				signals = [];
			}
		}
	}

	// Apply limit and determine next cursor
	let nextCursor: string | undefined;
	if (signals.length > limit) {
		nextCursor = String(signals[limit].timestamp);
		signals = signals.slice(0, limit);
	}

	return {
		signals,
		nextCursor,
		totalCount
	};
}

/**
 * Get latest signal for a symbol
 * Optimized to avoid full fetch when possible
 */
export async function getLatestSignal(
	env: EnvBindings,
	symbol: string
): Promise<TradingSignal | null> {
	const result = await getSignals(env, symbol, { limit: 1 });
	return result.signals[0] || null;
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
