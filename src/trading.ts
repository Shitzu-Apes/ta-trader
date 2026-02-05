import { ExchangeType, TradingAdapter } from './adapters';
import { TRADING_CONFIG } from './config';
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

	console.log(
		`[${symbol}] [trade] OBV analysis:`,
		`Price slope=${normalizedPriceSlope.toFixed(4)}`,
		`OBV slope=${normalizedObvSlope.toFixed(4)}`
	);

	// Calculate divergence score
	return detectSlopeDivergence(
		normalizedPriceSlope,
		normalizedObvSlope,
		TRADING_CONFIG.SLOPE_THRESHOLD
	);
}

/**
 * Calculate profit score based on current position
 * Returns a score that encourages closing profitable positions:
 * - For longs: negative score when in profit (to encourage closing)
 * - For shorts: positive score when in profit (to encourage closing)
 * This way the profit score pushes against the position's direction when profitable
 */
function calculateProfitScore(position: Position, currentPrice: number): number {
	if (!position || position.partials.length === 0) return 0;

	// Calculate average entry price
	const totalSize = position.size;
	const weightedSum = position.partials.reduce(
		(sum, partial) => sum + partial.size * partial.entryPrice,
		0
	);
	const avgEntryPrice = weightedSum / totalSize;

	// Calculate profit percentage
	const profitPct = (currentPrice - avgEntryPrice) / avgEntryPrice;

	// For longs: return negative score when profitable (to encourage closing)
	// For shorts: return positive score when profitable (to encourage closing)
	if (position.isLong) {
		return profitPct > 0 ? -profitPct : 0;
	} else {
		return profitPct < 0 ? -profitPct : 0;
	}
}

/**
 * Calculate time decay score based on position age
 * Returns a negative score that increases with time
 */
function calculateTimeDecayScore(openedAt: number): number {
	const ageInMinutes = Math.floor((Date.now() - openedAt) / (1000 * 60));
	return -ageInMinutes * TRADING_CONFIG.TIME_DECAY_MULTIPLIER;
}

/**
 * Calculate signal based on technical indicators
 * Returns an array of scores, one for each partial position
 * For no position, returns a single score
 */
function calculateTaScores(
	symbol: string,
	position: Position | null,
	currentPrice: number,
	vwap: number,
	bbandsUpper: number,
	bbandsLower: number,
	rsi: number,
	prices: number[],
	obvs: number[]
): number[] {
	// Calculate base scores
	const vwapScore = calculateVwapScore(currentPrice, vwap);
	const bbandsScore = calculateBBandsScore(currentPrice, bbandsUpper, bbandsLower);
	const rsiScore = calculateRsiScore(rsi);
	const obvScore = calculateObvScore(symbol, prices, obvs);
	const profitScore = position ? calculateProfitScore(position, currentPrice) : 0;

	// Log individual scores
	console.log(
		`[${symbol}] [trade] Individual scores:`,
		`VWAP=${(vwapScore * TRADING_CONFIG.VWAP_MULTIPLIER).toFixed(4)}`,
		`BBands=${(bbandsScore * TRADING_CONFIG.BBANDS_MULTIPLIER).toFixed(4)}`,
		`RSI=${(rsiScore * TRADING_CONFIG.RSI_MULTIPLIER).toFixed(4)}`,
		`OBV=${(obvScore * TRADING_CONFIG.OBV_DIVERGENCE_MULTIPLIER).toFixed(4)}`,
		`Profit=${(profitScore * TRADING_CONFIG.PROFIT_SCORE_MULTIPLIER).toFixed(4)}`
	);

	// For each partial position (or just once for new position)
	const numScores = position ? position.partials.length : 1;
	const scores: number[] = [];

	for (let i = 0; i < numScores; i++) {
		let total =
			vwapScore * TRADING_CONFIG.VWAP_MULTIPLIER +
			bbandsScore * TRADING_CONFIG.BBANDS_MULTIPLIER +
			rsiScore * TRADING_CONFIG.RSI_MULTIPLIER +
			obvScore * TRADING_CONFIG.OBV_DIVERGENCE_MULTIPLIER +
			profitScore * TRADING_CONFIG.PROFIT_SCORE_MULTIPLIER;

		// Add time decay score for existing positions
		if (position && position.partials[i]) {
			const timeDecayScore = calculateTimeDecayScore(position.partials[i].openedAt);
			total += timeDecayScore;
			console.log(`[trade] Time decay score for partial #${i + 1}: ${timeDecayScore.toFixed(4)}`);
		}

		scores.push(total);
	}

	return scores;
}

