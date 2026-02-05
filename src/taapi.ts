import { getAdapter } from './adapters';
import { PaperTradingAdapter } from './adapters/paper';
import { TAAPI_CONFIG, TRADING_CONFIG } from './config';
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
};

type BulkResponseItem<T> = {
	id: string;
	result: T;
	errors: string[];
};

type BulkResponse = {
	data: (
		| BulkResponseItem<Indicators['candle']>
		| BulkResponseItem<Indicators['vwap']>
		| BulkResponseItem<Indicators['atr']>
		| BulkResponseItem<Indicators['bbands']>
		| BulkResponseItem<Indicators['rsi']>
		| BulkResponseItem<Indicators['obv']>
	)[];
};

async function storeDatapoint(
	db: D1Database,
	symbol: string,
	indicator: string,
	timestamp: number,
	data: unknown
) {
	const stmt = db.prepare(
		'INSERT OR REPLACE INTO datapoints (symbol, indicator, timestamp, data) VALUES (?, ?, ?, ?)'
	);
	await stmt.bind(symbol, indicator, timestamp, JSON.stringify(data)).run();
}

// Fetch and store technical indicators from TAAPI
export async function fetchTaapiIndicators(symbol: string, env: EnvBindings) {
	const now = getCurrentTimeframe();
	const timestamp = now.valueOf();

	// Fetch indicators from TAAPI
	const response = await fetch('https://api.taapi.io/bulk', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			secret: env.TAAPI_SECRET,
			construct: {
				exchange: 'binance',
				symbol,
				interval: '5m',
				indicators: [
					{ id: 'candle', indicator: 'candle' },
					{ id: 'vwap', indicator: 'vwap' },
					{ id: 'atr', indicator: 'atr' },
					{ id: 'bbands', indicator: 'bbands' },
					{ id: 'rsi', indicator: 'rsi' },
					{ id: 'obv', indicator: 'obv' }
				]
			}
		})
	});

	const { data: bulkData } = (await response.json()) as BulkResponse;

	// Store each indicator
	await Promise.all(
		bulkData.map(async (item) => {
			console.log(`[${symbol}]`, `[${item.id}]`, item.result);
			await storeDatapoint(env.DB, symbol, item.id, timestamp, item.result);
		})
	);
}

export async function fetchHistoricalData(db: D1Database, symbol: string) {
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
	const results = await stmt
		.bind(symbol, currentTimeframe.valueOf(), TAAPI_CONFIG.HISTORY_LIMIT, symbol)
		.all<{
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

			// Extract all values that will be used
			const values = [
				// Candle data
				data.candle.open,
				data.candle.high,
				data.candle.low,
				data.candle.close,
				data.candle.volume,
				// Other indicators
				data.vwap.value,
				data.atr.value,
				data.bbands.valueUpperBand,
				data.bbands.valueMiddleBand,
				data.bbands.valueLowerBand,
				data.rsi.value,
				data.obv.value
			];

			// Check for any invalid values
			const hasInvalidValue = values.some((v) => v === undefined);

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
		obvs
	};
}

// Get historical data and analyze
export async function analyzeMarketData(env: EnvBindings, symbol: string) {
	const { currentPrice, vwap, bbandsUpper, bbandsLower, rsi, prices, obvs } =
		await fetchHistoricalData(env.DB, symbol);

	// Create the adapter instance based on config
	const adapter = getAdapter(env);

	// Set current price if using paper trading
	if (TRADING_CONFIG.ADAPTER === 'paper') {
		(adapter as PaperTradingAdapter).setCurrentPrice(currentPrice);
	}

	await analyzeForecast(
		adapter,
		env,
		symbol,
		currentPrice,
		vwap,
		bbandsUpper,
		bbandsLower,
		rsi,
		prices,
		obvs
	);
}

// Update indicators for all symbols
export async function updateIndicators(env: EnvBindings): Promise<void> {
	// Fetch indicators for all supported symbols in parallel
	await Promise.all(
		TRADING_CONFIG.SUPPORTED_SYMBOLS.map((symbol) => fetchTaapiIndicators(symbol, env))
	);
}
