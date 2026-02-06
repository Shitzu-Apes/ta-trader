import { EnvBindings } from './types';

// All supported perpetual symbols as a const type
export const PERP_SYMBOLS = {
	NEAR: 'PERP_NEAR_USDC',
	SOL: 'PERP_SOL_USDC',
	BTC: 'PERP_BTC_USDC',
	ETH: 'PERP_ETH_USDC',
	BNB: 'PERP_BNB_USDC'
} as const;

// Derive the type from the const object
export type PerpSymbol = (typeof PERP_SYMBOLS)[keyof typeof PERP_SYMBOLS];

// All supported symbols as an array for iteration
export const ALL_PERP_SYMBOLS: PerpSymbol[] = [
	PERP_SYMBOLS.NEAR,
	PERP_SYMBOLS.SOL,
	PERP_SYMBOLS.BTC,
	PERP_SYMBOLS.ETH,
	PERP_SYMBOLS.BNB
];

// Base trading configuration (same for all environments)
export const BASE_TRADING_CONFIG = {
	// All supported trading pairs (Orderly format - used throughout the app)
	// TAAPI uses Binance format which is converted via SYMBOL_MAP
	SUPPORTED_SYMBOLS: ALL_PERP_SYMBOLS,

	// Technical Analysis Multipliers
	VWAP_MULTIPLIER: 0.2,
	BBANDS_MULTIPLIER: 1.5,
	RSI_MULTIPLIER: 2.0,
	OBV_DIVERGENCE_MULTIPLIER: 0.8,

	// Technical Analysis Parameters
	VWAP_THRESHOLD: 0.01,
	OBV_WINDOW_SIZE: 12,
	SLOPE_THRESHOLD: 0.0001,

	// Position Thresholds
	POSITION_THRESHOLDS: {
		long: { buy: 2, sell: -0.5 },
		short: { buy: -2, sell: 0.5 }
	}
} as const;

// Max order size per symbol (in USD) - for liquidity management
// Lower values for symbols with poorer liquidity
export const MAX_ORDER_SIZE_USD: Record<PerpSymbol, number> = {
	[PERP_SYMBOLS.NEAR]: 500,
	[PERP_SYMBOLS.SOL]: 1000,
	[PERP_SYMBOLS.BTC]: 5000,
	[PERP_SYMBOLS.ETH]: 5000,
	[PERP_SYMBOLS.BNB]: 2000
};

// Max leverage per symbol (how much leverage to use for each symbol)
export const MAX_LEVERAGE_PER_SYMBOL: Record<PerpSymbol, number> = {
	[PERP_SYMBOLS.BTC]: 8,
	[PERP_SYMBOLS.ETH]: 8,
	[PERP_SYMBOLS.SOL]: 6,
	[PERP_SYMBOLS.BNB]: 6,
	[PERP_SYMBOLS.NEAR]: 5
};

// Max total account leverage across all positions
export const MAX_ACCOUNT_LEVERAGE = 12;

// Position sizing configuration
export const POSITION_SIZING_CONFIG = {
	// TA score threshold considered "strong" (for intensity calculation)
	STRONG_SIGNAL_THRESHOLD: 3.0,

	// Minimum order size in USD
	MIN_ORDER_SIZE_USD: 50,

	// Position adjustment threshold
	POSITION_ADJUSTMENT_THRESHOLD_PERCENT: 0.35,

	// Score multipliers
	PROFIT_SCORE_MULTIPLIER: 0.75,
	TIME_DECAY_MULTIPLIER: 0.01 // per minute
} as const;

// Environment-specific configurations
const ENV_CONFIGS: Record<
	'testnet' | 'production',
	{
		ACTIVE_SYMBOLS: readonly PerpSymbol[];
		STOP_LOSS_THRESHOLD: number;
		TAKE_PROFIT_THRESHOLD: number;
	}
> = {
	testnet: {
		ACTIVE_SYMBOLS: [PERP_SYMBOLS.BTC, PERP_SYMBOLS.ETH, PERP_SYMBOLS.BNB],
		STOP_LOSS_THRESHOLD: -0.013,
		TAKE_PROFIT_THRESHOLD: 0.018
	},
	production: {
		ACTIVE_SYMBOLS: ALL_PERP_SYMBOLS,
		STOP_LOSS_THRESHOLD: -0.013,
		TAKE_PROFIT_THRESHOLD: 0.018
	}
};

// Get trading config based on environment
export function getTradingConfig(env: EnvBindings) {
	const envKey = env.ORDERLY_NETWORK === 'mainnet' ? 'production' : 'testnet';
	const envConfig = ENV_CONFIGS[envKey];

	return {
		...BASE_TRADING_CONFIG,
		...envConfig
	};
}

// Backwards compatibility - export base config as TRADING_CONFIG
// This is used by functions that don't have access to env
export const TRADING_CONFIG = BASE_TRADING_CONFIG;

// Symbol mapping: Orderly format -> TAAPI format
// Used only when fetching data from TAAPI (Binance)
export const ORDERLY_TO_TAAPI_MAP: Record<PerpSymbol, string> = {
	[PERP_SYMBOLS.NEAR]: 'NEAR/USDT',
	[PERP_SYMBOLS.SOL]: 'SOL/USDT',
	[PERP_SYMBOLS.BTC]: 'BTC/USDT',
	[PERP_SYMBOLS.ETH]: 'ETH/USDT',
	[PERP_SYMBOLS.BNB]: 'BNB/USDT'
};

// Reverse mapping: TAAPI format -> Orderly format
// Used when converting stored data back to Orderly format
export const TAAPI_TO_ORDERLY_MAP: Record<string, PerpSymbol> = {
	'NEAR/USDT': PERP_SYMBOLS.NEAR,
	'SOL/USDT': PERP_SYMBOLS.SOL,
	'BTC/USDT': PERP_SYMBOLS.BTC,
	'ETH/USDT': PERP_SYMBOLS.ETH,
	'BNB/USDT': PERP_SYMBOLS.BNB
};

// Taapi API configuration
export const TAAPI_CONFIG = {
	HISTORY_LIMIT: 24, // 2 hours of 5-min candles
	// Number of symbols to batch per API call (Pro = 3, Expert = 10 constructs)
	// Adjust based on your TAAPI subscription plan
	BATCH_SIZE: 3
} as const;

// HTTP request configuration
export const HTTP_CONFIG = {
	MAX_RETRIES: 3,
	BASE_DELAY: 1000,
	INDICATOR_FETCH_DELAY: 5000
} as const;
