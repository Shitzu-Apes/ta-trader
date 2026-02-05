import { ExchangeType, TradingAdapter } from './adapters';
import { getTradingConfig, TRADING_CONFIG, MAX_ORDER_SIZE_USD } from './config';
import {
	calculateObvScore,
	calculateRsiScore,
	calculateBBandsScore,
	calculateVwapScore
} from './indicators';
import { getLogger, createContext } from './logger';
import { storeSignal, TradingSignal } from './signals';
import { EnvBindings } from './types';

export type Position = {
	symbol: string;
	size: number;
	isLong: boolean;
	lastUpdateTime: number;
	entryPrice: number;
	markPrice?: number;
	unrealizedPnl: number;
	realizedPnl: number;
};

/**
 * Calculate signal based on technical indicators
 * Returns a single score for the position
 */
function calculateTaScore(
	symbol: string,
	currentPrice: number,
	vwap: number,
	bbandsUpper: number,
	bbandsLower: number,
	rsi: number,
	prices: number[],
	obvs: number[]
): {
	score: number;
	indicators: {
		vwap: number;
		bbands: number;
		rsi: number;
		obv: number;
		total: number;
	};
} {
	// Calculate base scores
	const vwapScore = calculateVwapScore(currentPrice, vwap);
	const bbandsScore = calculateBBandsScore(currentPrice, bbandsUpper, bbandsLower);
	const rsiScore = calculateRsiScore(rsi);
	const obvScore = calculateObvScore(prices, obvs, symbol);

	// Calculate weighted scores
	const weightedVwap = vwapScore * TRADING_CONFIG.VWAP_MULTIPLIER;
	const weightedBbands = bbandsScore * TRADING_CONFIG.BBANDS_MULTIPLIER;
	const weightedRsi = rsiScore * TRADING_CONFIG.RSI_MULTIPLIER;
	const weightedObv = obvScore * TRADING_CONFIG.OBV_DIVERGENCE_MULTIPLIER;

	// Log individual scores
	const logger = getLogger();
	logger.debug('Individual TA scores calculated', createContext(symbol, 'ta_scores'), {
		vwap: weightedVwap,
		bbands: weightedBbands,
		rsi: weightedRsi,
		obv: weightedObv,
		total: weightedVwap + weightedBbands + weightedRsi + weightedObv
	});

	// Calculate total score
	const total = weightedVwap + weightedBbands + weightedRsi + weightedObv;

	return {
		score: total,
		indicators: {
			vwap: weightedVwap,
			bbands: weightedBbands,
			rsi: weightedRsi,
			obv: weightedObv,
			total: total
		}
	};
}

/**
 * Get actual price from the adapter
 */
async function getActualPrice(adapter: TradingAdapter, symbol: string): Promise<number> {
	try {
		return await adapter.getPrice(symbol);
	} catch {
		// Fallback: return 0 if price fetch fails
		return 0;
	}
}

/**
 * Analyze market data and decide trading action
 */
