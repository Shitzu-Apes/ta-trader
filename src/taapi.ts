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
		await storeDatapoint(env.DB, symbol, item.id, timestamp, item.result);
	});

	await Promise.all(storePromises);

	logger.info('Successfully stored all indicators', ctx, {
		indicatorsCount: indicators.length,
		timestamp
	});
}

// Helper function to create TAAPI construct for a symbol
function createTaapiConstruct(taapiSymbol: string) {
	return {
		exchange: 'binance',
		symbol: taapiSymbol,
		interval: '5m',
		indicators: [
			// Note: No custom 'id' fields - let TAAPI generate auto-prefixed IDs
			// like "binance_BTC/USDT_5m_candle_0" which we can filter by symbol
			{ indicator: 'candle' },
			{ indicator: 'vwap' },
			{ indicator: 'atr' },
			{ indicator: 'bbands' },
			{ indicator: 'rsi' },
			{ indicator: 'obv' }
		]
	};
}

// Internal function to fetch indicators for a single symbol from TAAPI response
function parseSingleSymbolIndicators(
	bulkData: BulkResponse['data'],
	taapiSymbol: string
): BulkResponse['data'] {
	// Filter indicators that belong to this symbol
	// Response IDs are formatted like: "binance_BTC/USDT_5m_candle_0"
	const prefix = `binance_${taapiSymbol}_5m_`;

	return bulkData
		.filter((item) => item.id.startsWith(prefix))
		.map((item) => ({
			...item,
			// Strip the prefix to get clean indicator IDs
			id: item.id.replace(prefix, '').replace(/_\d+$/, '')
		}));
}

// Fetch indicators from TAAPI for multiple symbols (batched API call)
export async function fetchTaapiIndicatorsBatch(
	orderlySymbols: PerpSymbol[],
	env: EnvBindings
): Promise<Map<PerpSymbol, { indicators: BulkResponse['data']; timestamp: number }>> {
	const logger = getLogger(env);
	const ctx = createContext(undefined, 'fetch_indicators_batch');
	const now = getCurrentTimeframe();
	const timestamp = now.valueOf();

	// Convert Orderly symbols to TAAPI format
	const symbolMap = new Map<PerpSymbol, string>();
	const constructs = [];

	for (const orderlySymbol of orderlySymbols) {
		const taapiSymbol = ORDERLY_TO_TAAPI_MAP[orderlySymbol];
		if (!taapiSymbol) {
			logger.error('No TAAPI symbol mapping found', undefined, { ...ctx, symbol: orderlySymbol });
			continue;
		}
		symbolMap.set(orderlySymbol, taapiSymbol);
		constructs.push(createTaapiConstruct(taapiSymbol));
	}

	if (constructs.length === 0) {
		throw new Error('No valid symbols to fetch');
	}

	logger.info(`Fetching indicators from TAAPI for ${constructs.length} symbols`, ctx, {
		symbols: orderlySymbols,
		batchSize: constructs.length
	});

	try {
		// Fetch indicators from TAAPI with multiple constructs
		const response = await fetch('https://api.taapi.io/bulk', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				secret: env.TAAPI_SECRET,
				construct: constructs
			})
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`TAAPI API error: ${response.status} - ${errorText}`);
		}

		const { data: bulkData } = (await response.json()) as BulkResponse;

		logger.info(`Received ${bulkData.length} indicators from TAAPI`, ctx, {
			totalIndicators: bulkData.length,
			symbolsCount: constructs.length
		});

		// Parse response and group by symbol
		const results = new Map<PerpSymbol, { indicators: BulkResponse['data']; timestamp: number }>();

		for (const [orderlySymbol, taapiSymbol] of symbolMap) {
			const symbolIndicators = parseSingleSymbolIndicators(bulkData, taapiSymbol);
			results.set(orderlySymbol, { indicators: symbolIndicators, timestamp });
		}

		return results;
	} catch (error) {
		logger.error('Failed to fetch indicators batch', error as Error, ctx);
		throw error;
	}
}

