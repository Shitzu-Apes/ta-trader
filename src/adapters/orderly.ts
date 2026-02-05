import { getLogger, createContext } from '../logger';
import { makeOrderlyRequest } from '../orderly/auth';
import { Position } from '../trading';
import { EnvBindings } from '../types';

import {
	ExchangeType,
	TradingAdapter,
	MarketInfo,
	LiquidityDepth,
	TradeOptions,
	TradeResult,
	getStepSize,
	roundQuantityToStepSize
} from './index';

// Orderly position response type
interface OrderlyPosition {
	symbol: string;
	position_qty: number;
	cost_position: number;
	last_sum_unitary_funding: number;
	pending_long_qty: number;
	pending_short_qty: number;
	settle_price: number;
	average_open_price: number;
	mark_price: number;
	unsettled_pnl: number;
	realized_pnl?: number;
	est_liq_price: number;
	leverage?: string;
	imr?: number;
	mmr?: number;
	pnl_24_h?: number;
	fee_24_h?: number;
	timestamp?: number; // Position open/update timestamp from Orderly
}

// Orderly position history response type (from /v1/position_history)
interface OrderlyPositionHistory {
	position_id: number;
	status: string;
	type: string;
	symbol: string;
	avg_open_price: number;
	avg_close_price: number;
	max_position_qty: number;
	closed_position_qty: number;
	side: 'LONG' | 'SHORT';
	trading_fee: number;
	accumulated_funding_fee: number;
	insurance_fund_fee: number;
	liquidator_fee: number;
	liquidation_id: number | null;
	realized_pnl: number;
	open_timestamp: number;
	close_timestamp: number;
	last_update_timestamp: number;
	leverage: number;
}

interface OrderlyHolding {
	token: string;
	holding: number;
	frozen: number;
	pending_short_qty: number;
	updated_time: number;
}

interface OrderlyFuturesInfo {
	symbol: string;
	index_price: number;
	mark_price: number;
	last_price: number;
	est_funding_rate: number;
	last_funding_rate: number;
	open_interest: number;
	'24h_open': number;
	'24h_high': number;
	'24h_low': number;
	'24h_close': number;
	'24h_volume': number;
	'24h_amount': number;
}

export class OrderlyAdapter implements TradingAdapter {
	private readonly env: EnvBindings;

	constructor(env: EnvBindings) {
		this.env = env;
	}

	getExchangeType(): ExchangeType {
		return ExchangeType.ORDERBOOK;
	}

	async getMarketInfo(symbol: string): Promise<MarketInfo> {
		await makeOrderlyRequest<{ data: OrderlyFuturesInfo }>(
			this.env,
			'GET',
			`/v1/public/futures/${symbol}`
		);

		return {
			type: ExchangeType.ORDERBOOK,
			baseToken: symbol.replace('PERP_', '').split('_')[0],
			quoteToken: 'USDC',
			baseDecimals: 18,
			quoteDecimals: 6,
			minTradeSize: 0.001,
			maxTradeSize: 1000000,
			marketId: symbol,
			tickSize: 0.01,
			stepSize: 0.001
		};
	}

	async getPrice(symbol: string): Promise<number> {
		const info = await makeOrderlyRequest<{ data: OrderlyFuturesInfo }>(
			this.env,
			'GET',
			`/v1/public/futures/${symbol}`
		);
		return info.data.mark_price;
	}

	async getLiquidityDepth(_symbol: string): Promise<LiquidityDepth> {
		// Orderly has deep liquidity, we don't need to simulate
		// Return a placeholder - actual execution uses market orders
		return {
			type: ExchangeType.ORDERBOOK,
			orderBook: {
				bids: [{ price: 0, size: 1000000 }],
				asks: [{ price: 0, size: 1000000 }]
			}
		};
	}