export async function analyzeForecast(
	adapter: TradingAdapter,
	_env: EnvBindings,
	symbol: string,
	currentPrice: number,
	vwap: number,
	bbandsUpper: number,
	bbandsLower: number,
	rsi: number,
	prices: number[],
	obvs: number[]
): Promise<void> {
	const logger = getLogger();
	const ctx = createContext(symbol, 'analyze_forecast');

	// Get current position from Orderly
	logger.debug('Fetching current position', ctx);
	const currentPosition = await adapter.getPosition(symbol);

	// Get actual price from adapter
	logger.debug('Fetching actual price', ctx);
	const actualPrice = await getActualPrice(adapter, symbol);
	if (!actualPrice) {
		logger.error('Failed to get actual price', undefined, ctx);
		return;
	}

	logger.info('Price data retrieved', ctx, {
		taapiPrice: currentPrice,
		actualPrice,
		priceDiff: (((actualPrice - currentPrice) / currentPrice) * 100).toFixed(4) + '%'
	});

	// Calculate technical analysis score
	const taScoreResult = calculateTaScore(
		symbol,
		actualPrice,
		vwap,
		bbandsUpper,
		bbandsLower,
		rsi,
		prices,
		obvs
	);
	const taScore = taScoreResult.score;
	const indicatorScores = taScoreResult.indicators;

	logger.info('TA Score calculated', ctx, { taScore });

	// Get environment-specific config
	const tradingConfig = getTradingConfig(_env);

	// Get thresholds based on position direction
	const thresholds = currentPosition
		? currentPosition.isLong
			? TRADING_CONFIG.POSITION_THRESHOLDS.long
			: TRADING_CONFIG.POSITION_THRESHOLDS.short
		: TRADING_CONFIG.POSITION_THRESHOLDS.long;

	// Check if we should close existing position
	if (currentPosition) {
		const position = currentPosition;
		const priceDiff = (actualPrice - position.entryPrice) / position.entryPrice;

		logger.info('Position detected', ctx, {
			size: position.size,
			isLong: position.isLong,
			entryPrice: position.entryPrice,
			currentPrice: actualPrice,
			unrealizedPnl: position.unrealizedPnl,
			priceDiff: (priceDiff * 100).toFixed(4) + '%'
		});

		// Check stop loss
		if (priceDiff <= tradingConfig.STOP_LOSS_THRESHOLD) {
			logger.warn('Stop loss triggered', ctx, {
				entryPrice: position.entryPrice,
				currentPrice: actualPrice,
				priceDiff: (priceDiff * 100).toFixed(4) + '%',
				threshold: (tradingConfig.STOP_LOSS_THRESHOLD * 100).toFixed(2) + '%'
			});

			// Store exit signal
			const exitSignal: TradingSignal = {
				symbol,
				timestamp: Date.now(),
				type: 'EXIT',
				action: 'CLOSE',
				direction: position.isLong ? 'LONG' : 'SHORT',
				reason: 'STOP_LOSS',
				taScore,
				threshold: tradingConfig.STOP_LOSS_THRESHOLD,
				price: actualPrice,
				positionSize: position.size,
				entryPrice: position.entryPrice,
				unrealizedPnl: position.unrealizedPnl,
				realizedPnl: position.realizedPnl,
				indicators: indicatorScores
			};
			await storeSignal(_env, exitSignal);

			await closePosition(adapter, symbol, position);
			return;
		}

		// Check take profit
		if (priceDiff >= tradingConfig.TAKE_PROFIT_THRESHOLD) {
			logger.info('Take profit triggered', ctx, {
				entryPrice: position.entryPrice,
				currentPrice: actualPrice,
				priceDiff: (priceDiff * 100).toFixed(4) + '%',
				threshold: (tradingConfig.TAKE_PROFIT_THRESHOLD * 100).toFixed(2) + '%'
			});

			// Store exit signal
			const exitSignal: TradingSignal = {
				symbol,
				timestamp: Date.now(),
				type: 'EXIT',
				action: 'CLOSE',
				direction: position.isLong ? 'LONG' : 'SHORT',
				reason: 'TAKE_PROFIT',
				taScore,
				threshold: tradingConfig.TAKE_PROFIT_THRESHOLD,
				price: actualPrice,
				positionSize: position.size,
				entryPrice: position.entryPrice,
				unrealizedPnl: position.unrealizedPnl,
				realizedPnl: position.realizedPnl,
				indicators: indicatorScores
			};
			await storeSignal(_env, exitSignal);

			await closePosition(adapter, symbol, position);
			return;
		}

		// Check if signal reversed (score opposite to position direction)
		const shouldClose = position.isLong ? taScore < thresholds.sell : taScore > thresholds.sell;

		if (shouldClose) {
			logger.info('Signal reversal triggered', ctx, {
				taScore,
				threshold: thresholds.sell,
				isLong: position.isLong
			});

			// Store exit signal
			const exitSignal: TradingSignal = {
				symbol,
				timestamp: Date.now(),
				type: 'EXIT',
				action: 'CLOSE',
				direction: position.isLong ? 'LONG' : 'SHORT',
				reason: 'SIGNAL_REVERSAL',
				taScore,
				threshold: thresholds.sell,
				price: actualPrice,
				positionSize: position.size,
				entryPrice: position.entryPrice,
				unrealizedPnl: position.unrealizedPnl,
				realizedPnl: position.realizedPnl,
				indicators: indicatorScores
			};
			await storeSignal(_env, exitSignal);

			await closePosition(adapter, symbol, position);
			return;
		}

		// Display current position state
		logger.info('Holding position', ctx, {
			size: position.size,
			entryPrice: position.entryPrice,
			unrealizedPnl: position.unrealizedPnl,
			priceDiff: (priceDiff * 100).toFixed(4) + '%'
		});

		// Store hold signal
		const holdSignal: TradingSignal = {
			symbol,
			timestamp: Date.now(),
			type: 'HOLD',
			direction: position.isLong ? 'LONG' : 'SHORT',
			taScore,
			threshold: thresholds.sell,
			price: actualPrice,
			positionSize: position.size,
			entryPrice: position.entryPrice,
			unrealizedPnl: position.unrealizedPnl,
			realizedPnl: position.realizedPnl,
			indicators: indicatorScores
		};
		await storeSignal(_env, holdSignal);

		return;
	}

	// Check if we should open a new position
	if (Math.abs(taScore) > Math.abs(thresholds.buy)) {
		// Determine direction based on score sign
		const goLong = taScore > 0;

		// Get balance
		logger.debug('Fetching balance for position opening', ctx);
		const balance = await adapter.getBalance();
		if (balance <= 0) {
			logger.warn('Insufficient balance', ctx, { balance });
			return;
		}

		// Apply max order size limit based on symbol liquidity
		const maxOrderSize = MAX_ORDER_SIZE_USD[symbol as keyof typeof MAX_ORDER_SIZE_USD] || balance;
		const orderSize = Math.min(balance, maxOrderSize);

		if (orderSize < maxOrderSize) {
			logger.info(`Order size limited by available balance`, ctx, {
				requested: maxOrderSize,
				available: balance,
				using: orderSize
			});
		} else if (orderSize < balance) {
			logger.info(`Order size limited by max order size for ${symbol}`, ctx, {
				balance,
				maxOrderSize,
				using: orderSize
			});
		}

		const exchangeType = adapter.getExchangeType();
		const options =
			exchangeType === ExchangeType.AMM
				? ({
						type: ExchangeType.AMM,
						maxPriceImpact: 0.05
					} as const)
				: ({
						type: ExchangeType.ORDERBOOK,
						orderType: 'market' as const
					} as const);

		// Open position
		logger.info(`Opening ${goLong ? 'long' : 'short'} position`, ctx, {
			taScore,
			balance,
			orderSize,
			threshold: thresholds.buy
		});

		try {
			if (goLong) {
				await adapter.openLongPosition(symbol, orderSize, options);
			} else {
				if (!adapter.openShortPosition) {
					logger.error('Short positions not supported by adapter', undefined, ctx);
					return;
				}
				await adapter.openShortPosition(symbol, orderSize, options);
			}

			const remainingBalance = await adapter.getBalance();
			logger.info('Position opened successfully', ctx, {
				direction: goLong ? 'LONG' : 'SHORT',
				size: orderSize,
				remainingBalance
			});

			// Store entry signal
			const entrySignal: TradingSignal = {
				symbol,
				timestamp: Date.now(),
				type: 'ENTRY',
				action: 'OPEN',
				direction: goLong ? 'LONG' : 'SHORT',
				reason: 'TA_SCORE',
				taScore,
				threshold: thresholds.buy,
				price: actualPrice,
				positionSize: orderSize,
				indicators: indicatorScores
			};
			await storeSignal(_env, entrySignal);
		} catch (error) {
			logger.error('Failed to open position', error as Error, ctx, {
				direction: goLong ? 'LONG' : 'SHORT',
				balance
			});
			throw error;
		}
		return;
	}

	logger.info('No position action taken', ctx, {
		taScore,
		buyThreshold: thresholds.buy,
		reason: 'Score below threshold'
	});

	// Store no-action signal
	const noActionSignal: TradingSignal = {
		symbol,
		timestamp: Date.now(),
		type: 'NO_ACTION',
		taScore,
		threshold: thresholds.buy,
		price: actualPrice,
		indicators: indicatorScores
	};
	await storeSignal(_env, noActionSignal);
}

