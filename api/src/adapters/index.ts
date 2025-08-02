import { FixedNumber } from '../FixedNumber';
import { TRADING_CONFIG } from '../config';
import { Position } from '../trading';
import { EnvBindings } from '../types';

import { OrderlyAdapter } from './orderly';
import { PaperTradingAdapter } from './paper';
import { RefFinanceAdapter } from './ref';

/**
 * Exchange types supported by the adapter system
 */
export enum ExchangeType {
	/** Automated Market Maker (like Uniswap, Ref Finance) */
	AMM = 'amm',
	/** Traditional orderbook exchange (like Binance, paper trading) */
	ORDERBOOK = 'orderbook',
	/** Hybrid exchange supporting both AMM and orderbook features */
	HYBRID = 'hybrid'
}

/**
 * Supported adapter implementations
 */
export type AdapterType = 'ref' | 'paper' | 'orderly';

/**
 * Base market information shared by all exchange types
 */
interface BaseMarketInfo {
	/** Base token symbol (e.g., "BTC" in "BTC/USDT") */
	baseToken: string;
	/** Quote token symbol (e.g., "USDT" in "BTC/USDT") */
	quoteToken: string;
	/** Number of decimal places for base token */
	baseDecimals: number;
	/** Number of decimal places for quote token */
	quoteDecimals: number;
	/** Minimum allowed trade size in quote currency */
	minTradeSize: number;
	/** Maximum allowed trade size in quote currency */
	maxTradeSize: number;
	/** Unique identifier for this market */
	marketId: string | number;
}

/**
 * Market information for AMM exchanges
 * Includes pool-specific data like pool ID and fees
 */
interface AmmMarketInfo extends BaseMarketInfo {
	type: ExchangeType.AMM;
	/** Pool identifier on the AMM */
	poolId: string | number;
	/** Pool trading fee as decimal (e.g., 0.003 for 0.3%) */
	poolFee: number;
}

/**
 * Market information for orderbook exchanges
 * Includes tick/step sizes for price and quantity precision
 */
interface OrderbookMarketInfo extends BaseMarketInfo {
	type: ExchangeType.ORDERBOOK;
	/** Minimum price increment */
	tickSize: number;
	/** Minimum quantity increment */
	stepSize: number;
}

/**
 * Market information for hybrid exchanges
 * Combines both AMM and orderbook features
 */
interface HybridMarketInfo extends BaseMarketInfo {
	type: ExchangeType.HYBRID;
	poolId: string | number;
	poolFee: number;
	tickSize: number;
	stepSize: number;
}

export type MarketInfo = AmmMarketInfo | OrderbookMarketInfo | HybridMarketInfo;

/**
 * Orderbook depth representation
 */
export type OrderBookDepth = {
	/** Buy orders sorted by price descending */
	bids: Array<{ price: number; size: number }>;
	/** Sell orders sorted by price ascending */
	asks: Array<{ price: number; size: number }>;
};

/**
 * Liquidity information for AMM exchanges
 */
interface AmmLiquidity {
	type: ExchangeType.AMM;
	poolLiquidity: {
		/** Amount of base token in the pool */
		baseReserve: number;
		/** Amount of quote token in the pool */
		quoteReserve: number;
		/** Total liquidity value */
		totalLiquidity: number;
	};
}

/**
 * Liquidity information for orderbook exchanges
 */
interface OrderbookLiquidity {
	type: ExchangeType.ORDERBOOK;
	orderBook: OrderBookDepth;
}

/**
 * Liquidity information for hybrid exchanges
 */
interface HybridLiquidity {
	type: ExchangeType.HYBRID;
	poolLiquidity: {
		baseReserve: number;
		quoteReserve: number;
		totalLiquidity: number;
	};
	orderBook: OrderBookDepth;
}

export type LiquidityDepth = AmmLiquidity | OrderbookLiquidity | HybridLiquidity;

/**
 * Base trade execution result
 */
interface BaseTradeResult {
	/** Whether the trade was successfully executed */
	success: boolean;
	/** Actual execution price */
	executedPrice: number;
	/** Actual execution size */
	executedSize: number;
	/** Trading fees paid */
	fee: number;
	/** Transaction hash (if applicable) */
	txHash?: string;
}

/**
 * Trade result for AMM exchanges
 * Includes price impact and routing information
 */
interface AmmTradeResult extends BaseTradeResult {
	type: ExchangeType.AMM;
	/** Price impact as decimal (e.g., 0.01 for 1% impact) */
	priceImpact: number;
	/** Route taken through pools for the trade */
	route: Array<{
		poolId: string | number;
		tokenIn: string;
		tokenOut: string;
	}>;
}

/**
 * Trade result for orderbook exchanges
 * Includes order ID for tracking
 */