export type PartialPosition = {
	size: number;
	entryPrice: number;
	openedAt: number;
};

export type Position = {
	symbol: string;
	size: number; // Total position size (sum of partial positions)
	isLong: boolean; // Whether this is a long position
	lastUpdateTime: number;
	cumulativePnl: number;
	successfulTrades: number;
	totalTrades: number;
	partials: PartialPosition[]; // Array of partial positions
};

export async function getPosition(env: EnvBindings, symbol: string): Promise<Position | null> {
	const key = `paper:position:${symbol}`;
	return env.KV.get<Position>(key, 'json');
}

export async function updatePosition(env: EnvBindings, position: Position): Promise<void> {
	const key = `paper:position:${position.symbol}`;
	await env.KV.put(key, JSON.stringify(position));
}

// Helper function to calculate weighted average entry price
function calculateAverageEntryPrice(partials: PartialPosition[]): number {
	let totalValue = 0;
	let totalSize = 0;
	for (const partial of partials) {
		totalValue += partial.size * partial.entryPrice;
		totalSize += partial.size;
	}
	return totalValue / totalSize;
}

export async function closePosition(
	adapter: TradingAdapter,
	env: EnvBindings,
	symbol: string,
	size: number
): Promise<void> {
	const position = await getPosition(env, symbol);
	if (!position) return;

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

	// Close position using adapter
	if (position.isLong) {
		await adapter.closeLongPosition(symbol, size, options);
	} else {
		if (!adapter.closeShortPosition) {
			throw new Error('Adapter does not support short positions');
		}
		await adapter.closeShortPosition(symbol, size, options);
	}
}

/**
 * Get actual price from the adapter based on position size
 * Uses a default amount of 100 USDC if balance is zero
 */
async function getActualPrice(adapter: TradingAdapter, symbol: string): Promise<number> {
	const balance = await adapter.getBalance();
	const amountToUse = balance <= 0 ? 100 : balance;

	const nextPositionSize = calculateNextPositionSize(amountToUse, 0);
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

	const result = await adapter.getExpectedTradeReturn(
		symbol,
		nextPositionSize,
		true,
		true,
		options
	);

	// Use adapter's price method if available, otherwise calculate from the trade
	try {
		return await adapter.getPrice(symbol, nextPositionSize);
	} catch {
		return nextPositionSize / result.expectedSize;
	}
}

// Helper function to get thresholds based on partial positions and position type
function getThresholds(
	position: Position | null,
	partialIndex?: number,
	isLong?: boolean
): { buy: number; sell: number } {
	// For new positions or specific partial index, use that index
	const index = partialIndex ?? position?.partials.length ?? 0;

	// If index exists in thresholds, use it, otherwise use first threshold
	const thresholds =
		TRADING_CONFIG.PARTIAL_POSITION_THRESHOLDS[index] ??
		TRADING_CONFIG.PARTIAL_POSITION_THRESHOLDS[0];

	// For existing positions, use their direction
	// For new positions, use the provided direction or default to long
	const useThresholds = position
		? position.isLong
			? thresholds.long
			: thresholds.short
		: isLong === undefined
			? thresholds.long
			: isLong
				? thresholds.long
				: thresholds.short;

	return useThresholds;
}

