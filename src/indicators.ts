import { TRADING_CONFIG } from './config';

export interface TaScores {
	vwap: number;
	bbands: number;
	rsi: number;
	obv: number;
	total: number;
}

/**
 * Calculate slope using linear regression
 */
export function calculateSlope(values: number[], windowSize: number): number {
	if (values.length < windowSize) {
		return 0;
	}

	const subset = values.slice(-windowSize);
	let sumX = 0;
	let sumY = 0;
	for (let i = 0; i < windowSize; i++) {
		sumX += i;
		sumY += subset[i];
	}
	const xMean = sumX / windowSize;
	const yMean = sumY / windowSize;

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
export function calculateRsiScore(rsi: number): number {
	const centered = rsi - 50;
	return -Math.sign(centered) * Math.pow(Math.abs(centered) / 50, 2);
}

/**
 * Calculate Bollinger Bands score between -1.5 and 1.5
 * - Negative: Price near upper band (bearish)
 * - Positive: Price near lower band (bullish)
 * - Zero: Price in the middle
 * Uses power-based flattening to reduce extreme scores when price breaks bands
 */
export function calculateBBandsScore(
	currentPrice: number,
	upperBand: number,
	lowerBand: number
): number {
	const middleBand = (upperBand + lowerBand) / 2;
	const totalRange = upperBand - lowerBand;
	const pricePosition = (currentPrice - middleBand) / (totalRange / 2);

	// Power-based flattening: reduces extreme scores while preserving direction
	// Exponent 0.7 provides good balance between sensitivity and flattening
	const flattenedPosition = Math.sign(pricePosition) * Math.pow(Math.abs(pricePosition), 0.7);

	return -flattenedPosition * TRADING_CONFIG.BBANDS_MULTIPLIER;
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
export function calculateVwapScore(currentPrice: number, vwap: number): number {
	const vwapDiff = (vwap - currentPrice) / currentPrice;

	if (Math.abs(vwapDiff) <= TRADING_CONFIG.VWAP_THRESHOLD) {
		return 0;
	}

	const additionalPercentage = Math.abs(vwapDiff) - TRADING_CONFIG.VWAP_THRESHOLD;
	const score = additionalPercentage / TRADING_CONFIG.VWAP_THRESHOLD;

	return vwapDiff > 0 ? score : -score;
}

/**
 * Calculate divergence score between price and OBV slopes
 * Returns a score between -1 and 1:
 * - Negative: Bearish divergence (price up, OBV down)
 * - Positive: Bullish divergence (price down, OBV up)
 * - Magnitude indicates strength of divergence
 */
export function detectSlopeDivergence(
	priceSlope: number,
	obvSlope: number,
	threshold: number
): number {
	if (Math.abs(priceSlope) < threshold) {
		return 0;
	}

	const divergenceStrength =
		(priceSlope * -obvSlope) / Math.max(Math.abs(priceSlope), Math.abs(obvSlope));

	const scaleFactor = Math.min(Math.abs(priceSlope) / threshold, 1);

	return divergenceStrength * scaleFactor;
}

/**
 * Calculate OBV score based on divergence
 */
export function calculateObvScore(prices: number[], obvs: number[], _symbol?: string): number {
	const priceSlope = calculateSlope(prices, TRADING_CONFIG.OBV_WINDOW_SIZE);
	const obvSlope = calculateSlope(obvs, TRADING_CONFIG.OBV_WINDOW_SIZE);

	const maxPrice = Math.max(...prices.slice(-TRADING_CONFIG.OBV_WINDOW_SIZE));
	const maxObv = Math.max(...obvs.slice(-TRADING_CONFIG.OBV_WINDOW_SIZE));
	const normalizedPriceSlope = (priceSlope / maxPrice) * 1000;
	const normalizedObvSlope = (obvSlope / maxObv) * 1000;

	return detectSlopeDivergence(
		normalizedPriceSlope,
		normalizedObvSlope,
		TRADING_CONFIG.SLOPE_THRESHOLD
	);
}

/**
 * Calculate total TA score from all indicators
 */
export function calculateTaScore(
	currentPrice: number,
	vwap: number,
	bbandsUpper: number,
	bbandsLower: number,
	rsi: number,
	prices: number[],
	obvs: number[]
): TaScores {
	const vwapScore = calculateVwapScore(currentPrice, vwap);
	const bbandsScore = calculateBBandsScore(currentPrice, bbandsUpper, bbandsLower);
	const rsiScore = calculateRsiScore(rsi);
	const obvScore = calculateObvScore(prices, obvs);

	const total =
		vwapScore * TRADING_CONFIG.VWAP_MULTIPLIER +
		bbandsScore * TRADING_CONFIG.BBANDS_MULTIPLIER +
		rsiScore * TRADING_CONFIG.RSI_MULTIPLIER +
		obvScore * TRADING_CONFIG.OBV_DIVERGENCE_MULTIPLIER;

	return {
		vwap: vwapScore * TRADING_CONFIG.VWAP_MULTIPLIER,
		bbands: bbandsScore * TRADING_CONFIG.BBANDS_MULTIPLIER,
		rsi: rsiScore * TRADING_CONFIG.RSI_MULTIPLIER,
		obv: obvScore * TRADING_CONFIG.OBV_DIVERGENCE_MULTIPLIER,
		total
	};
}

/**
 * Get OBV divergence details for debugging
 */
export function getObvDivergenceDetails(
	prices: number[],
	obvs: number[]
): {
	priceSlope: number;
	obvSlope: number;
	normalizedPriceSlope: number;
	normalizedObvSlope: number;
	score: number;
} {
	const priceSlope = calculateSlope(prices, TRADING_CONFIG.OBV_WINDOW_SIZE);
	const obvSlope = calculateSlope(obvs, TRADING_CONFIG.OBV_WINDOW_SIZE);

	const maxPrice = Math.max(...prices.slice(-TRADING_CONFIG.OBV_WINDOW_SIZE));
	const maxObv = Math.max(...obvs.slice(-TRADING_CONFIG.OBV_WINDOW_SIZE));
	const normalizedPriceSlope = (priceSlope / maxPrice) * 1000;
	const normalizedObvSlope = (obvSlope / maxObv) * 1000;

	const score = detectSlopeDivergence(
		normalizedPriceSlope,
		normalizedObvSlope,
		TRADING_CONFIG.SLOPE_THRESHOLD
	);

	return {
		priceSlope,
		obvSlope,
		normalizedPriceSlope,
		normalizedObvSlope,
		score
	};
}
