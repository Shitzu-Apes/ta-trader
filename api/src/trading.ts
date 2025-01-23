import { FixedNumber } from './FixedNumber';
import { Ref } from './ref';
import { EnvBindings } from './types';

// Symbol info for token addresses
const symbolInfo = {
	'NEAR/USDT': {
		base: 'wrap.near',
		quote: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
		poolId: 5515
	}
} as const;

// Token decimals info
const tokenInfo = {
	'wrap.near': {
		decimals: 24
	},
	'17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1': {
		decimals: 6
	}
} as const;

// Trading algorithm configuration
const TRADING_CONFIG = {
	STOP_LOSS_THRESHOLD: -0.02, // -2% stop loss threshold
	TAKE_PROFIT_THRESHOLD: 0.03, // +3% take profit threshold
	INITIAL_BALANCE: 1000, // Initial USDC balance
	OBV_WINDOW_SIZE: 12, // 1 hour window for slope calculation
	SLOPE_THRESHOLD: 0.1, // Minimum slope difference to consider divergence

	// TA score multipliers
	VWAP_THRESHOLD: 0.01, // 1% threshold for VWAP signals
	VWAP_MULTIPLIER: 0.5, // Base multiplier for VWAP signals
	BBANDS_MULTIPLIER: 1.5, // Bollinger Bands score multiplier
	RSI_MULTIPLIER: 2, // RSI score multiplier
	OBV_DIVERGENCE_MULTIPLIER: 0.8, // OBV divergence score multiplier
	PROFIT_SCORE_MULTIPLIER: 0.75, // Profit-taking score multiplier (per 1% in profit)
	DEPTH_SCORE_MULTIPLIER: 0, // Orderbook depth imbalance score multiplier
	TIME_DECAY_MULTIPLIER: 0.05, // Score reduction per minute for open positions

	// Partial position thresholds
	PARTIAL_POSITION_THRESHOLDS: [{ buy: 2, sell: -0.5 }] as const
} as const;

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
 * Calculate the expected swap outcome
 */