// Helper function to calculate next position size
function calculateNextPositionSize(balance: number, partialCount: number): number {
	// If we've reached the maximum number of partial positions, return 0
	if (partialCount >= TRADING_CONFIG.PARTIAL_POSITION_THRESHOLDS.length) {
		return 0;
	}

	// If this is the last available position, use all remaining balance
	const remainingPositions = TRADING_CONFIG.PARTIAL_POSITION_THRESHOLDS.length - partialCount;
	if (remainingPositions === 1) {
		return balance;
	}

	// Otherwise, split the balance evenly among remaining positions
	return balance / remainingPositions;
}

// Helper function to check if a partial position should be closed
function shouldClosePartial(
	partial: PartialPosition,
	currentPrice: number,
	partialIndex: number,
	thresholds: { buy: number; sell: number }
): boolean {
	const priceDiff = (currentPrice - partial.entryPrice) / partial.entryPrice;

	// Check stop loss first
	if (priceDiff <= TRADING_CONFIG.STOP_LOSS_THRESHOLD) {
		console.log(
			`[trade] Stop loss triggered for partial #${partialIndex + 1}:`,
			`Entry=${partial.entryPrice}`,
			`Current=${currentPrice}`,
			`Diff=${(priceDiff * 100).toFixed(4)}%`
		);
		return true;
	}

	// Check take profit
	if (priceDiff >= TRADING_CONFIG.TAKE_PROFIT_THRESHOLD) {
		console.log(
			`[trade] Take profit triggered for partial #${partialIndex + 1}:`,
			`Entry=${partial.entryPrice}`,
			`Current=${currentPrice}`,
			`Diff=${(priceDiff * 100).toFixed(4)}%`
		);
		return true;
	}

	// Check sell threshold based on position index
	if (priceDiff < thresholds.sell) {
		console.log(
			`[trade] Sell threshold triggered for partial #${partialIndex + 1}:`,
			`Entry=${partial.entryPrice}`,
			`Current=${currentPrice}`,
			`Diff=${(priceDiff * 100).toFixed(4)}%`,
			`Threshold=${thresholds.sell}`
		);
		return true;
	}

	return false;
}

/**
 * Analyze market data and decide trading action
 */
