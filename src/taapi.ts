import { getAdapter } from './adapters';
import { ORDERLY_TO_TAAPI_MAP, PerpSymbol, TAAPI_CONFIG, TRADING_CONFIG } from './config';
import { getCurrentTimeframe } from './datapoints';
import { getLogger, createContext } from './logger';
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

// Store indicators to D1 database
async function storeIndicators(
	env: EnvBindings,
	symbol: string,
	timestamp: number,
	indicators: BulkResponse['data']
) {
	const logger = getLogger(env);
	const ctx = createContext(symbol, 'store_indicators');

	const storePromises = indicators.map(async (item) => {
		logger.debug(`Storing indicator: ${item.id}`, ctx, { value: item.result });
		await storeDatapoint(env.DB, symbol, item.id, timestamp, item.result);
	});

	await Promise.all(storePromises);

	logger.info('Successfully stored all indicators', ctx, {
		indicatorsCount: indicators.length,
		timestamp
	});
}

// Fetch indicators from TAAPI without storing (returns raw data)
export async function fetchTaapiIndicatorsRaw(
	orderlySymbol: PerpSymbol,
	env: EnvBindings
): Promise<{ indicators: BulkResponse['data']; timestamp: number }> {
	const logger = getLogger(env);
	const ctx = createContext(orderlySymbol, 'fetch_indicators_raw');
	const now = getCurrentTimeframe();
	const timestamp = now.valueOf();

	// Convert Orderly symbol to TAAPI format for the API call
	const taapiSymbol = ORDERLY_TO_TAAPI_MAP[orderlySymbol];
	if (!taapiSymbol) {
		logger.error('No TAAPI symbol mapping found', undefined, ctx);
		throw new Error(`Unknown symbol: ${orderlySymbol}`);
	}

	logger.info('Fetching indicators from TAAPI', ctx, { timestamp, taapiSymbol });

	try {
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
					symbol: taapiSymbol,
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

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`TAAPI API error: ${response.status} - ${errorText}`);
		}

		const { data: bulkData } = (await response.json()) as BulkResponse;

		logger.info(`Received ${bulkData.length} indicators from TAAPI`, ctx);

		return { indicators: bulkData, timestamp };
	} catch (error) {
		logger.error('Failed to fetch indicators', error as Error, ctx);
		throw error;
	}
}

// Fetch and store technical indicators from TAAPI (original behavior for 5min cron)
export async function fetchTaapiIndicators(orderlySymbol: PerpSymbol, env: EnvBindings) {
	const { indicators, timestamp } = await fetchTaapiIndicatorsRaw(orderlySymbol, env);
	await storeIndicators(env, orderlySymbol, timestamp, indicators);
}

export async function fetchHistoricalData(db: D1Database, symbol: string, env?: EnvBindings) {
	const logger = env ? getLogger(env) : null;
	const ctx = createContext(symbol, 'fetch_historical_data');
	const currentTimeframe = getCurrentTimeframe();

	logger?.debug('Fetching historical data from D1', ctx, {
		currentTimeframe: currentTimeframe.valueOf(),
		limit: TAAPI_CONFIG.HISTORY_LIMIT
	});

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
		logger?.error('No historical data found in database', undefined, ctx);
		throw new Error('No historical data found');
	}

	logger?.debug(`Retrieved ${results.results.length} data points`, ctx);

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
				data.candle?.open,
				data.candle?.high,
				data.candle?.low,
				data.candle?.close,
				data.candle?.volume,
				// Other indicators
				data.vwap?.value,
				data.atr?.value,
				data.bbands?.valueUpperBand,
				data.bbands?.valueMiddleBand,
				data.bbands?.valueLowerBand,
				data.rsi?.value,
				data.obv?.value
			];

			// Check for any invalid values
			const hasInvalidValue = values.some((v) => v === undefined || v === null);

			if (hasInvalidValue) {
				logger?.debug(`Skipping incomplete timestamp ${ts}`, ctx, {
					missingIndicators: [
						!data.candle && 'candle',
						!data.vwap && 'vwap',
						!data.atr && 'atr',
						!data.bbands && 'bbands',
						!data.rsi && 'rsi',
						!data.obv && 'obv'
					].filter(Boolean)
				});
			}

			return !hasInvalidValue;
		})
		.sort((a, b) => a - b);

	if (completeTimestamps.length === 0) {
		logger?.error('No complete data found for any timestamp', undefined, ctx);
		throw new Error('No complete data found for any timestamp');
	}

	logger?.info(`Found ${completeTimestamps.length} complete timestamps`, ctx, {
		timeRange: {
			oldest: completeTimestamps[0],
			newest: completeTimestamps[completeTimestamps.length - 1]
		}
	});

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

	logger?.debug('Historical data processed', ctx, {
		currentPrice,
		vwap,
		bbandsUpper,
		bbandsLower,
		rsi,
		historicalDataPoints: prices.length
	});

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
	const logger = getLogger(env);
	const ctx = createContext(symbol, 'market_analysis');

	logger.info('Starting market data analysis', ctx);

	try {
		const { currentPrice, vwap, bbandsUpper, bbandsLower, rsi, prices, obvs } =
			await fetchHistoricalData(env.DB, symbol, env);

		// Create the adapter instance
		const adapter = getAdapter(env);

		// Symbol is already in Orderly format, use directly
		const orderlySymbol = symbol;

		await analyzeForecast(
			adapter,
			env,
			orderlySymbol,
			currentPrice,
			vwap,
			bbandsUpper,
			bbandsLower,
			rsi,
			prices,
			obvs
		);

		logger.info('Market analysis completed', ctx);
	} catch (error) {
		logger.error('Market analysis failed', error as Error, ctx);
		throw error;
	}
}

// Update indicators for all symbols
export async function updateIndicators(env: EnvBindings): Promise<void> {
	const logger = getLogger(env);
	const ctx = createContext(undefined, 'update_all_indicators');

	logger.info(
		`Starting indicator update for ${TRADING_CONFIG.SUPPORTED_SYMBOLS.length} symbols`,
		ctx,
		{ symbols: TRADING_CONFIG.SUPPORTED_SYMBOLS }
	);

	const results = await Promise.allSettled(
		TRADING_CONFIG.SUPPORTED_SYMBOLS.map(async (symbol) => {
			try {
				await fetchTaapiIndicators(symbol, env);
				return { symbol, success: true };
			} catch (error) {
				logger.error(`Failed to fetch indicators for ${symbol}`, error as Error, {
					...ctx,
					symbol
				});
				return { symbol, success: false, error: (error as Error).message };
			}
		})
	);

	const successful = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
	const failed = results.length - successful;

	logger.info('Indicator update completed', ctx, {
		total: results.length,
		successful,
		failed,
		details: results.map((r) =>
			r.status === 'fulfilled' ? r.value : { symbol: 'unknown', success: false, error: r.reason }
		)
	});

	if (failed > 0) {
		throw new Error(`Failed to update indicators for ${failed} symbols`);
	}
}
