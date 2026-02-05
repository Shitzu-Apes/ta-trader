import { EnvBindings } from './types';

export type TradingSignal = {
	symbol: string;
	timestamp: number;
	type: 'ENTRY' | 'EXIT' | 'HOLD' | 'NO_ACTION' | 'ADJUSTMENT';
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
	intensity?: number; // TA score intensity (0-1)
	availableLeverage?: number; // Available leverage at decision time
	// Score multipliers
	profitScore?: number; // Profit score applied (if any)
	timeDecayScore?: number; // Time decay score applied (if any)
};

const SIGNALS_PREFIX = 'signals:';
const SIGNALS_TTL = 30 * 24 * 60 * 60; // 30 days in seconds

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
 * Get signals for a symbol within a time range
 */
export async function getSignals(
	env: EnvBindings,
	symbol: string,
	options?: {
		from?: number;
		to?: number;
		limit?: number;
		type?: 'ENTRY' | 'EXIT' | 'NO_ACTION';
	}
): Promise<TradingSignal[]> {
	const prefix = `${SIGNALS_PREFIX}${symbol}:`;
	const list = await env.LOGS.list({ prefix });

	let signals: TradingSignal[] = [];

	for (const key of list.keys) {
		const value = await env.LOGS.get(key.name);
		if (value) {
			try {
				const signal: TradingSignal = JSON.parse(value);

				// Apply filters
				if (options?.from && signal.timestamp < options.from) continue;
				if (options?.to && signal.timestamp > options.to) continue;
				if (options?.type && signal.type !== options.type) continue;

				signals.push(signal);
			} catch {
				// Skip invalid entries
			}
		}
	}

	// Sort by timestamp descending
	signals.sort((a, b) => b.timestamp - a.timestamp);

	// Apply limit
	if (options?.limit) {
		signals = signals.slice(0, options.limit);
	}

	return signals;
}

/**
 * Get latest signal for a symbol
 */
export async function getLatestSignal(
	env: EnvBindings,
	symbol: string
): Promise<TradingSignal | null> {
	const signals = await getSignals(env, symbol, { limit: 1 });
	return signals[0] || null;
}
