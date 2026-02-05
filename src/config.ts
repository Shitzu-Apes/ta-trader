import { AdapterType } from './adapters';

// Trading configuration
export const TRADING_CONFIG = {
	// Adapter configuration
	ADAPTER: 'paper' as AdapterType, // 'ref' for RefFinanceAdapter, 'paper' for PaperTradingAdapter

	// All supported trading pairs (for data collection)
	SUPPORTED_SYMBOLS: ['NEAR/USDT', 'SOL/USDT', 'BTC/USDT', 'ETH/USDT'] as const,

	// Active trading pairs (subset of SUPPORTED_SYMBOLS that we want to trade)
	ACTIVE_SYMBOLS: ['NEAR/USDT'] as const,

	// Position thresholds
	STOP_LOSS_THRESHOLD: -0.02, // -2% stop loss
	TAKE_PROFIT_THRESHOLD: 0.03, // +3% take profit
	INITIAL_BALANCE: 1000, // Starting USDC balance

	// Technical Analysis Multipliers
	VWAP_MULTIPLIER: 0.4, // Base VWAP signal weight
	VWAP_EXTRA_MULTIPLIER: 0.6, // Additional VWAP signal weight
	BBANDS_MULTIPLIER: 1.5, // Bollinger Bands weight
	RSI_MULTIPLIER: 2.0, // RSI weight
	OBV_DIVERGENCE_MULTIPLIER: 0.8, // OBV divergence weight
	PROFIT_SCORE_MULTIPLIER: 0.75, // Profit-taking weight
	TIME_DECAY_MULTIPLIER: 0.01, // Time decay weight per minute (100x higher)

	// Technical Analysis Parameters
	VWAP_THRESHOLD: 0.01, // 1% threshold for VWAP signals
	OBV_WINDOW_SIZE: 12, // 1 hour window for OBV analysis
	SLOPE_THRESHOLD: 0.0001, // Minimum slope for divergence detection

	// Partial Position Thresholds
	PARTIAL_POSITION_THRESHOLDS: [
		{
			long: { buy: 2.0, sell: -0.5 }, // First long: Base threshold
			short: { buy: -2.0, sell: 0.5 } // First short: Mirror of long
		}
	]
} as const;

// Taapi API configuration
export const TAAPI_CONFIG = {
	HISTORY_LIMIT: 24 // 2 hours of 5-min candles (enough for OBV window and some buffer)
} as const;

// HTTP request configuration
export const HTTP_CONFIG = {
	MAX_RETRIES: 3,
	BASE_DELAY: 1000, // Base delay for retry backoff in ms
	INDICATOR_FETCH_DELAY: 5000 // Delay between fetching indicators and analysis
} as const;

// Paper trading configuration
export const PAPER_CONFIG = {
	INITIAL_BALANCE: 1000, // Initial USDC balance
	DEFAULT_FEE: 0.003, // 0.3% fee to simulate real trading costs
	SPREAD: 0.001, // 0.1% spread for simulated orderbook
	MIN_TRADE_SIZE: 0.1,
	MAX_TRADE_SIZE: 100000,
	BASE_DECIMALS: 18, // Most tokens use 18 decimals
	QUOTE_DECIMALS: 6, // USDC/USDT use 6 decimals

	// Perpetual futures specific
	MAX_LEVERAGE: 10,
	FUNDING_RATE: 0.0001, // 0.01% hourly funding rate
	LIQUIDATION_THRESHOLD: 0.1, // 10% margin ratio for liquidation
	MAINTENANCE_MARGIN: 0.05, // 5% maintenance margin requirement
	INITIAL_MARGIN: 0.1, // 10% initial margin requirement
	INFINITE_LIQUIDITY_SIZE: 1000000 // Size for simulated infinite liquidity
} as const;

// Ref Finance configuration
export const REF_CONFIG = {
	SYMBOLS: {
		'NEAR/USDT': {
			base: 'wrap.near',
			quote: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
			poolId: 5515
		}
	} as const,
	TOKENS: {
		'wrap.near': {
			decimals: 24
		},
		'17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1': {
			decimals: 6
		}
	} as const,
	DEFAULT_SLIPPAGE: 0.005, // 0.5%
	DEFAULT_MAX_PRICE_IMPACT: 0.05, // 5%
	DEFAULT_ROUTE_HOPS: 3,
	MIN_TRADE_SIZE: 0.1,
	MAX_TRADE_SIZE: 100000
} as const;
