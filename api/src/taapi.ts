import { getCurrentTimeframe } from './datapoints';
import { analyzeForecast } from './trading';
import { EnvBindings } from './types';

export type Indicators = {
	candle: {
		open: number;
		high: number;
		low: number;
		close: number;
		volume: number;
	};
	vwap: {
		value: number;
	};
	atr: {
		value: number;
	};
	bbands: {
		valueUpperBand: number;
		valueMiddleBand: number;
		valueLowerBand: number;
	};
	rsi: {
		value: number;
	};
	obv: {
		value: number;
	};
	depth: {
		bid_size: number;
		ask_size: number;
		bid_levels: number;
		ask_levels: number;
	};
	liq_zones: {
		long_size: number;
		short_size: number;
		long_accounts: number;
		short_accounts: number;
		avg_long_price: number;
		avg_short_price: number;
	};
};

export async function fetchHistoricalData(db: D1Database, symbol: string) {
	const HISTORY_LIMIT = 12 * 24 * 7; // 7 days * 24 hours * 12 intervals per hour

	// Get the current 5min interval using the helper function
	const currentTimeframe = getCurrentTimeframe();

	const query = `
		WITH timestamps AS (
			SELECT DISTINCT timestamp
			FROM datapoints
			WHERE symbol = ? 
			AND indicator = 'candle'
			AND timestamp <= ?
			ORDER BY timestamp DESC
			LIMIT ?
		)
		SELECT d.*
		FROM datapoints d
		INNER JOIN timestamps t ON d.timestamp = t.timestamp
		WHERE d.symbol = ?
		ORDER BY d.timestamp ASC, d.indicator
	`;

	const stmt = db.prepare(query);
	const results = await stmt.bind(symbol, currentTimeframe.valueOf(), HISTORY_LIMIT, symbol).all<{
		indicator: string;
		timestamp: number;
		data: string;
	}>();

	if (!results.results?.length) {
		throw new Error('No historical data found');
	}

	// Group data by timestamp
	const groupedData = new Map<number, Record<string, Record<string, number>>>();
	results.results.forEach((row) => {
		if (!groupedData.has(row.timestamp)) {
			groupedData.set(row.timestamp, {});
		}
		groupedData.get(row.timestamp)![row.indicator] = JSON.parse(row.data);
	});

	// Filter timestamps to only include those with complete data
	const completeTimestamps = Array.from(groupedData.keys())
		.filter((ts) => {
			const data = groupedData.get(ts)!;

			// Check for required indicators
			const requiredIndicators = [
				'candle',
				'vwap',
				'atr',
				'bbands',
				'rsi',
				'obv',
				'depth',
				'liq_zones'
			];
			const hasAllIndicators = requiredIndicators.every((indicator) => data[indicator]);
			if (!hasAllIndicators) {
				return false;
			}

			// Extract all values that will be used
			const values = [
				data.candle.open,
				data.candle.high,
				data.candle.low,
				data.candle.close,
				data.candle.volume,
				data.vwap.value,
				data.atr.value,
				data.bbands.valueUpperBand,
				data.bbands.valueMiddleBand,
				data.bbands.valueLowerBand,
				data.rsi.value,
				data.obv.value,
				data.depth.bid_size,
				data.depth.ask_size
			];

			// Check for any invalid values
			const hasInvalidValue = values.some((v) => {
				const isInvalid = v === null || v === undefined || isNaN(v) || !isFinite(v);
				return isInvalid;
			});

			return !hasInvalidValue;
		})
		.sort((a, b) => a - b);

	if (completeTimestamps.length === 0) {
		throw new Error('No complete data found for any timestamp');
	}

	// Extract the latest values for analysis
	const latestData = groupedData.get(completeTimestamps[completeTimestamps.length - 1])!;
	const currentPrice = latestData.candle.close;
	const vwap = latestData.vwap.value;
	const bbandsUpper = latestData.bbands.valueUpperBand;
	const bbandsLower = latestData.bbands.valueLowerBand;
	const rsi = latestData.rsi.value;
	const bidSize = latestData.depth.bid_size;
	const askSize = latestData.depth.ask_size;

	// Get historical prices and OBV values for technical analysis
	const prices = completeTimestamps.map((ts) => groupedData.get(ts)!.candle.close);
	const obvs = completeTimestamps.map((ts) => groupedData.get(ts)!.obv.value);

	return {
		currentPrice,
		vwap,
		bbandsUpper,
		bbandsLower,
		rsi,
		prices,
		obvs,
		bidSize,
		askSize
	};
}

export async function updateIndicators(env: EnvBindings, symbol: string): Promise<void> {
	const { currentPrice, vwap, bbandsUpper, bbandsLower, rsi, prices, obvs, bidSize, askSize } =
		await fetchHistoricalData(env.DB, symbol);

	await analyzeForecast(
		env,
		symbol,
		currentPrice,
		vwap,
		bbandsUpper,
		bbandsLower,
		rsi,
		prices,
		obvs,
		bidSize,
		askSize
	);
}
