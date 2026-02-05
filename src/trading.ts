import { ExchangeType, TradingAdapter } from './adapters';
import { getTradingConfig, TRADING_CONFIG } from './config';
import { getLogger, createContext } from './logger';
import { EnvBindings } from './types';

/**
 * Calculate slope using linear regression
 */
function calculateSlope(values: number[], windowSize: number): number {
	if (values.length < windowSize) {
		return 0;
	}

	// Get the last window of values
	const subset = values.slice(-windowSize);

	// Calculate means
	let sumX = 0;
	let sumY = 0;
	for (let i = 0; i < windowSize; i++) {
		sumX += i;
		sumY += subset[i];
	}
	const xMean = sumX / windowSize;
	const yMean = sumY / windowSize;

	// Calculate slope
	let numerator = 0;
	let denominator = 0;
	for (let i = 0; i < windowSize; i++) {
		const dx = i - xMean;
		const dy = subset[i] - yMean;
		numerator += dx * dy;
		denominator += dx * dx;
	}

	return denominator !== 0 ? numerator / denominator : 0;
}

/**
 * Calculate RSI score between -1 and 1
 * - Negative: Oversold (bullish)
 * - Positive: Overbought (bearish)
 * Magnitude increases exponentially as RSI moves towards extremes
 */
function calculateRsiScore(rsi: number): number {
	// Center RSI around 50
	const centered = rsi - 50;

	// Normalize to -1 to 1 range and apply exponential scaling
	// This makes the score change more rapidly at extremes
	return -Math.sign(centered) * Math.pow(Math.abs(centered) / 50, 2);
}

/**
 * Calculate Bollinger Bands score between -1.5 and 1.5
 * - Negative: Price near upper band (bearish)
 * - Positive: Price near lower band (bullish)
 * - Zero: Price in the middle
 */
function calculateBBandsScore(currentPrice: number, upperBand: number, lowerBand: number): number {
	const middleBand = (upperBand + lowerBand) / 2;
	const totalRange = upperBand - lowerBand;
	const pricePosition = (currentPrice - middleBand) / (totalRange / 2);
	return -pricePosition * TRADING_CONFIG.BBANDS_MULTIPLIER;
}

/**
 * Calculate VWAP score dynamically based on price difference
 * Returns a score where:
 * - Positive: VWAP above price (bullish)
 * - Negative: VWAP below price (bearish)
 * - Zero: Within threshold (±1%)
 *
 * Examples with VWAP_THRESHOLD = 0.01 (1%):
 * - VWAP 0.5% above price: score = 0 (within threshold)
 * - VWAP 2% above price: score = 1.0 (1% above threshold)
 * - VWAP 3% above price: score = 2.0 (2% above threshold)
 * - VWAP 2.5% below price: score = -1.5 (1.5% below threshold)
 */
function calculateVwapScore(currentPrice: number, vwap: number): number {
	const vwapDiff = (vwap - currentPrice) / currentPrice;

	// Return 0 if within ±1% threshold
	if (Math.abs(vwapDiff) <= TRADING_CONFIG.VWAP_THRESHOLD) {
		return 0;
	}

	// Calculate how many additional percentage points above threshold
	const additionalPercentage = Math.abs(vwapDiff) - TRADING_CONFIG.VWAP_THRESHOLD;
	const score = additionalPercentage / TRADING_CONFIG.VWAP_THRESHOLD;

	// Return positive score for bullish (VWAP above price), negative for bearish
	return vwapDiff > 0 ? score : -score;
}

/**
 * Calculate divergence score between price and OBV slopes
 * Returns a score between -1 and 1:
 * - Negative: Bearish divergence (price up, OBV down)
 * - Positive: Bullish divergence (price down, OBV up)
 * - Magnitude indicates strength of divergence
 */
function detectSlopeDivergence(priceSlope: number, obvSlope: number, threshold: number): number {
	// If slopes are too small, no significant divergence
	if (Math.abs(priceSlope) < threshold) {
		return 0;
	}

	// Calculate how strongly the slopes diverge
	const divergenceStrength =
		(priceSlope * -obvSlope) / Math.max(Math.abs(priceSlope), Math.abs(obvSlope));

	// Scale the strength by how much price slope exceeds threshold
	const scaleFactor = Math.min(Math.abs(priceSlope) / threshold, 1);

	return divergenceStrength * scaleFactor;
}

