import { FixedNumber } from '../FixedNumber';
import { TRADING_CONFIG } from '../config';
import { Position } from '../trading';
import { EnvBindings } from '../types';

import { PaperTradingAdapter } from './paper';
import { RefFinanceAdapter } from './ref';

export enum ExchangeType {
	AMM = 'amm',
	ORDERBOOK = 'orderbook',
	HYBRID = 'hybrid'
}

// Supported adapter types
export type AdapterType = 'ref' | 'paper';

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

// Re-export types that might be needed by adapters
export type { FixedNumber };

export function getAdapter(env: EnvBindings, adapterOverride?: AdapterType): TradingAdapter {
	const adapterType = adapterOverride ?? TRADING_CONFIG.ADAPTER;
	switch (adapterType) {
		case 'ref':
			return new RefFinanceAdapter(env);
		case 'paper':
			return new PaperTradingAdapter(env);
		default:
			throw new Error(`Unknown adapter type: ${adapterType}`);
	}
}