/**
 * Check positions and close if stop loss or take profit is hit
 * Runs every minute - only closes positions, never opens them
 */
export async function checkAndClosePositions(
	adapter: TradingAdapter,
	env: EnvBindings,
	symbol: string
): Promise<void> {
	const logger = getLogger();
	const ctx = createContext(symbol, 'check_positions');

	logger.debug('Checking positions for closure', ctx);

	try {
		// Get current position from Orderly
		const currentPosition = await adapter.getPosition(symbol);

		if (!currentPosition) {
			logger.debug('No active position to check', ctx);
			return;
		}

		// Get actual price from adapter
		const actualPrice = await getActualPrice(adapter, symbol);
		if (!actualPrice) {
			logger.error('Failed to get actual price for position check', undefined, ctx);
			return;
		}

		const position = currentPosition;
		const priceDiff = (actualPrice - position.entryPrice) / position.entryPrice;
		const tradingConfig = getTradingConfig(env);

		logger.info('Checking position for closure', ctx, {
			size: position.size,
			isLong: position.isLong,
			entryPrice: position.entryPrice,
			currentPrice: actualPrice,
			unrealizedPnl: position.unrealizedPnl,
			priceDiff: (priceDiff * 100).toFixed(4) + '%'
		});

		// Check stop loss
		if (priceDiff <= tradingConfig.STOP_LOSS_THRESHOLD) {
			logger.warn('Stop loss triggered', ctx, {
				entryPrice: position.entryPrice,
				currentPrice: actualPrice,
				priceDiff: (priceDiff * 100).toFixed(4) + '%',
				threshold: (tradingConfig.STOP_LOSS_THRESHOLD * 100).toFixed(2) + '%'
			});
			await closePosition(adapter, symbol, position);
			return;
		}

		// Check take profit
		if (priceDiff >= tradingConfig.TAKE_PROFIT_THRESHOLD) {
			logger.info('Take profit triggered', ctx, {
				entryPrice: position.entryPrice,
				currentPrice: actualPrice,
				priceDiff: (priceDiff * 100).toFixed(4) + '%',
				threshold: (tradingConfig.TAKE_PROFIT_THRESHOLD * 100).toFixed(2) + '%'
			});
			await closePosition(adapter, symbol, position);
			return;
		}

		logger.info('Position within thresholds, holding', ctx, {
			priceDiff: (priceDiff * 100).toFixed(4) + '%',
			stopLoss: (tradingConfig.STOP_LOSS_THRESHOLD * 100).toFixed(2) + '%',
			takeProfit: (tradingConfig.TAKE_PROFIT_THRESHOLD * 100).toFixed(2) + '%'
		});
	} catch (error) {
		logger.error('Error checking positions', error as Error, ctx);
		throw error;
	}
}