	async getBalance(): Promise<number> {
		// Fetch both holdings and positions to calculate true balance
		const [holdingResponse, positionsResponse] = await Promise.all([
			makeOrderlyRequest<{
				data?: { holding?: OrderlyHolding[] };
				[key: string]: unknown;
			}>(this.env, 'GET', '/v1/client/holding'),
			makeOrderlyRequest<{
				data?: { rows?: OrderlyPosition[] };
				[key: string]: unknown;
			}>(this.env, 'GET', '/v1/positions')
		]);

		if (!holdingResponse.data || !holdingResponse.data.holding) {
			console.error('Unexpected holding response:', JSON.stringify(holdingResponse));
			throw new Error(`Unexpected Orderly API response: ${JSON.stringify(holdingResponse)}`);
		}

		const usdcHolding = holdingResponse.data.holding.find((h) => h.token === 'USDC');
		const holdingBalance = usdcHolding ? usdcHolding.holding : 0;

		// Calculate total unsettled PnL from all positions
		let totalUnsettledPnl = 0;
		let totalRealizedPnl = 0;

		if (positionsResponse.data?.rows) {
			for (const pos of positionsResponse.data.rows) {
				totalUnsettledPnl += pos.unsettled_pnl || 0;
				totalRealizedPnl += pos.realized_pnl || 0;
			}
		}

		// Total balance = holding + unsettled PnL + realized PnL
		// Realized PnL is already reflected in holding after settlement,
		// but we include it here to show the true trading performance
		const totalBalance = holdingBalance + totalUnsettledPnl;

		const logger = getLogger(this.env);
		logger.debug('Balance calculated', {
			holdingBalance,
			totalUnsettledPnl,
			totalRealizedPnl,
			totalBalance
		});

		return totalBalance;
	}

	async getPosition(symbol: string): Promise<Position | null> {
		const logger = getLogger(this.env);
		const ctx = createContext(symbol, 'get_position');

		try {
			const response = await makeOrderlyRequest<{ data: OrderlyPosition }>(
				this.env,
				'GET',
				`/v1/position/${symbol}`
			);

			const orderlyPos = response.data;

			// Check if position is actually open (size != 0)
			// Orderly may return positions that are settled but not yet cleared
			if (Math.abs(orderlyPos.position_qty) < 0.000001) {
				logger.debug('No active position found (zero size)', ctx);
				return null;
			}

			// Calculate unrealized PnL: (Mark Price - Entry Price) * Size * Direction
			// Direction: +1 for LONG, -1 for SHORT
			const direction = orderlyPos.position_qty > 0 ? 1 : -1;
			const priceDiff = orderlyPos.mark_price - orderlyPos.average_open_price;
			const unrealizedPnl = priceDiff * Math.abs(orderlyPos.position_qty) * direction;

			const position: Position = {
				symbol,
				size: Math.abs(orderlyPos.position_qty),
				isLong: orderlyPos.position_qty > 0,
				lastUpdateTime: Date.now(),
				entryPrice: orderlyPos.average_open_price,
				markPrice: orderlyPos.mark_price,
				unrealizedPnl: unrealizedPnl,
				realizedPnl: orderlyPos.realized_pnl || 0,
				openedAt: orderlyPos.timestamp || Date.now() // Use Orderly timestamp if available
			};

			logger.info('Position retrieved', ctx, {
				size: position.size,
				isLong: position.isLong,
				entryPrice: position.entryPrice,
				unrealizedPnl: position.unrealizedPnl
			});

			return position;
		} catch (_error) {
			// Position not found - this is normal, don't log as error
			logger.debug('No position found', ctx);
			return null;
		}
	}

	async getPositions(): Promise<Position[]> {
		const response = await makeOrderlyRequest<{
			data?: { rows?: OrderlyPosition[] };
			[key: string]: unknown;
		}>(this.env, 'GET', '/v1/positions');

		if (!response.data || !response.data.rows) {
			console.error('Unexpected positions response:', JSON.stringify(response));
			return [];
		}

		const positions: Position[] = [];

		for (const orderlyPos of response.data.rows) {
			// Skip settled positions (size is zero or negligible)
			if (Math.abs(orderlyPos.position_qty) < 0.000001) {
				continue;
			}

			// Calculate unrealized PnL: (Mark Price - Entry Price) * Size * Direction
			// Direction: +1 for LONG, -1 for SHORT
			const direction = orderlyPos.position_qty > 0 ? 1 : -1;
			const priceDiff = orderlyPos.mark_price - orderlyPos.average_open_price;
			const unrealizedPnl = priceDiff * Math.abs(orderlyPos.position_qty) * direction;

			positions.push({
				symbol: orderlyPos.symbol,
				size: Math.abs(orderlyPos.position_qty),
				isLong: orderlyPos.position_qty > 0,
				lastUpdateTime: Date.now(),
				entryPrice: orderlyPos.average_open_price,
				markPrice: orderlyPos.mark_price,
				unrealizedPnl: unrealizedPnl,
				realizedPnl: orderlyPos.realized_pnl || 0,
				openedAt: orderlyPos.timestamp || Date.now() // Use Orderly timestamp if available
			});
		}

		return positions;
	}

