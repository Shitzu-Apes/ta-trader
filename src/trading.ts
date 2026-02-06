import { ExchangeType, TradingAdapter } from './adapters';
import {
	getTradingConfig,
	TRADING_CONFIG,
	MAX_ORDER_SIZE_USD,
	MAX_LEVERAGE_PER_SYMBOL,
	MAX_ACCOUNT_LEVERAGE,
	POSITION_SIZING_CONFIG,
	PerpSymbol
} from './config';
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
	openedAt: number; // Timestamp when position was first opened
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
 * Calculate TA score intensity (0 to 1)
 */
function calculateTaIntensity(taScore: number): number {
	return Math.min(Math.abs(taScore) / POSITION_SIZING_CONFIG.STRONG_SIGNAL_THRESHOLD, 1);
}

/**
 * Calculate profit score for position closing decisions
 * Returns negative score when profitable (encourages closing)
 */
function calculateProfitScore(position: Position, currentPrice: number): number {
	const profitPct = position.isLong
		? (currentPrice - position.entryPrice) / position.entryPrice
		: (position.entryPrice - currentPrice) / position.entryPrice;

	// Only apply when profitable
	if (profitPct <= 0) return 0;

	// Return negative score to encourage closing (more profit = more negative)
	return -profitPct;
}

/**
 * Calculate time decay score for position closing decisions
 * Returns increasingly negative score the longer position is open
 */
function calculateTimeDecayScore(openedAt: number): number {
	const ageInMinutes = Math.floor((Date.now() - openedAt) / (1000 * 60));
	return -ageInMinutes * POSITION_SIZING_CONFIG.TIME_DECAY_MULTIPLIER;
}

/**
 * Calculate total leverage used by all positions except optionally one
 */
function calculateUsedLeverage(
	positions: Position[],
	balance: number,
	excludeSymbol?: string
): number {
	if (balance <= 0) return 0;

	let totalPositionValue = 0;
	for (const pos of positions) {
		if (pos.symbol !== excludeSymbol) {
			// Use markPrice if available, otherwise entryPrice
			const price = pos.markPrice || pos.entryPrice;
			totalPositionValue += pos.size * price;
		}
	}

	return totalPositionValue / balance;
}

/**
 * Calculate target position size based on TA score, balance, and leverage constraints
 */