/**
 * Close a position
 */
async function closePosition(
	adapter: TradingAdapter,
	symbol: string,
	position: Position
): Promise<void> {
	const logger = getLogger();
	const ctx = createContext(symbol, 'close_position');

	logger.info('Closing position', ctx, {
		direction: position.isLong ? 'LONG' : 'SHORT',
		size: position.size,
		entryPrice: position.entryPrice,
		unrealizedPnl: position.unrealizedPnl,
		realizedPnl: position.realizedPnl
	});

	const exchangeType = adapter.getExchangeType();
	const options =
		exchangeType === ExchangeType.AMM
			? ({
					type: ExchangeType.AMM,
					maxPriceImpact: 0.05
				} as const)
			: ({
					type: ExchangeType.ORDERBOOK,
					orderType: 'market' as const
				} as const);

	try {
		// Close position using adapter
		if (position.isLong) {
			await adapter.closeLongPosition(symbol, position.size, options);
		} else {
			if (!adapter.closeShortPosition) {
				throw new Error('Adapter does not support short positions');
			}
			await adapter.closeShortPosition(symbol, position.size, options);
		}

		logger.info('Position closed successfully', ctx, {
			direction: position.isLong ? 'LONG' : 'SHORT',
			size: position.size,
			realizedPnl: position.realizedPnl
		});
	} catch (error) {
		logger.error('Failed to close position', error as Error, ctx, {
			direction: position.isLong ? 'LONG' : 'SHORT',
			size: position.size
		});
		throw error;
	}
}