	async getPositionHistory(
		symbol?: string,
		limit = 50
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
	}> {
		const logger = getLogger(this.env);
		const ctx = createContext(symbol || 'all', 'get_position_history');

		try {
			// Build query params
			const params = new URLSearchParams();
			if (symbol) {
				params.append('symbol', symbol);
			}
			params.append('limit', limit.toString());

			const path = `/v1/position_history?${params.toString()}`;

			const response = await makeOrderlyRequest<{
				success: boolean;
				data?: { rows?: OrderlyPositionHistory[] };
			}>(this.env, 'GET', path);

			if (!response.success || !response.data?.rows) {
				logger.warn('No position history data returned', ctx);
				return { history: [], total: 0 };
			}

			const history = response.data.rows.map((pos) => ({
				symbol: pos.symbol,
				side: pos.side,
				size: pos.closed_position_qty,
				entryPrice: pos.avg_open_price,
				exitPrice: pos.avg_close_price,
				realizedPnl: pos.realized_pnl,
				openedAt: pos.open_timestamp,
				closedAt: pos.close_timestamp
			}));

			logger.info('Position history retrieved', ctx, {
				count: history.length,
				total: response.data.rows.length
			});

			return {
				history,
				total: response.data.rows.length
			};
		} catch (error) {
			logger.error('Failed to get position history', error as Error, ctx);
			throw error;
		}
	}

	async openLongPosition(
		symbol: string,
		size: number,
		options: TradeOptions
	): Promise<TradeResult> {
		const logger = getLogger(this.env);
		const ctx = createContext(symbol, 'open_long_position');

		if (options.type !== ExchangeType.ORDERBOOK) {
			throw new Error('Orderly only supports orderbook trading');
		}

		// size is in USDC, convert to base token quantity
		const price = await this.getPrice(symbol);
		const rawQuantity = size / price;

		// Get step size and round quantity properly
		const stepSize = await getStepSize(this.env, symbol);
		const quantity = roundQuantityToStepSize(rawQuantity, stepSize);

		logger.info('Opening long position', ctx, {
			size,
			price,
			rawQuantity,
			quantity,
			stepSize
		});

		const orderBody = {
			symbol,
			order_type: 'MARKET',
			side: 'BUY',
			order_quantity: quantity
		};

		try {
			const response = await makeOrderlyRequest<{
				data: {
					order_id: number;
					client_order_id?: string;
				};
			}>(this.env, 'POST', '/v1/order', orderBody);

			logger.info('Long position opened successfully', ctx, {
				orderId: response.data.order_id,
				quantity
			});

			return {
				type: ExchangeType.ORDERBOOK,
				success: true,
				executedPrice: price,
				executedSize: parseFloat(quantity),
				fee: 0, // Fees are deducted from balance automatically
				orderId: response.data.order_id.toString()
			};
		} catch (error) {
			logger.error('Failed to open long position', error as Error, ctx, {
				size,
				quantity
			});
			throw error;
		}
	}

	async openShortPosition(
		symbol: string,
		size: number,
		options: TradeOptions
	): Promise<TradeResult> {
		const logger = getLogger(this.env);
		const ctx = createContext(symbol, 'open_short_position');

		if (options.type !== ExchangeType.ORDERBOOK) {
			throw new Error('Orderly only supports orderbook trading');
		}

		// size is in USDC, convert to base token quantity
		const price = await this.getPrice(symbol);
		const rawQuantity = size / price;

		// Get step size and round quantity properly
		const stepSize = await getStepSize(this.env, symbol);
		const quantity = roundQuantityToStepSize(rawQuantity, stepSize);

		logger.info('Opening short position', ctx, {
			size,
			price,
			rawQuantity,
			quantity,
			stepSize
		});

		const orderBody = {
			symbol,
			order_type: 'MARKET',
			side: 'SELL',
			order_quantity: quantity
		};

		try {
			const response = await makeOrderlyRequest<{
				data: {
					order_id: number;
					client_order_id?: string;
				};
			}>(this.env, 'POST', '/v1/order', orderBody);

			logger.info('Short position opened successfully', ctx, {
				orderId: response.data.order_id,
				quantity
			});

			return {
				type: ExchangeType.ORDERBOOK,
				success: true,
				executedPrice: price,
				executedSize: parseFloat(quantity),
				fee: 0,
				orderId: response.data.order_id.toString()
			};
		} catch (error) {
			logger.error('Failed to open short position', error as Error, ctx, {
				size,
				quantity
			});
			throw error;
		}
	}