export async function analyzeForecast(
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
	// Get current position if it exists
	const currentPosition = await getPosition(env, symbol);
	const partialCount = currentPosition?.partials.length ?? 0;

	// Get actual price from adapter
	const actualPrice = await getActualPrice(adapter, symbol);
	if (!actualPrice) {
		console.log(`[${symbol}] [trade] Failed to get actual price`);
		return;
	}

	// Get thresholds based on partial positions
	const thresholds = getThresholds(currentPosition);

	console.log(`[${symbol}] [trade] Price:`, `Current=${currentPrice}`, `Actual=${actualPrice}`);

	// Calculate technical analysis scores
	const taScores = calculateTaScores(
		symbol,
		currentPosition,
		actualPrice,
		vwap,
		bbandsUpper,
		bbandsLower,
		rsi,
		prices,
		obvs
	);

	// Calculate total scores for each partial position
	const totalScores = currentPosition
		? currentPosition.partials.map((_, index) => taScores[index])
		: [taScores[0]];

	console.log(
		`[${symbol}] [trade] Scores:`,
		...totalScores.map(
			(score, i) => `Total #${i + 1}=${score.toFixed(4)} (TA=${taScores[i].toFixed(4)})`
		)
	);

	// Check if any partial positions need to be closed
	if (currentPosition && currentPosition.partials.length > 0) {
		const position = currentPosition; // Create local reference that's definitely not null
		const partialsToClose: number[] = [];

		position.partials.forEach((partial: PartialPosition, index: number) => {
			const thresholds = getThresholds(position, index);
			if (
				totalScores[index] < thresholds.sell ||
				shouldClosePartial(partial, currentPrice, index, thresholds)
			) {
				partialsToClose.push(index);
			}
		});

		// If any partials need to be closed
		if (partialsToClose.length > 0) {
			console.log(
				`[${symbol}] [trade] Closing ${partialsToClose.length} partial positions:`,
				partialsToClose.map((i) => `#${i + 1}`).join(', ')
			);

			// Calculate total size to close
			const sizeToClose = partialsToClose.reduce(
				(sum, index) => sum + position.partials[index].size,
				0
			);

			// Calculate expected USDC amount for the closing size
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

			const result = await adapter.getExpectedTradeReturn(
				symbol,
				sizeToClose,
				position.isLong,
				false,
				options
			);

			// Calculate PnL for closing partials
			const closingPnl = partialsToClose.reduce((sum, index) => {
				const partial = position.partials[index];
				const partialValue = (result.expectedSize * partial.size) / sizeToClose;
				const pnl = position.isLong
					? partialValue - partial.size * partial.entryPrice
					: partial.size * partial.entryPrice - partialValue;
				return sum + pnl;
			}, 0);

			console.log(
				`[${symbol}] [trade] Closing PnL: ${closingPnl} USDC`,
				`Size=${sizeToClose}`,
				`Expected USDC=${result.expectedSize}`
			);

			// If closing all positions
			if (partialsToClose.length === position.partials.length) {
				await closePosition(adapter, env, symbol, sizeToClose);
				return;
			}

			// Otherwise, update the position
			const remainingPartials = position.partials.filter(
				(_, index) => !partialsToClose.includes(index)
			);
			const newSize = remainingPartials.reduce((sum, p) => sum + p.size, 0);

			const updatedPosition: Position = {
				...position,
				size: newSize,
				lastUpdateTime: Date.now(),
				partials: remainingPartials,
				cumulativePnl: position.cumulativePnl + closingPnl,
				totalTrades: position.totalTrades + 1,
				successfulTrades: position.successfulTrades + (closingPnl > 0 ? 1 : 0)
			};

			// Update USDC balance
			// Balance update is now handled by the adapter's close position methods
			await updatePosition(env, updatedPosition);

			const marketInfo = await adapter.getMarketInfo(symbol);
			console.log(
				`[${symbol}] [trade] Position update:`,
				`Added=${sizeToClose} ${marketInfo.baseToken}`,
				`Value=${sizeToClose * actualPrice} USDC`,
				`Remaining Balance=${await adapter.getBalance()} USDC`
			);
		}
	}

	// Check if we should open a new position or add a partial
	if (Math.abs(totalScores[0]) > thresholds.buy) {
		// Determine if we should go long or short based on score sign
		const goLong = totalScores[0] > 0;

		// Get correct thresholds for the direction
		const directionThresholds = getThresholds(null, 0, goLong);

		// Verify the score exceeds the directional threshold
		if (Math.abs(totalScores[0]) <= Math.abs(directionThresholds.buy)) {
			console.log(
				`[${symbol}] [trade] Score ${totalScores[0]} does not exceed ${directionThresholds.buy} threshold for ${goLong ? 'long' : 'short'}`
			);
			return;
		}

		// Check if we can add more partial positions
		if (partialCount >= TRADING_CONFIG.PARTIAL_POSITION_THRESHOLDS.length) {
			console.log(
				`[${symbol}] [trade] Maximum number of partial positions (${TRADING_CONFIG.PARTIAL_POSITION_THRESHOLDS.length}) reached`
			);
			return;
		}

		// Opening logic for new position or additional partial
		const balance = await adapter.getBalance();
		if (balance <= 0) {
			console.log(`[${symbol}] [trade] Insufficient balance: ${balance} USDC`);
			return;
		}

		// Calculate size for next partial position
		const nextPositionSize = calculateNextPositionSize(balance, partialCount);
		if (nextPositionSize === 0) {
			console.log(`[${symbol}] [trade] Maximum number of partial positions reached`);
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

		const result = await adapter.getExpectedTradeReturn(
			symbol,
			nextPositionSize,
			goLong,
			true,
			options
		);
		const size = result.expectedSize;

		if (currentPosition) {
			// Only add to position if same direction
			if (currentPosition.isLong !== goLong) {
				console.log(`[${symbol}] [trade] Cannot add to position: opposite direction`);
				return;
			}

			// Add a new partial to existing position
			console.log(`[${symbol}] [trade] Opening additional partial position #${partialCount + 1}`);
			const newPartial: PartialPosition = {
				size,
				entryPrice: actualPrice,
				openedAt: Date.now()
			};

			const updatedPosition: Position = {
				...currentPosition,
				size: currentPosition.size + size,
				lastUpdateTime: Date.now(),
				partials: [...currentPosition.partials, newPartial]
			};

			// Update USDC balance
			// Balance update is now handled by the adapter's close position methods
			await updatePosition(env, updatedPosition);

			const marketInfo = await adapter.getMarketInfo(symbol);
			console.log(
				`[${symbol}] [trade] Position update:`,
				`Added=${size} ${marketInfo.baseToken}`,
				`Value=${size * actualPrice} USDC`,
				`Remaining Balance=${await adapter.getBalance()} USDC`
			);
		} else {
			// Get previous trading stats
			const statsKey = `stats:${symbol}`;
			const stats = await env.KV.get<{
				cumulativePnl: number;
				successfulTrades: number;
				totalTrades: number;
			}>(statsKey, 'json');

			// Open new position with first partial
			console.log(`[${symbol}] [trade] Opening first ${goLong ? 'long' : 'short'} position`);
			const firstPartial: PartialPosition = {
				size,
				entryPrice: actualPrice,
				openedAt: Date.now()
			};

			const newPosition: Position = {
				symbol,
				size,
				isLong: goLong,
				lastUpdateTime: Date.now(),
				cumulativePnl: stats?.cumulativePnl ?? 0,
				successfulTrades: stats?.successfulTrades ?? 0,
				totalTrades: stats?.totalTrades ?? 0,
				partials: [firstPartial]
			};

			// Update USDC balance
			// Balance update is now handled by the adapter's close position methods
			await updatePosition(env, newPosition);

			const marketInfo = await adapter.getMarketInfo(symbol);
			console.log(
				`[${symbol}] [trade] Position update:`,
				`Added=${size} ${marketInfo.baseToken}`,
				`Value=${size * actualPrice} USDC`,
				`Remaining Balance=${await adapter.getBalance()} USDC`
			);
		}
		return;
	}

	// Display current position state if it exists
	if (currentPosition && currentPosition.partials.length > 0) {
		const position = currentPosition;
		console.log(
			`[${symbol}] [trade] Current position:`,
			`Total Size=${position.size}`,
			`Partials=${position.partials.length}/${TRADING_CONFIG.PARTIAL_POSITION_THRESHOLDS.length}`
		);
		position.partials.forEach((partial: PartialPosition, index: number) => {
			console.log(
				`[${symbol}] [trade] Partial #${index + 1}:`,
				`Size=${partial.size}`,
				`Entry=${partial.entryPrice}`,
				`Age=${Math.floor((Date.now() - partial.openedAt) / (1000 * 60))}min`
			);
		});
	} else {
		console.log(`[${symbol}] [trade] No position to hold`);
	}
}

// Update position with current market data
export async function updatePositionPnL(
	adapter: TradingAdapter,
	env: EnvBindings,
	symbol: string
): Promise<void> {
	const position = await getPosition(env, symbol);
	if (!position) return;

	// Calculate expected USDC amount from the swap
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

	const result = await adapter.getExpectedTradeReturn(symbol, position.size, true, false, options);
	const avgEntryPrice = calculateAverageEntryPrice(position.partials);
	const unrealizedPnl = result.expectedSize - position.size * avgEntryPrice;

	console.log(
		`[${symbol}] [trade] Unrealized PnL: ${unrealizedPnl} USDC`,
		`Expected USDC: ${result.expectedSize}`
	);

	position.lastUpdateTime = Date.now();
	await updatePosition(env, position);
}