interface OrderbookTradeResult extends BaseTradeResult {
	type: ExchangeType.ORDERBOOK;
	/** Order identifier for tracking */
	orderId: string;
}

/**
 * Trade result for hybrid exchanges
 * May include both orderbook and AMM specific data
 */
interface HybridTradeResult extends BaseTradeResult {
	type: ExchangeType.HYBRID;
	orderId?: string;
	priceImpact?: number;
	route?: Array<{
		poolId: string | number;
		tokenIn: string;
		tokenOut: string;
	}>;
}

export type TradeResult = AmmTradeResult | OrderbookTradeResult | HybridTradeResult;

/**
 * Order types for trading
 */
export type OrderType = 'market' | 'limit';

/**
 * Base trading options
 */
interface BaseTradeOptions {
	/** Limit price for limit orders */
	price?: number;
	/** Maximum acceptable slippage as decimal */
	slippage?: number;
}

/**
 * Trading options for AMM exchanges
 */
interface AmmTradeOptions extends BaseTradeOptions {
	type: ExchangeType.AMM;
	/** Maximum acceptable price impact */
	maxPriceImpact: number;
	/** Maximum number of pools to route through */
	routeHops?: number;
}

/**
 * Trading options for orderbook exchanges
 */
interface OrderbookTradeOptions extends BaseTradeOptions {
	type: ExchangeType.ORDERBOOK;
	/** Order type (market or limit) */
	orderType: OrderType;
	/** Leverage multiplier for margin trading */
	leverage?: number;
}

/**
 * Trading options for hybrid exchanges
 */
interface HybridTradeOptions extends BaseTradeOptions {
	type: ExchangeType.HYBRID;
	orderType?: OrderType;
	maxPriceImpact?: number;
	routeHops?: number;
}

export type TradeOptions = AmmTradeOptions | OrderbookTradeOptions | HybridTradeOptions;

/**
 * Base fee structure
 */
interface BaseFees {
	type: ExchangeType;
}

/**
 * Fee structure for AMM exchanges
 */
interface AmmFees extends BaseFees {
	type: ExchangeType.AMM;
	/** Pool trading fee */
	poolFee: number;
	/** Routing fee for multi-hop trades */
	routingFee: number;
}

/**
 * Fee structure for orderbook exchanges
 */
interface OrderbookFees extends BaseFees {
	type: ExchangeType.ORDERBOOK;
	/** Fee for providing liquidity (maker) */
	makerFee: number;
	/** Fee for taking liquidity (taker) */
	takerFee: number;
}

/**
 * Fee structure for hybrid exchanges
 */
interface HybridFees extends BaseFees {
	type: ExchangeType.HYBRID;
	makerFee?: number;
	takerFee?: number;
	poolFee?: number;
	routingFee?: number;
}

export type Fees = AmmFees | OrderbookFees | HybridFees;

/**
 * Trading Adapter Interface
 *
 * Provides a unified interface for different trading platforms (AMM, Orderbook, Hybrid).
 * Each adapter implementation should handle the specifics of their exchange type while
 * providing consistent behavior through this interface.
 */
export interface TradingAdapter {
	/**
	 * Get the exchange type this adapter implements
	 * @returns The type of exchange (AMM, ORDERBOOK, or HYBRID)
	 */
	getExchangeType(): ExchangeType;

	/**
	 * Get market information for a trading symbol
	 * @param symbol - Trading symbol (e.g., "BTC/USDT", "NEAR/USDC")
	 * @returns Market configuration including decimals, fees, trade limits, and type-specific info
	 */
	getMarketInfo(symbol: string): Promise<MarketInfo>;

	/**
	 * Get current market price for a symbol
	 * @param symbol - Trading symbol
	 * @param size - Optional size to get price impact-adjusted price
	 * @returns Current price in quote currency
	 */
	getPrice(symbol: string, size?: number): Promise<number>;

	/**
	 * Get market liquidity depth information
	 * @param symbol - Trading symbol
	 * @param depth - Optional depth level for orderbook (ignored for AMM)
	 * @returns Liquidity information (orderbook for ORDERBOOK, pool reserves for AMM)
	 */
	getLiquidityDepth(symbol: string, depth?: number): Promise<LiquidityDepth>;

	/**
	 * Get current account balance in quote currency (usually USDC)
	 * @returns Available balance for trading
	 */
	getBalance(): Promise<number>;

	/**
	 * Get current position for a symbol
	 * @param symbol - Trading symbol
	 * @returns Current position info or null if no position exists
	 */
	getPosition(symbol: string): Promise<Position | null>;

	/**
	 * Open a long position
	 * @param symbol - Trading symbol
	 * @param size - Position size in quote currency (USDC)
	 * @param options - Exchange-specific trading options
	 * @returns Trade execution result with price, size, fees, and exchange-specific data
	 */
	openLongPosition(symbol: string, size: number, options: TradeOptions): Promise<TradeResult>;