/**
 * Calculate OBV score based on divergence
 */
function calculateObvScore(symbol: string, prices: number[], obvs: number[]): number {
	// Calculate slopes
	const priceSlope = calculateSlope(prices, TRADING_CONFIG.OBV_WINDOW_SIZE);
	const obvSlope = calculateSlope(obvs, TRADING_CONFIG.OBV_WINDOW_SIZE);

	// Normalize slopes
	const maxPrice = Math.max(...prices.slice(-TRADING_CONFIG.OBV_WINDOW_SIZE));
	const maxObv = Math.max(...obvs.slice(-TRADING_CONFIG.OBV_WINDOW_SIZE));
	const normalizedPriceSlope = (priceSlope / maxPrice) * 1000;
	const normalizedObvSlope = (obvSlope / maxObv) * 1000;

	const logger = getLogger();
	logger.debug('OBV analysis', createContext(symbol, 'obv_analysis'), {
		priceSlope: normalizedPriceSlope,
		obvSlope: normalizedObvSlope
	});

	// Calculate divergence score
	return detectSlopeDivergence(
		normalizedPriceSlope,
		normalizedObvSlope,
		TRADING_CONFIG.SLOPE_THRESHOLD
	);
}

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
): number {
	// Calculate base scores
	const vwapScore = calculateVwapScore(currentPrice, vwap);
	const bbandsScore = calculateBBandsScore(currentPrice, bbandsUpper, bbandsLower);
	const rsiScore = calculateRsiScore(rsi);
	const obvScore = calculateObvScore(symbol, prices, obvs);

	// Log individual scores
	const logger = getLogger();
	logger.debug('Individual TA scores calculated', createContext(symbol, 'ta_scores'), {
		vwap: vwapScore * TRADING_CONFIG.VWAP_MULTIPLIER,
		bbands: bbandsScore * TRADING_CONFIG.BBANDS_MULTIPLIER,
		rsi: rsiScore * TRADING_CONFIG.RSI_MULTIPLIER,
		obv: obvScore * TRADING_CONFIG.OBV_DIVERGENCE_MULTIPLIER,
		total:
			vwapScore * TRADING_CONFIG.VWAP_MULTIPLIER +
			bbandsScore * TRADING_CONFIG.BBANDS_MULTIPLIER +
			rsiScore * TRADING_CONFIG.RSI_MULTIPLIER +
			obvScore * TRADING_CONFIG.OBV_DIVERGENCE_MULTIPLIER
	});

	// Calculate total score
	const total =
		vwapScore * TRADING_CONFIG.VWAP_MULTIPLIER +
		bbandsScore * TRADING_CONFIG.BBANDS_MULTIPLIER +
		rsiScore * TRADING_CONFIG.RSI_MULTIPLIER +
		obvScore * TRADING_CONFIG.OBV_DIVERGENCE_MULTIPLIER;

	return total;
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
	const taScore = calculateTaScore(
		symbol,
		actualPrice,
		vwap,
		bbandsUpper,
		bbandsLower,
		rsi,
		prices,
		obvs
	);

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

		// Check if signal reversed (score opposite to position direction)
		const shouldClose = position.isLong ? taScore < thresholds.sell : taScore > thresholds.sell;

		if (shouldClose) {
			logger.info('Signal reversal triggered', ctx, {
				taScore,
				threshold: thresholds.sell,
				isLong: position.isLong
			});
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
			threshold: thresholds.buy
		});

		try {
			if (goLong) {
				await adapter.openLongPosition(symbol, balance, options);
			} else {
				if (!adapter.openShortPosition) {
					logger.error('Short positions not supported by adapter', undefined, ctx);
					return;
				}
				await adapter.openShortPosition(symbol, balance, options);
			}

			const remainingBalance = await adapter.getBalance();
			logger.info('Position opened successfully', ctx, {
				direction: goLong ? 'LONG' : 'SHORT',
				size: balance,
				remainingBalance
			});
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