function calculateTargetPositionSize(
	balance: number,
	taScore: number,
	symbol: PerpSymbol,
	currentPosition: Position | null,
	allPositions: Position[]
): { targetSize: number; intensity: number; availableLeverage: number } {
	// Calculate used leverage from other positions
	const usedLeverage = calculateUsedLeverage(allPositions, balance, symbol);
	const availableAccountLeverage = Math.max(0, MAX_ACCOUNT_LEVERAGE - usedLeverage);

	// Get symbol-specific max leverage
	const symbolMaxLeverage = MAX_LEVERAGE_PER_SYMBOL[symbol];

	// Use the more restrictive of symbol max or available account leverage
	const effectiveMaxLeverage = Math.min(symbolMaxLeverage, availableAccountLeverage);

	// Calculate max position size based on leverage
	const maxPositionSize = balance * effectiveMaxLeverage;

	// Normalize TA score to 0-1 intensity
	const intensity = calculateTaIntensity(taScore);

	// Calculate target size
	let targetSize = maxPositionSize * intensity;

	// Apply liquidity cap
	const liquidityCap = MAX_ORDER_SIZE_USD[symbol];
	targetSize = Math.min(targetSize, liquidityCap);

	return { targetSize, intensity, availableLeverage: effectiveMaxLeverage };
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
 * Analyze market data and decide trading action with dynamic position sizing
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

	// Get all positions for leverage calculation
	logger.debug('Fetching all positions for leverage calculation', ctx);
	const allPositions = await adapter.getPositions();

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
	const intensity = calculateTaIntensity(taScore);

	logger.info('TA Score calculated', ctx, { taScore, intensity });

	// Get environment-specific config
	const tradingConfig = getTradingConfig(_env);

	// Get thresholds based on position direction
	const thresholds = currentPosition
		? currentPosition.isLong
			? TRADING_CONFIG.POSITION_THRESHOLDS.long
			: TRADING_CONFIG.POSITION_THRESHOLDS.short
		: TRADING_CONFIG.POSITION_THRESHOLDS.long;

	// Get balance
	logger.debug('Fetching balance', ctx);
	const balance = await adapter.getBalance();
	if (balance <= 0) {
		logger.warn('Insufficient balance', ctx, { balance });
		return;
	}

	// Calculate target position size based on TA score and leverage
	const { targetSize, availableLeverage } = calculateTargetPositionSize(
		balance,
		taScore,
		symbol as PerpSymbol,
		currentPosition,
		allPositions
	);

	logger.info('Target position size calculated', ctx, {
		targetSize,
		intensity,
		availableLeverage,
		currentPositionSize: currentPosition?.size || 0
	});

	// Check if we should close existing position or adjust it
	if (currentPosition) {
		const position = currentPosition;
		const priceDiff = (actualPrice - position.entryPrice) / position.entryPrice;

		logger.info('Position detected', ctx, {
			size: position.size,
			isLong: position.isLong,
			entryPrice: position.entryPrice,
			currentPrice: actualPrice,
			unrealizedPnl: position.unrealizedPnl,
			priceDiff: (priceDiff * 100).toFixed(4) + '%',
			openedAt: new Date(position.openedAt).toISOString()
		});

		// Check stop loss (inverted for short positions)
		const stopLossHit = position.isLong
			? priceDiff <= tradingConfig.STOP_LOSS_THRESHOLD
			: priceDiff >= -tradingConfig.STOP_LOSS_THRESHOLD;
		if (stopLossHit) {
			logger.warn('Stop loss triggered', ctx, {
				entryPrice: position.entryPrice,
				currentPrice: actualPrice,
				priceDiff: (priceDiff * 100).toFixed(4) + '%',
				threshold: (tradingConfig.STOP_LOSS_THRESHOLD * 100).toFixed(2) + '%',
				direction: position.isLong ? 'LONG' : 'SHORT'
			});

			await closePositionWithSignal(
				adapter,
				symbol,
				position,
				_env,
				'STOP_LOSS',
				taScore,
				indicatorScores,
				actualPrice
			);
			return;
		}

		// Check take profit (inverted for short positions)
		const takeProfitHit = position.isLong
			? priceDiff >= tradingConfig.TAKE_PROFIT_THRESHOLD
			: priceDiff <= -tradingConfig.TAKE_PROFIT_THRESHOLD;
		if (takeProfitHit) {
			logger.info('Take profit triggered', ctx, {
				entryPrice: position.entryPrice,
				currentPrice: actualPrice,
				priceDiff: (priceDiff * 100).toFixed(4) + '%',
				threshold: (tradingConfig.TAKE_PROFIT_THRESHOLD * 100).toFixed(2) + '%',
				direction: position.isLong ? 'LONG' : 'SHORT'
			});

			await closePositionWithSignal(
				adapter,
				symbol,
				position,
				_env,
				'TAKE_PROFIT',
				taScore,
				indicatorScores,
				actualPrice
			);
			return;
		}

		// Calculate exit score with profit and time decay multipliers
		const profitScore = calculateProfitScore(position, actualPrice);
		const timeDecayScore = calculateTimeDecayScore(position.openedAt);
		// Apply time decay directionally: subtract for longs, add for shorts
		const timeDecayApplied = position.isLong ? timeDecayScore : -timeDecayScore;
		const exitScore =
			taScore + profitScore * POSITION_SIZING_CONFIG.PROFIT_SCORE_MULTIPLIER + timeDecayApplied;

		logger.info('Exit score calculated', ctx, {
			taScore,
			profitScore,
			timeDecayScore,
			exitScore,
			profitMultiplier: POSITION_SIZING_CONFIG.PROFIT_SCORE_MULTIPLIER,
			timeDecayMultiplier: POSITION_SIZING_CONFIG.TIME_DECAY_MULTIPLIER
		});

		// Check if signal reversed or multipliers triggered close
		const shouldClose = position.isLong ? exitScore < thresholds.sell : exitScore > thresholds.sell;

		if (shouldClose) {
			logger.info('Signal reversal or multipliers triggered close', ctx, {
				exitScore,
				threshold: thresholds.sell,
				isLong: position.isLong,
				reason:
					profitScore < 0 ? 'PROFIT_TAKING' : timeDecayScore < 0 ? 'TIME_DECAY' : 'SIGNAL_REVERSAL'
			});

			await closePositionWithSignal(
				adapter,
				symbol,
				position,
				_env,
				profitScore < 0 ? 'PROFIT_TAKING' : timeDecayScore < 0 ? 'TIME_DECAY' : 'SIGNAL_REVERSAL',
				taScore,
				indicatorScores,
				actualPrice,
				{ profitScore, timeDecayScore, exitScore }
			);

			// Potentially open opposite position if signal strong enough
			if (Math.abs(taScore) > Math.abs(thresholds.buy)) {
				const newDirection = taScore > 0 ? 'LONG' : 'SHORT';
				logger.info('Opening opposite position after close', ctx, {
					direction: newDirection,
					taScore,
					targetSize
				});
				await openPosition(
					adapter,
					symbol,
					targetSize,
					newDirection,
					_env,
					taScore,
					indicatorScores,
					actualPrice,
					intensity,
					availableLeverage
				);
			}
			return;
		}

		// Same direction - check if we need to adjust position size
		// Convert position size (base tokens) to notional value (USDC) for comparison
		// Use absolute value since position.size is negative for shorts
		const currentNotionalValue = Math.abs(position.size * actualPrice);
		const sizeDiff = targetSize - currentNotionalValue;
		const adjustmentThreshold =
			currentNotionalValue * POSITION_SIZING_CONFIG.POSITION_ADJUSTMENT_THRESHOLD_PERCENT;

		if (
			Math.abs(sizeDiff) > adjustmentThreshold &&
			Math.abs(sizeDiff) > POSITION_SIZING_CONFIG.MIN_ORDER_SIZE_USD
		) {
			if (sizeDiff > 0) {
				// Increase position
				logger.info('Increasing position size', ctx, {
					currentNotionalValue,
					targetSize,
					increaseBy: sizeDiff,
					reason: 'STRENGTHENED_SIGNAL'
				});
				await adjustPositionSize(
					adapter,
					symbol,
					sizeDiff,
					'INCREASE',
					position.isLong ? 'LONG' : 'SHORT',
					_env,
					taScore,
					indicatorScores,
					actualPrice,
					targetSize,
					currentNotionalValue,
					intensity,
					availableLeverage
				);
			} else {
				// Decrease position (partial close)
				const decreaseSize = Math.abs(sizeDiff);
				logger.info('Decreasing position size', ctx, {
					currentNotionalValue,
					targetSize,
					decreaseBy: decreaseSize,
					reason: 'WEAKENED_SIGNAL'
				});
				await adjustPositionSize(
					adapter,
					symbol,
					decreaseSize,
					'DECREASE',
					position.isLong ? 'LONG' : 'SHORT',
					_env,
					taScore,
					indicatorScores,
					actualPrice,
					targetSize,
					currentNotionalValue,
					intensity,
					availableLeverage
				);
			}
			return;
		}

		// Display current position state
		logger.info('Holding position', ctx, {
			size: position.size,
			entryPrice: position.entryPrice,
			unrealizedPnl: position.unrealizedPnl,
			priceDiff: (priceDiff * 100).toFixed(4) + '%',
			targetSize,
			sizeDiff: sizeDiff > 0 ? `+${sizeDiff.toFixed(2)}` : sizeDiff.toFixed(2),
			adjustmentThreshold: adjustmentThreshold.toFixed(2)
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
			indicators: indicatorScores,
			targetSize,
			currentSize: currentNotionalValue,
			intensity,
			availableLeverage
		};
		await storeSignal(_env, holdSignal);

		return;
	}

	// No position - check if we should open a new one
	if (Math.abs(taScore) > Math.abs(thresholds.buy)) {
		const direction = taScore > 0 ? 'LONG' : 'SHORT';

		logger.info(`Opening new ${direction} position`, ctx, {
			taScore,
			balance,
			targetSize,
			intensity,
			availableLeverage,
			threshold: thresholds.buy
		});

		await openPosition(
			adapter,
			symbol,
			targetSize,
			direction,
			_env,
			taScore,
			indicatorScores,
			actualPrice,
			intensity,
			availableLeverage
		);
		return;
	}

	logger.info('No position action taken', ctx, {
		taScore,
		buyThreshold: thresholds.buy,
		intensity,
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
		indicators: indicatorScores,
		intensity,
		availableLeverage
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

		// Check stop loss (inverted for short positions)
		const stopLossHit = position.isLong
			? priceDiff <= tradingConfig.STOP_LOSS_THRESHOLD
			: priceDiff >= -tradingConfig.STOP_LOSS_THRESHOLD;
		if (stopLossHit) {
			logger.warn('Stop loss triggered', ctx, {
				entryPrice: position.entryPrice,
				currentPrice: actualPrice,
				priceDiff: (priceDiff * 100).toFixed(4) + '%',
				threshold: (tradingConfig.STOP_LOSS_THRESHOLD * 100).toFixed(2) + '%',
				direction: position.isLong ? 'LONG' : 'SHORT'
			});
			await closePositionWithExitType(adapter, env, symbol, position, actualPrice, 'STOP_LOSS');
			return;
		}

		// Check take profit (inverted for short positions)
		const takeProfitHit = position.isLong
			? priceDiff >= tradingConfig.TAKE_PROFIT_THRESHOLD
			: priceDiff <= -tradingConfig.TAKE_PROFIT_THRESHOLD;
		if (takeProfitHit) {
			logger.info('Take profit triggered', ctx, {
				entryPrice: position.entryPrice,
				currentPrice: actualPrice,
				priceDiff: (priceDiff * 100).toFixed(4) + '%',
				threshold: (tradingConfig.TAKE_PROFIT_THRESHOLD * 100).toFixed(2) + '%',
				direction: position.isLong ? 'LONG' : 'SHORT'
			});
			await closePositionWithExitType(adapter, env, symbol, position, actualPrice, 'TAKE_PROFIT');
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
 * Check for signal reversal using fresh TA indicators (in-memory, not stored)
 * Used by 1-minute cron to check if open positions should be closed due to signal reversal
 */
export async function checkSignalReversal(
	adapter: TradingAdapter,
	env: EnvBindings,
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
	const ctx = createContext(symbol, 'check_signal_reversal');

	logger.debug('Checking for signal reversal with fresh indicators', ctx);

	try {
		// Get current position from Orderly
		const currentPosition = await adapter.getPosition(symbol);

		if (!currentPosition) {
			return;
		}

		// Get actual price from adapter
		const actualPrice = await getActualPrice(adapter, symbol);
		if (!actualPrice) {
			logger.error('Failed to get actual price for reversal check', undefined, ctx);
			return;
		}

		const position = currentPosition;

		// Calculate TA score using fresh indicators
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

		// Apply time decay to encourage closing long-held positions
		const timeDecayScore = calculateTimeDecayScore(position.openedAt);
		// Apply time decay directionally: subtract for longs, add for shorts
		const exitScore = position.isLong ? taScore + timeDecayScore : taScore - timeDecayScore;

		logger.info('TA Score calculated for reversal check', ctx, {
			taScore,
			timeDecayScore,
			exitScore,
			isLong: position.isLong
		});

		// Get thresholds based on position direction
		const thresholds = position.isLong
			? TRADING_CONFIG.POSITION_THRESHOLDS.long
			: TRADING_CONFIG.POSITION_THRESHOLDS.short;

		// Check if signal reversed or time decay triggered close
		const shouldClose = position.isLong ? exitScore < thresholds.sell : exitScore > thresholds.sell;

		if (shouldClose) {
			const reason = timeDecayScore < -0.1 ? 'TIME_DECAY' : 'SIGNAL_REVERSAL';
			logger.info('Position close triggered', ctx, {
				exitScore,
				taScore,
				timeDecayScore,
				threshold: thresholds.sell,
				isLong: position.isLong,
				reason
			});

			// Store exit signal
			const exitSignal: TradingSignal = {
				symbol,
				timestamp: Date.now(),
				type: 'EXIT',
				action: 'CLOSE',
				direction: position.isLong ? 'LONG' : 'SHORT',
				reason,
				taScore,
				threshold: thresholds.sell,
				price: actualPrice,
				positionSize: position.size,
				entryPrice: position.entryPrice,
				unrealizedPnl: position.unrealizedPnl,
				realizedPnl: position.realizedPnl,
				indicators: taScoreResult.indicators,
				timeDecayScore
			};
			await storeSignal(env, exitSignal);

			await closePosition(adapter, symbol, position);
			return;
		}

		logger.info('No signal reversal detected, holding position', ctx, {
			exitScore,
			taScore,
			timeDecayScore,
			threshold: thresholds.sell,
			isLong: position.isLong
		});
	} catch (error) {
		logger.error('Error checking signal reversal', error as Error, ctx);
		throw error;
	}
}

/**
 * Close a position with signal storage
 */
async function closePositionWithSignal(
	adapter: TradingAdapter,
	symbol: string,
	position: Position,
	env: EnvBindings,
	reason: 'STOP_LOSS' | 'TAKE_PROFIT' | 'SIGNAL_REVERSAL' | 'PROFIT_TAKING' | 'TIME_DECAY',
	taScore: number,
	indicators: TradingSignal['indicators'],
	price: number,
	extraScores?: { profitScore?: number; timeDecayScore?: number; exitScore?: number }
): Promise<void> {
	const logger = getLogger();
	const ctx = createContext(symbol, 'close_position');

	logger.info('Closing position', ctx, {
		direction: position.isLong ? 'LONG' : 'SHORT',
		size: position.size,
		entryPrice: position.entryPrice,
		unrealizedPnl: position.unrealizedPnl,
		realizedPnl: position.realizedPnl,
		reason,
		...extraScores
	});

	// Store exit signal
	const exitSignal: TradingSignal = {
		symbol,
		timestamp: Date.now(),
		type: 'EXIT',
		action: 'CLOSE',
		direction: position.isLong ? 'LONG' : 'SHORT',
		reason,
		taScore,
		threshold:
			reason === 'STOP_LOSS'
				? getTradingConfig(env).STOP_LOSS_THRESHOLD
				: reason === 'TAKE_PROFIT'
					? getTradingConfig(env).TAKE_PROFIT_THRESHOLD
					: 0,
		price,
		positionSize: position.size,
		entryPrice: position.entryPrice,
		unrealizedPnl: position.unrealizedPnl,
		realizedPnl: position.realizedPnl,
		indicators,
		profitScore: extraScores?.profitScore,
		timeDecayScore: extraScores?.timeDecayScore
	};
	await storeSignal(env, exitSignal);

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

/**
 * Close a position due to stop-loss or take-profit trigger
 * Stores explicit STOP_LOSS or TAKE_PROFIT signal types
 */
async function closePositionWithExitType(
	adapter: TradingAdapter,
	env: EnvBindings,
	symbol: string,
	position: Position,
	price: number,
	exitType: 'STOP_LOSS' | 'TAKE_PROFIT'
): Promise<void> {
	const logger = getLogger();
	const ctx = createContext(symbol, 'close_position');

	logger.info(`Closing position due to ${exitType}`, ctx, {
		direction: position.isLong ? 'LONG' : 'SHORT',
		size: position.size,
		entryPrice: position.entryPrice,
		currentPrice: price,
		unrealizedPnl: position.unrealizedPnl,
		realizedPnl: position.realizedPnl
	});

	const tradingConfig = getTradingConfig(env);

	// Store exit signal with explicit type
	const exitSignal: TradingSignal = {
		symbol,
		timestamp: Date.now(),
		type: exitType,
		action: 'CLOSE',
		direction: position.isLong ? 'LONG' : 'SHORT',
		reason: exitType,
		taScore: 0,
		threshold:
			exitType === 'STOP_LOSS'
				? tradingConfig.STOP_LOSS_THRESHOLD
				: tradingConfig.TAKE_PROFIT_THRESHOLD,
		price,
		positionSize: position.size,
		entryPrice: position.entryPrice,
		unrealizedPnl: position.unrealizedPnl,
		realizedPnl: position.realizedPnl
	};
	await storeSignal(env, exitSignal);

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
			realizedPnl: position.realizedPnl,
			exitType
		});
	} catch (error) {
		logger.error('Failed to close position', error as Error, ctx, {
			direction: position.isLong ? 'LONG' : 'SHORT',
			size: position.size
		});
		throw error;
	}
}

/**
 * Open a new position
 */
async function openPosition(
	adapter: TradingAdapter,
	symbol: string,
	size: number,
	direction: 'LONG' | 'SHORT',
	env: EnvBindings,
	taScore: number,
	indicators: TradingSignal['indicators'],
	price: number,
	intensity: number,
	availableLeverage: number
): Promise<void> {
	const logger = getLogger();
	const ctx = createContext(symbol, 'open_position');

	// Check minimum order size
	if (size < POSITION_SIZING_CONFIG.MIN_ORDER_SIZE_USD) {
		logger.warn('Order size below minimum, skipping', ctx, {
			size,
			minSize: POSITION_SIZING_CONFIG.MIN_ORDER_SIZE_USD
		});
		return;
	}

	logger.info(`Opening ${direction} position`, ctx, {
		taScore,
		size,
		intensity,
		availableLeverage
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
		if (direction === 'LONG') {
			await adapter.openLongPosition(symbol, size, options);
		} else {
			if (!adapter.openShortPosition) {
				logger.error('Short positions not supported by adapter', undefined, ctx);
				return;
			}
			await adapter.openShortPosition(symbol, size, options);
		}

		logger.info('Position opened successfully', ctx, {
			direction,
			size
		});

		// Store entry signal
		const entrySignal: TradingSignal = {
			symbol,
			timestamp: Date.now(),
			type: 'ENTRY',
			action: 'OPEN',
			direction,
			reason: 'TA_SCORE',
			taScore,
			threshold: 0,
			price,
			positionSize: size,
			indicators,
			intensity,
			availableLeverage
		};
		await storeSignal(env, entrySignal);
	} catch (error) {
		logger.error('Failed to open position', error as Error, ctx, {
			direction,
			size
		});
		throw error;
	}
}

/**
 * Adjust position size (increase or decrease)
 */
async function adjustPositionSize(
	adapter: TradingAdapter,
	symbol: string,
	size: number,
	action: 'INCREASE' | 'DECREASE',
	direction: 'LONG' | 'SHORT',
	env: EnvBindings,
	taScore: number,
	indicators: TradingSignal['indicators'],
	price: number,
	targetSize: number,
	currentSize: number,
	intensity: number,
	availableLeverage: number
): Promise<void> {
	const logger = getLogger();
	const ctx = createContext(symbol, 'adjust_position');

	// Check minimum order size
	if (size < POSITION_SIZING_CONFIG.MIN_ORDER_SIZE_USD) {
		logger.warn('Adjustment size below minimum, skipping', ctx, {
			size,
			minSize: POSITION_SIZING_CONFIG.MIN_ORDER_SIZE_USD
		});
		return;
	}

	logger.info(`${action} position`, ctx, {
		direction,
		size,
		currentSize,
		targetSize
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
		if (action === 'INCREASE') {
			// Add to position
			if (direction === 'LONG') {
				await adapter.openLongPosition(symbol, size, options);
			} else {
				if (!adapter.openShortPosition) {
					throw new Error('Adapter does not support short positions');
				}
				await adapter.openShortPosition(symbol, size, options);
			}
		} else {
			// Partial close - convert USD notional to base asset quantity
			const baseAssetQuantity = size / price;
			if (direction === 'LONG') {
				await adapter.closeLongPosition(symbol, baseAssetQuantity, options);
			} else {
				if (!adapter.closeShortPosition) {
					throw new Error('Adapter does not support short positions');
				}
				await adapter.closeShortPosition(symbol, baseAssetQuantity, options);
			}
		}

		logger.info('Position adjusted successfully', ctx, {
			action,
			direction,
			size,
			baseAssetQuantity: action === 'DECREASE' ? size / price : undefined,
			newTargetSize: targetSize
		});

		// Store adjustment signal
		const adjustmentSignal: TradingSignal = {
			symbol,
			timestamp: Date.now(),
			type: 'ADJUSTMENT',
			action,
			direction,
			reason: action === 'INCREASE' ? 'STRENGTHENED_SIGNAL' : 'WEAKENED_SIGNAL',
			taScore,
			threshold: 0,
			price,
			positionSize: size,
			targetSize,
			currentSize,
			indicators,
			intensity,
			availableLeverage
		};
		await storeSignal(env, adjustmentSignal);
	} catch (error) {
		logger.error('Failed to adjust position', error as Error, ctx, {
			action,
			direction,
			size
		});
		throw error;
	}
}

/**
 * Close a position (legacy function for backward compatibility)
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