	/**
	 * Close a long position
	 * @param symbol - Trading symbol
	 * @param size - Amount to close in base currency units
	 * @param options - Exchange-specific trading options
	 * @returns Trade execution result with price, size, fees, and exchange-specific data
	 */
	closeLongPosition(symbol: string, size: number, options: TradeOptions): Promise<TradeResult>;

	/**
	 * Open a short position (optional - not all adapters support shorts)
	 * @param symbol - Trading symbol
	 * @param size - Position size in quote currency (USDC)
	 * @param options - Exchange-specific trading options including leverage
	 * @returns Trade execution result with price, size, fees, and exchange-specific data
	 */
	openShortPosition?(symbol: string, size: number, options: TradeOptions): Promise<TradeResult>;

	/**
	 * Close a short position (optional - not all adapters support shorts)
	 * @param symbol - Trading symbol
	 * @param size - Amount to close in base currency units
	 * @param options - Exchange-specific trading options
	 * @returns Trade execution result with price, size, fees, and exchange-specific data
	 */
	closeShortPosition?(symbol: string, size: number, options: TradeOptions): Promise<TradeResult>;

	/**
	 * Simulate a trade to get expected execution details without actually executing
	 * Used for strategy calculations and position planning
	 *
	 * @param symbol - Trading symbol
	 * @param size - For opening: size in quote currency (USDC). For closing: size in base currency
	 * @param isLong - Whether this is a long (true) or short (false) position
	 * @param isOpen - Whether opening (true) or closing (false) a position
	 * @param options - Exchange-specific options for the simulation
	 * @returns Expected trade outcome with price, size, fees, and exchange-specific data (routes for AMM, etc.)
	 */
	getExpectedTradeReturn(
		symbol: string,
		size: number,
		isLong: boolean,
		isOpen: boolean,
		options: TradeOptions
	): Promise<
		{
			expectedPrice: number;
			expectedSize: number;
			fee: number;
			minAmountOut?: number;
		} & (
			| {
					type: ExchangeType.AMM;
					priceImpact: number;
					route: Array<{
						poolId: string | number;
						tokenIn: string;
						tokenOut: string;
					}>;
			  }
			| {
					type: ExchangeType.ORDERBOOK;
			  }
			| {
					type: ExchangeType.HYBRID;
					priceImpact?: number;
					route?: Array<{
						poolId: string | number;
						tokenIn: string;
						tokenOut: string;
					}>;
			  }
		)
	>;

	/**
	 * Check if a market is currently active and tradeable
	 * @param symbol - Trading symbol
	 * @returns True if market is active, false otherwise
	 */
	isMarketActive(symbol: string): Promise<boolean>;

	/**
	 * Get list of supported trading symbols (optional)
	 * @returns Array of supported symbol strings
	 */
	getSupportedMarkets?(): Promise<string[]>;

	/**
	 * Get minimum trade size for a symbol (optional)
	 * @param symbol - Trading symbol
	 * @returns Minimum trade size in quote currency
	 */
	getMinimumTradeSize?(symbol: string): Promise<number>;

	/**
	 * Get trading fees structure for a symbol (optional)
	 * @param symbol - Trading symbol
	 * @returns Fee structure specific to exchange type
	 */
	getFees?(symbol: string): Promise<Fees>;
}

// Re-export types that might be needed by adapters
export type { FixedNumber };

/**
 * Factory function to create the appropriate trading adapter
 *
 * @param env - Environment bindings including KV storage and contract IDs
 * @param adapterOverride - Optional adapter type to override config default
 * @returns Configured trading adapter instance
 * @throws Error if adapter type is not supported
 *
 * @example
 * ```typescript
 * // Use default adapter from config
 * const adapter = getAdapter(env);
 *
 * // Override with specific adapter
 * const paperAdapter = getAdapter(env, 'paper');
 * const refAdapter = getAdapter(env, 'ref');
 * ```
 */
export function getAdapter(
	env: EnvBindings,
	adapterOverride?: AdapterType,
	orderlyPrivateKey?: Uint8Array | string
): TradingAdapter {
	const adapterType = adapterOverride ?? TRADING_CONFIG.ADAPTER;
	switch (adapterType) {
		case 'ref':
			return new RefFinanceAdapter(env);
		case 'paper':
			return new PaperTradingAdapter(env);
		case 'orderly':
			if (!orderlyPrivateKey) {
				throw new Error('Orderly adapter requires a private key');
			}
			return new OrderlyAdapter(env, orderlyPrivateKey);
		default:
			throw new Error(`Unknown adapter type: ${adapterType}`);
	}
}