	async closeLongPosition(
		symbol: string,
		size: number,
		options: TradeOptions
	): Promise<TradeResult> {
		const logger = getLogger(this.env);
		const ctx = createContext(symbol, 'close_long_position');

		if (options.type !== ExchangeType.ORDERBOOK) {
			throw new Error('Orderly only supports orderbook trading');
		}

		const price = await this.getPrice(symbol);

		// Get step size and round quantity properly
		const stepSize = await getStepSize(this.env, symbol);
		const quantity = roundQuantityToStepSize(size, stepSize);

		logger.info('Closing long position', ctx, {
			size,
			price,
			quantity,
			stepSize
		});

		const orderBody = {
			symbol,
			order_type: 'MARKET',
			side: 'SELL',
			order_quantity: quantity
		};

		try {
			const response = await makeOrderlyRequest<{
				data: {
					order_id: number;
					client_order_id?: string;
				};
			}>(this.env, 'POST', '/v1/order', orderBody);

			logger.info('Long position closed successfully', ctx, {
				orderId: response.data.order_id,
				quantity
			});

			return {
				type: ExchangeType.ORDERBOOK,
				success: true,
				executedPrice: price,
				executedSize: parseFloat(quantity),
				fee: 0,
				orderId: response.data.order_id.toString()
			};
		} catch (error) {
			logger.error('Failed to close long position', error as Error, ctx, {
				size,
				quantity
			});
			throw error;
		}
	}

	async closeShortPosition(
		symbol: string,
		size: number,
		options: TradeOptions
	): Promise<TradeResult> {
		const logger = getLogger(this.env);
		const ctx = createContext(symbol, 'close_short_position');

		if (options.type !== ExchangeType.ORDERBOOK) {
			throw new Error('Orderly only supports orderbook trading');
		}

		const price = await this.getPrice(symbol);

		// Get step size and round quantity properly
		const stepSize = await getStepSize(this.env, symbol);
		const quantity = roundQuantityToStepSize(size, stepSize);

		logger.info('Closing short position', ctx, {
			size,
			price,
			quantity,
			stepSize
		});

		const orderBody = {
			symbol,
			order_type: 'MARKET',
			side: 'BUY',
			order_quantity: quantity
		};

		try {
			const response = await makeOrderlyRequest<{
				data: {
					order_id: number;
					client_order_id?: string;
				};
			}>(this.env, 'POST', '/v1/order', orderBody);

			logger.info('Short position closed successfully', ctx, {
				orderId: response.data.order_id,
				quantity
			});

			return {
				type: ExchangeType.ORDERBOOK,
				success: true,
				executedPrice: price,
				executedSize: parseFloat(quantity),
				fee: 0,
				orderId: response.data.order_id.toString()
			};
		} catch (error) {
			logger.error('Failed to close short position', error as Error, ctx, {
				size,
				quantity
			});
			throw error;
		}
	}

	async getExpectedTradeReturn(
		symbol: string,
		size: number,
		isLong: boolean,
		isOpen: boolean,
		options: TradeOptions
	) {
		if (options.type !== ExchangeType.ORDERBOOK) {
			throw new Error('Orderly only supports orderbook trading');
		}

		const price = await this.getPrice(symbol);

		let expectedSize: number;
		if (isOpen) {
			// Opening: size is USDC amount, convert to base token
			expectedSize = size / price;
		} else {
			// Closing: size is already in base token
			expectedSize = size;
		}

		return {
			type: ExchangeType.ORDERBOOK as const,
			expectedPrice: price,
			expectedSize,
			fee: 0 // Orderly fees are handled server-side
		};
	}

	async isMarketActive(symbol: string): Promise<boolean> {
		try {
			await this.getPrice(symbol);
			return true;
		} catch {
			return false;
		}
	}

	async getFees(_symbol: string): Promise<{
		type: ExchangeType.ORDERBOOK;
		makerFee: number;
		takerFee: number;
	}> {
		// Get fee rates from account info
		const response = await makeOrderlyRequest<{
			data: {
				maker_fee_rate: number;
				taker_fee_rate: number;
			};
		}>(this.env, 'GET', '/v1/client/info');

		return {
			type: ExchangeType.ORDERBOOK,
			makerFee: response.data.maker_fee_rate,
			takerFee: response.data.taker_fee_rate
		};
	}
}
