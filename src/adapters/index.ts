import { getOrderlyBaseUrl } from '../orderly/auth';
import { Position } from '../trading';
import { EnvBindings } from '../types';

import { OrderlyAdapter } from './orderly';

export enum ExchangeType {
	AMM = 'amm',
	ORDERBOOK = 'orderbook',
	HYBRID = 'hybrid'
}

// Base market info shared by all types
interface BaseMarketInfo {
	baseToken: string;
	quoteToken: string;
	baseDecimals: number;
	quoteDecimals: number;
	minTradeSize: number;
	maxTradeSize: number;
	marketId: string | number;
}

interface AmmMarketInfo extends BaseMarketInfo {
	type: ExchangeType.AMM;
	poolId: string | number;
	poolFee: number;
}

interface OrderbookMarketInfo extends BaseMarketInfo {
	type: ExchangeType.ORDERBOOK;
	tickSize: number;
	stepSize: number;
}

interface HybridMarketInfo extends BaseMarketInfo {
	type: ExchangeType.HYBRID;
	poolId: string | number;
	poolFee: number;
	tickSize: number;
	stepSize: number;
}

export type MarketInfo = AmmMarketInfo | OrderbookMarketInfo | HybridMarketInfo;

export type OrderBookDepth = {
	bids: Array<{ price: number; size: number }>;
	asks: Array<{ price: number; size: number }>;
};

interface AmmLiquidity {
	type: ExchangeType.AMM;
	poolLiquidity: {
		baseReserve: number;
		quoteReserve: number;
		totalLiquidity: number;
	};
}

interface OrderbookLiquidity {
	type: ExchangeType.ORDERBOOK;
	orderBook: OrderBookDepth;
}

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

interface BaseTradeResult {
	success: boolean;
	executedPrice: number;
	executedSize: number;
	fee: number;
	txHash?: string;
}

interface AmmTradeResult extends BaseTradeResult {
	type: ExchangeType.AMM;
	priceImpact: number;
	route: Array<{
		poolId: string | number;
		tokenIn: string;
		tokenOut: string;
	}>;
}

interface OrderbookTradeResult extends BaseTradeResult {
	type: ExchangeType.ORDERBOOK;
	orderId: string;
}

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

export type OrderType = 'market' | 'limit';

interface BaseTradeOptions {
	price?: number;
	slippage?: number;
}

interface AmmTradeOptions extends BaseTradeOptions {
	type: ExchangeType.AMM;
	maxPriceImpact: number;
	routeHops?: number;
}

interface OrderbookTradeOptions extends BaseTradeOptions {
	type: ExchangeType.ORDERBOOK;
	orderType: OrderType;
	leverage?: number; // Optional leverage for perpetual futures
}

interface HybridTradeOptions extends BaseTradeOptions {
	type: ExchangeType.HYBRID;
	orderType?: OrderType;
	maxPriceImpact?: number;
	routeHops?: number;
}

export type TradeOptions = AmmTradeOptions | OrderbookTradeOptions | HybridTradeOptions;

interface BaseFees {
	type: ExchangeType;
}

interface AmmFees extends BaseFees {
	type: ExchangeType.AMM;
	poolFee: number;
	routingFee: number;
}

interface OrderbookFees extends BaseFees {
	type: ExchangeType.ORDERBOOK;
	makerFee: number;
	takerFee: number;
}

interface HybridFees extends BaseFees {
	type: ExchangeType.HYBRID;
	makerFee?: number;
	takerFee?: number;
	poolFee?: number;
	routingFee?: number;
}

export type Fees = AmmFees | OrderbookFees | HybridFees;

export interface TradingAdapter {
	// Basic Information
	getExchangeType(): ExchangeType;
	getMarketInfo(symbol: string): Promise<MarketInfo>;

	// Price & Liquidity
	getPrice(symbol: string, size?: number): Promise<number>;
	getLiquidityDepth(symbol: string, depth?: number): Promise<LiquidityDepth>;

	// Balance Management
	getBalance(): Promise<number>;

	// Position Management
	getPosition(symbol: string): Promise<Position | null>;
	getPositions(): Promise<Position[]>;
	getPositionHistory?(
		symbol?: string,
		limit?: number
	): Promise<{
		history: Array<{
			symbol: string;
			side: 'LONG' | 'SHORT';
			size: number;
			entryPrice: number;
			exitPrice: number;
			realizedPnl: number;
			openedAt: number;
			closedAt: number;
		}>;
		total: number;
	}>;

	// Core Trading Operations
	openLongPosition(symbol: string, size: number, options: TradeOptions): Promise<TradeResult>;
	closeLongPosition(symbol: string, size: number, options: TradeOptions): Promise<TradeResult>;

	// Optional short trading operations
	openShortPosition?(symbol: string, size: number, options: TradeOptions): Promise<TradeResult>;
	closeShortPosition?(symbol: string, size: number, options: TradeOptions): Promise<TradeResult>;

	// Simulation/Quote
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

	// Market Status
	isMarketActive(symbol: string): Promise<boolean>;

	// Optional Utility Methods
	getSupportedMarkets?(): Promise<string[]>;
	getMinimumTradeSize?(symbol: string): Promise<number>;
	getFees?(symbol: string): Promise<Fees>;
}

// Symbol step size cache to avoid repeated API calls
const stepSizeCache = new Map<string, number>();
const STEP_SIZE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let lastStepSizeFetch = 0;

/**
 * Round quantity to match the symbol's step size
 * @param quantity - The calculated quantity
 * @param stepSize - The minimum step size for the symbol
 * @returns Rounded quantity as string
 */
export function roundQuantityToStepSize(quantity: number, stepSize: number): string {
	// Calculate the number of decimal places from step size
	const stepSizeStr = stepSize.toString();
	const decimalIndex = stepSizeStr.indexOf('.');
	const decimals = decimalIndex === -1 ? 0 : stepSizeStr.length - decimalIndex - 1;

	// Round to the nearest step size
	const rounded = Math.round(quantity / stepSize) * stepSize;

	// Format with the correct number of decimal places
	return rounded.toFixed(decimals);
}

/**
 * Fetch step sizes for all symbols from Orderly API
 */
export async function fetchStepSizes(env: EnvBindings): Promise<Map<string, number>> {
	const now = Date.now();

	// Return cached values if still valid
	if (stepSizeCache.size > 0 && now - lastStepSizeFetch < STEP_SIZE_CACHE_TTL) {
		return stepSizeCache;
	}

	try {
		const baseUrl = getOrderlyBaseUrl(env.ORDERLY_NETWORK);
		const response = await fetch(`${baseUrl}/v1/public/info`);
		if (!response.ok) {
			throw new Error(`Failed to fetch market info: ${response.status}`);
		}

		const data = (await response.json()) as {
			success: boolean;
			data: { rows: Array<{ symbol: string; base_tick: number }> };
		};

		if (data.success && data.data?.rows) {
			stepSizeCache.clear();
			for (const row of data.data.rows) {
				if (row.symbol && row.base_tick) {
					stepSizeCache.set(row.symbol, row.base_tick);
				}
			}
			lastStepSizeFetch = now;
		}
	} catch (error) {
		// If fetch fails, return existing cache or empty map
		console.error('Failed to fetch step sizes:', error);
	}

	return stepSizeCache;
}

/**
 * Get step size for a specific symbol
 */
export async function getStepSize(env: EnvBindings, symbol: string): Promise<number> {
	const cache = await fetchStepSizes(env);
	return cache.get(symbol) || 0.001; // Default fallback
}

export function getAdapter(env: EnvBindings): TradingAdapter {
	return new OrderlyAdapter(env);
}
