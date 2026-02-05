import { EnvBindings } from './types';

// Base trading configuration (same for all environments)
export const BASE_TRADING_CONFIG = {
	// All supported trading pairs (Orderly format - used throughout the app)
	// TAAPI uses Binance format which is converted via SYMBOL_MAP
	SUPPORTED_SYMBOLS: ['PERP_NEAR_USDC', 'PERP_SOL_USDC', 'PERP_BTC_USDC', 'PERP_ETH_USDC'] as const,

	// Technical Analysis Multipliers
	VWAP_MULTIPLIER: 0.4,
	BBANDS_MULTIPLIER: 1.5,
	RSI_MULTIPLIER: 2.0,
	OBV_DIVERGENCE_MULTIPLIER: 0.8,

	// Technical Analysis Parameters
	VWAP_THRESHOLD: 0.01,
	OBV_WINDOW_SIZE: 12,
	SLOPE_THRESHOLD: 0.0001,

	// Position Thresholds
	POSITION_THRESHOLDS: {
		long: { buy: 2.0, sell: -0.5 },
		short: { buy: -2.0, sell: 0.5 }
	}
} as const;

// Environment-specific configurations
const ENV_CONFIGS: Record<
	'testnet' | 'production',
	{
		ACTIVE_SYMBOLS: readonly string[];
		STOP_LOSS_THRESHOLD: number;
		TAKE_PROFIT_THRESHOLD: number;
	}
> = {
	testnet: {
		ACTIVE_SYMBOLS: ['PERP_BTC_USDC', 'PERP_ETH_USDC'],
		STOP_LOSS_THRESHOLD: -0.02, // -2% stop loss
		TAKE_PROFIT_THRESHOLD: 0.03 // +3% take profit
	},
	production: {
		ACTIVE_SYMBOLS: ['PERP_NEAR_USDC', 'PERP_SOL_USDC', 'PERP_BTC_USDC', 'PERP_ETH_USDC'],
		STOP_LOSS_THRESHOLD: -0.02, // -2% stop loss
		TAKE_PROFIT_THRESHOLD: 0.03 // +3% take profit
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
export const ORDERLY_TO_TAAPI_MAP: Record<string, string> = {
	PERP_NEAR_USDC: 'NEAR/USDT',
	PERP_SOL_USDC: 'SOL/USDT',
	PERP_BTC_USDC: 'BTC/USDT',
	PERP_ETH_USDC: 'ETH/USDT'
};

// Reverse mapping: TAAPI format -> Orderly format
// Used when converting stored data back to Orderly format
export const TAAPI_TO_ORDERLY_MAP: Record<string, string> = {
	'NEAR/USDT': 'PERP_NEAR_USDC',
	'SOL/USDT': 'PERP_SOL_USDC',
	'BTC/USDT': 'PERP_BTC_USDC',
	'ETH/USDT': 'PERP_ETH_USDC'
};

// Taapi API configuration
export const TAAPI_CONFIG = {
	HISTORY_LIMIT: 24 // 2 hours of 5-min candles
} as const;

// HTTP request configuration
export const HTTP_CONFIG = {
	MAX_RETRIES: 3,
	BASE_DELAY: 1000,
	INDICATOR_FETCH_DELAY: 5000
} as const;