async function calculateSwapOutcome(
	symbol: string,
	amountIn: number,
	isBuy: boolean,
	_env: EnvBindings
): Promise<number> {
	const tokens = symbolInfo[symbol as keyof typeof symbolInfo];
	if (!tokens) {
		throw new Error(`Unsupported symbol: ${symbol}`);
	}

	// For buys: quote -> base (USDT -> NEAR)
	// For sells: base -> quote (NEAR -> USDT)
	const tokenIn = isBuy ? tokens.quote : tokens.base;
	const tokenOut = isBuy ? tokens.base : tokens.quote;
	const decimals = tokenInfo[tokenIn as keyof typeof tokenInfo].decimals;

	// Convert amount to FixedNumber with proper decimals
	const fixedAmount = new FixedNumber(BigInt(Math.floor(amountIn * 10 ** decimals)), decimals);

	// Get expected return from REF
	const expectedReturn = await Ref.getSmartRouterReturn({
		tokenIn,
		amountIn: fixedAmount,
		tokenOut,
		decimals: tokenInfo[tokenOut as keyof typeof tokenInfo].decimals
	});

	return expectedReturn.toNumber();
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
 * - Zero: Within threshold
 */
function calculateVwapScore(currentPrice: number, vwap: number): number {
	const vwapDiff = (vwap - currentPrice) / currentPrice;

	if (Math.abs(vwapDiff) <= TRADING_CONFIG.VWAP_THRESHOLD) {
		return 0;
	}

	// Calculate how many additional percentage points above threshold
	const additionalPercentage = Math.abs(vwapDiff) - TRADING_CONFIG.VWAP_THRESHOLD;
	const score = Math.floor(additionalPercentage / TRADING_CONFIG.VWAP_THRESHOLD);

	return vwapDiff > 0 ? score : -score;
}

/**
 * Calculate OBV score based on divergence
 */
function calculateObvScore(prices: number[], obvs: number[]): number {
	const priceSlope = calculateSlope(prices, TRADING_CONFIG.OBV_WINDOW_SIZE);
	const obvSlope = calculateSlope(obvs, TRADING_CONFIG.OBV_WINDOW_SIZE);

	// Divergence occurs when slopes have different signs
	if (Math.sign(priceSlope) !== Math.sign(obvSlope)) {
		// Return negative score for bearish divergence (price up, OBV down)
		// Return positive score for bullish divergence (price down, OBV up)
		return (
			Math.sign(obvSlope) *
			Math.min(Math.abs(priceSlope - obvSlope), TRADING_CONFIG.SLOPE_THRESHOLD)
		);
	}

	return 0;
}

/**
 * Calculate profit score based on current position
 * Only returns a score for positive profits
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

	// Only return score if profit is positive
	return profitPct > 0 ? profitPct : 0;
}

/**
 * Calculate depth score based on order book imbalance
 */
function calculateDepthScore(bidSize: number, askSize: number): number {
	const totalSize = bidSize + askSize;
	if (totalSize === 0) return 0;

	// Calculate bid/ask imbalance (-1 to 1)
	return (bidSize - askSize) / totalSize;
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
	position: Position | null,
	currentPrice: number,
	vwap: number,
	bbandsUpper: number,
	bbandsLower: number,
	rsi: number,
	prices: number[],
	obvs: number[],
	bidSize: number,
	askSize: number
): number[] {
	// Calculate base scores
	const vwapScore = calculateVwapScore(currentPrice, vwap);
	const bbandsScore = calculateBBandsScore(currentPrice, bbandsUpper, bbandsLower);
	const rsiScore = calculateRsiScore(rsi);
	const obvScore = calculateObvScore(prices, obvs);
	const profitScore = position ? calculateProfitScore(position, currentPrice) : 0;
	const depthScore = calculateDepthScore(bidSize, askSize);

	// Log individual scores
	console.log(
		'[trade] Individual scores:',
		`VWAP=${(vwapScore * TRADING_CONFIG.VWAP_MULTIPLIER).toFixed(4)}`,
		`BBands=${(bbandsScore * TRADING_CONFIG.BBANDS_MULTIPLIER).toFixed(4)}`,
		`RSI=${(rsiScore * TRADING_CONFIG.RSI_MULTIPLIER).toFixed(4)}`,
		`OBV=${(obvScore * TRADING_CONFIG.OBV_DIVERGENCE_MULTIPLIER).toFixed(4)}`,
		`Profit=${(profitScore * TRADING_CONFIG.PROFIT_SCORE_MULTIPLIER).toFixed(4)}`,
		`Depth=${(depthScore * TRADING_CONFIG.DEPTH_SCORE_MULTIPLIER).toFixed(4)}`
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
			profitScore * TRADING_CONFIG.PROFIT_SCORE_MULTIPLIER +
			depthScore * TRADING_CONFIG.DEPTH_SCORE_MULTIPLIER;

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
	lastUpdateTime: number;
	cumulativePnl: number;
	successfulTrades: number;
	totalTrades: number;
	partials: PartialPosition[]; // Array of partial positions
};

// Get the current USDC balance
async function getBalance(env: EnvBindings): Promise<number> {
	const balance = await env.KV.get<number>('balance:USDC', 'json');
	return balance ?? TRADING_CONFIG.INITIAL_BALANCE;
}

// Update the USDC balance
async function updateBalance(env: EnvBindings, balance: number): Promise<void> {
	await env.KV.put('balance:USDC', JSON.stringify(balance));
}

export async function getPosition(env: EnvBindings, symbol: string): Promise<Position | null> {
	const key = `position:${symbol}`;
	return env.KV.get<Position>(key, 'json');
}

export async function updatePosition(env: EnvBindings, position: Position): Promise<void> {
	const key = `position:${position.symbol}`;
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
	env: EnvBindings,
	symbol: string,
	expectedUsdcAmount: number
): Promise<void> {
	const key = `position:${symbol}`;
	const position = await getPosition(env, symbol);

	if (position) {
		const avgEntryPrice = calculateAverageEntryPrice(position.partials);
		const closingPnl = expectedUsdcAmount - position.size * avgEntryPrice;
		position.cumulativePnl += closingPnl;
		position.totalTrades += 1;
		if (closingPnl > 0) {
			position.successfulTrades += 1;
		}

		// Update USDC balance
		const currentBalance = await getBalance(env);
		const newBalance = currentBalance + expectedUsdcAmount;

		console.log(
			`[${symbol}] [trade] Closing balance update:`,
			`Current=${currentBalance}`,
			`Expected USDC=${expectedUsdcAmount}`,
			`New=${newBalance}`
		);

		await updateBalance(env, newBalance);

		// Store the final state before deleting
		const statsKey = `stats:${symbol}`;
		await env.KV.put(
			statsKey,
			JSON.stringify({
				cumulativePnl: position.cumulativePnl,
				successfulTrades: position.successfulTrades,
				totalTrades: position.totalTrades
			})
		);
	}

	await env.KV.delete(key);
}

// Update position with current market data
export async function updatePositionPnL(env: EnvBindings, symbol: string): Promise<void> {
	const position = await getPosition(env, symbol);
	if (!position) return;

	// Calculate expected USDC amount from the swap
	const expectedUsdcAmount = await calculateSwapOutcome(symbol, position.size, false, env);
	const avgEntryPrice = calculateAverageEntryPrice(position.partials);
	const unrealizedPnl = expectedUsdcAmount - position.size * avgEntryPrice;

	console.log(
		`[${symbol}] [trade] Unrealized PnL: ${unrealizedPnl} USDC`,
		`Expected USDC: ${expectedUsdcAmount}`
	);

	position.lastUpdateTime = Date.now();
	await updatePosition(env, position);
}

/**
 * Calculate actual price from swap amounts using FixedNumber
 */
function calculateActualPrice(symbol: string, baseAmount: number, quoteAmount: number): number {
	const tokens = symbolInfo[symbol as keyof typeof symbolInfo];
	if (!tokens) {
		throw new Error(`Unsupported symbol: ${symbol}`);
	}

	const baseDecimals = tokenInfo[tokens.base as keyof typeof tokenInfo].decimals;
	const quoteDecimals = tokenInfo[tokens.quote as keyof typeof tokenInfo].decimals;

	const fixedBase = new FixedNumber(
		BigInt(Math.floor(baseAmount * 10 ** baseDecimals)),
		baseDecimals
	);
	const fixedQuote = new FixedNumber(
		BigInt(Math.floor(quoteAmount * 10 ** quoteDecimals)),
		quoteDecimals
	);

	// Price = quote/base (USDT/NEAR)
	return fixedQuote.div(fixedBase).toNumber();
}

// Helper function to get thresholds based on partial positions
function getThresholds(
	position: Position | null,
	partialIndex?: number
): { buy: number; sell: number } {
	// For new positions or specific partial index, use that index
	const index = partialIndex ?? position?.partials.length ?? 0;

	// If index exists in thresholds, use it, otherwise use first threshold
	return (
		TRADING_CONFIG.PARTIAL_POSITION_THRESHOLDS[index] ??
		TRADING_CONFIG.PARTIAL_POSITION_THRESHOLDS[0]
	);
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
	env: EnvBindings,
	symbol: string,
	currentPrice: number,
	vwap: number,
	bbandsUpper: number,
	bbandsLower: number,
	rsi: number,
	prices: number[],
	obvs: number[],
	bidSize: number,
	askSize: number
): Promise<void> {
	// Get current position if it exists
	const currentPosition = await getPosition(env, symbol);
	const partialCount = currentPosition?.partials.length ?? 0;

	// Get actual price from REF
	const actualPrice = await getActualPrice(symbol, env);
	if (!actualPrice) {
		console.log(`[${symbol}] [trade] Failed to get actual price`);
		return;
	}

	// Get thresholds based on partial positions
	const thresholds = getThresholds(currentPosition);

	console.log(`[${symbol}] [trade] Price:`, `Current=${currentPrice}`, `Actual=${actualPrice}`);

	// Calculate technical analysis scores
	const taScores = calculateTaScores(
		currentPosition,
		actualPrice,
		vwap,
		bbandsUpper,
		bbandsLower,
		rsi,
		prices,
		obvs,
		bidSize,
		askSize
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
			const closeUsdcAmount = await calculateSwapOutcome(symbol, sizeToClose, false, env);

			// Calculate PnL for closing partials
			const closingPnl = partialsToClose.reduce((sum, index) => {
				const partial = position.partials[index];
				const partialValue = (closeUsdcAmount * partial.size) / sizeToClose;
				return sum + (partialValue - partial.size * partial.entryPrice);
			}, 0);

			console.log(
				`[${symbol}] [trade] Closing PnL: ${closingPnl} USDC`,
				`Size=${sizeToClose}`,
				`Expected USDC=${closeUsdcAmount}`
			);

			// If closing all positions
			if (partialsToClose.length === position.partials.length) {
				await closePosition(env, symbol, closeUsdcAmount);
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
			const currentBalance = await getBalance(env);
			const newBalance = currentBalance + closeUsdcAmount;
			await updateBalance(env, newBalance);

			await updatePosition(env, updatedPosition);
		}
	}

	// Check if we should open a new position or add a partial
	if (totalScores[0] > thresholds.buy) {
		// Check if we can add more partial positions
		if (partialCount >= TRADING_CONFIG.PARTIAL_POSITION_THRESHOLDS.length) {
			console.log(
				`[${symbol}] [trade] Maximum number of partial positions (${TRADING_CONFIG.PARTIAL_POSITION_THRESHOLDS.length}) reached`
			);
			return;
		}

		// Opening logic for new position or additional partial
		const balance = await getBalance(env);
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

		const expectedNearAmount = await calculateSwapOutcome(symbol, nextPositionSize, true, env);
		const size = expectedNearAmount;

		if (currentPosition) {
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

			await updatePosition(env, updatedPosition);

			// Update USDC balance
			const newBalance = balance - nextPositionSize;
			await updateBalance(env, newBalance);

			console.log(
				`[${symbol}] [trade] Position update:`,
				`Added=${size} ${symbolInfo[symbol as keyof typeof symbolInfo].base}`,
				`Value=${size * actualPrice} USDC`,
				`Remaining Balance=${newBalance} USDC`,
				`Total Partials=${updatedPosition.partials.length}`
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
			console.log(`[${symbol}] [trade] Opening first partial position`);
			const firstPartial: PartialPosition = {
				size,
				entryPrice: actualPrice,
				openedAt: Date.now()
			};

			const newPosition: Position = {
				symbol,
				size,
				lastUpdateTime: Date.now(),
				cumulativePnl: stats?.cumulativePnl ?? 0,
				successfulTrades: stats?.successfulTrades ?? 0,
				totalTrades: stats?.totalTrades ?? 0,
				partials: [firstPartial]
			};

			await updatePosition(env, newPosition);

			// Update USDC balance
			const newBalance = balance - nextPositionSize;
			await updateBalance(env, newBalance);

			console.log(
				`[${symbol}] [trade] Position update:`,
				`Added=${size} ${symbolInfo[symbol as keyof typeof symbolInfo].base}`,
				`Value=${size * actualPrice} USDC`,
				`Remaining Balance=${newBalance} USDC`
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

/**
 * Get actual price from REF based on position size
 * Uses a default amount of 100 USDC if balance is zero
 */
async function getActualPrice(symbol: string, env: EnvBindings): Promise<number | null> {
	const balance = await getBalance(env);
	const amountToUse = balance <= 0 ? 100 : balance;

	const nextPositionSize = calculateNextPositionSize(amountToUse, 0);
	const expectedNearAmount = await calculateSwapOutcome(symbol, nextPositionSize, true, env);
	return calculateActualPrice(symbol, expectedNearAmount, nextPositionSize);
}