// Fetch indicators from TAAPI without storing (returns raw data)
// Now uses batching internally for single symbol calls
export async function fetchTaapiIndicatorsRaw(
	orderlySymbol: PerpSymbol,
	env: EnvBindings
): Promise<{ indicators: BulkResponse['data']; timestamp: number }> {
	const logger = getLogger(env);
	const ctx = createContext(orderlySymbol, 'fetch_indicators_raw');

	logger.info('Fetching indicators from TAAPI (single symbol)', ctx, { symbol: orderlySymbol });

	try {
		const results = await fetchTaapiIndicatorsBatch([orderlySymbol], env);
		const result = results.get(orderlySymbol);

		if (!result) {
			throw new Error(`No indicators returned for symbol: ${orderlySymbol}`);
		}

		return result;
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

// Check if we have enough historical data for a symbol before opening positions
async function hasEnoughHistoricalData(
	db: D1Database,
	symbol: string,
	minTimestamps: number
): Promise<boolean> {
	const query = `
		SELECT COUNT(DISTINCT timestamp) as count
		FROM datapoints
		WHERE symbol = ?
		AND indicator IN ('candle', 'vwap', 'atr', 'bbands', 'rsi', 'obv')
	`;

	const stmt = db.prepare(query);
	const result = await stmt.bind(symbol).first<{ count: number }>();

	return (result?.count || 0) >= minTimestamps;
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

		// Check if we have enough historical data before opening positions
		const hasEnoughData = await hasEnoughHistoricalData(
			env.DB,
			symbol,
			TRADING_CONFIG.OBV_WINDOW_SIZE
		);
		if (!hasEnoughData) {
			return;
		}

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

// Update indicators for all symbols using batching
export async function updateIndicators(env: EnvBindings): Promise<void> {
	const logger = getLogger(env);
	const ctx = createContext(undefined, 'update_all_indicators');

	logger.info(
		`Starting indicator update for ${TRADING_CONFIG.SUPPORTED_SYMBOLS.length} symbols with batch size ${TAAPI_CONFIG.BATCH_SIZE}`,
		ctx,
		{ symbols: TRADING_CONFIG.SUPPORTED_SYMBOLS, batchSize: TAAPI_CONFIG.BATCH_SIZE }
	);

	// Split symbols into batches based on TAAPI_CONFIG.BATCH_SIZE
	const batches: PerpSymbol[][] = [];
	for (let i = 0; i < TRADING_CONFIG.SUPPORTED_SYMBOLS.length; i += TAAPI_CONFIG.BATCH_SIZE) {
		batches.push(TRADING_CONFIG.SUPPORTED_SYMBOLS.slice(i, i + TAAPI_CONFIG.BATCH_SIZE));
	}

	logger.info(`Split into ${batches.length} batches`, ctx, {
		batchCount: batches.length,
		batchSizes: batches.map((b) => b.length)
	});

	const allResults: { symbol: PerpSymbol; success: boolean; error?: string }[] = [];

	// Process each batch sequentially (to avoid overwhelming TAAPI)
	for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
		const batch = batches[batchIndex];
		const batchCtx = createContext(undefined, `batch_${batchIndex + 1}/${batches.length}`);

		logger.info(`Processing batch ${batchIndex + 1}/${batches.length}`, batchCtx, {
			symbols: batch
		});

		try {
			// Fetch indicators for entire batch in a single API call
			const batchResults = await fetchTaapiIndicatorsBatch(batch, env);

			// Store indicators for each symbol
			for (const [orderlySymbol, { indicators, timestamp }] of batchResults) {
				try {
					await storeIndicators(env, orderlySymbol, timestamp, indicators);
					allResults.push({ symbol: orderlySymbol, success: true });
					logger.info(`Successfully stored indicators for ${orderlySymbol}`, batchCtx);
				} catch (storeError) {
					logger.error(
						`Failed to store indicators for ${orderlySymbol}`,
						storeError as Error,
						batchCtx
					);
					allResults.push({
						symbol: orderlySymbol,
						success: false,
						error: (storeError as Error).message
					});
				}
			}
		} catch (fetchError) {
			logger.error(`Batch ${batchIndex + 1} failed`, fetchError as Error, batchCtx);
			// Mark all symbols in this batch as failed
			for (const symbol of batch) {
				allResults.push({
					symbol,
					success: false,
					error: (fetchError as Error).message
				});
			}
		}

		// Small delay between batches to be nice to TAAPI
		if (batchIndex < batches.length - 1) {
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}

	const successful = allResults.filter((r) => r.success).length;
	const failed = allResults.length - successful;

	logger.info('Indicator update completed', ctx, {
		total: allResults.length,
		successful,
		failed,
		batches: batches.length,
		details: allResults
	});

	if (failed > 0) {
		throw new Error(`Failed to update indicators for ${failed} symbols`);
	}
}
