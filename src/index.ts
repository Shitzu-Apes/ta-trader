import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import relativeTime from 'dayjs/plugin/relativeTime';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { Hono, type Env } from 'hono';
import { cors } from 'hono/cors';
import { poweredBy } from 'hono/powered-by';
import type { HTTPResponseError } from 'hono/types';

import { getAdapter } from './adapters';
import { getTradingConfig, HTTP_CONFIG, PerpSymbol, TAAPI_CONFIG } from './config';
import datapoints from './datapoints';
import { getLogger, resetLogger, createContext, withTiming } from './logger';
import {
	updateIndicators,
	analyzeMarketData,
	fetchTaapiIndicatorsBatch,
	Indicators
} from './taapi';
import { checkAndClosePositions, checkSignalReversal } from './trading';
import { EnvBindings } from './types';

// Check if current time is within 30 seconds of a 5-minute boundary
// Returns true if we should skip the 1-minute cron (to avoid collision with 5-minute cron)
function shouldSkip1MinCron(): boolean {
	const now = Date.now();
	const seconds = Math.floor(now / 1000) % 60;
	const minute = Math.floor(now / 1000 / 60) % 5;

	// Check if we're in the danger zone: >4:30 or <0:30 of any 5-minute block
	// minute 4 with seconds > 30, OR minute 0 with seconds < 30
	if (minute === 4 && seconds > 30) return true;
	if (minute === 0 && seconds < 30) return true;

	return false;
}

dayjs.extend(duration);
dayjs.extend(relativeTime);
dayjs.extend(timezone);
dayjs.extend(utc);

const app = new Hono<Env>();

// API routes
app.route('/api', datapoints);

// Config endpoint for dashboard
app.get('/api/config', (c) => {
	const config = getTradingConfig(c.env as EnvBindings);
	return c.json({
		environment: (c.env as EnvBindings).ORDERLY_NETWORK === 'mainnet' ? 'production' : 'testnet',
		activeSymbols: config.ACTIVE_SYMBOLS,
		version: '1.0.0'
	});
});

app.use('*', poweredBy());
app.use(
	'*',
	cors({
		origin: '*',
		credentials: true
	})
);

app.onError(async (err, c) => {
	const logger = getLogger(c.env as EnvBindings);

	if (typeof (err as HTTPResponseError)['getResponse'] !== 'undefined') {
		const httpErr = err as HTTPResponseError;
		const res = httpErr.getResponse();
		const text = await res.clone().text();
		logger.error(`HTTP Error ${res.status}`, httpErr, createContext(undefined, 'http_error'), {
			status: res.status,
			response: text
		});
		await logger.flushNow();
		return res;
	}

	logger.error('Unknown error', err as Error, createContext(undefined, 'unknown_error'));
	await logger.flushNow();
	return new Response(null, {
		status: 500
	});
});

app.notFound(async (c) => {
	// For non-API routes, serve index.html to support SPA routing
	const url = new URL(c.req.url);
	if (!url.pathname.startsWith('/api/')) {
		const env = c.env as EnvBindings;
		const asset = await env.ASSETS.fetch(`${url.origin}/index.html`);
		if (asset.status === 200) {
			const html = await asset.text();
			return c.html(html);
		}
	}
	return c.notFound();
});

async function updateIndicatorsAndTrade(env: EnvBindings) {
	const logger = getLogger(env);
	const ctx = createContext(undefined, 'scheduled_task');

	logger.info('Starting scheduled trading cycle', ctx);

	try {
		// First update indicators for all symbols
		await withTiming(logger, 'update_indicators', () => updateIndicators(env), ctx);

		// Wait for data to be stored
		await new Promise((resolve) => setTimeout(resolve, HTTP_CONFIG.INDICATOR_FETCH_DELAY));

		// Get active symbols for this environment
		const tradingConfig = getTradingConfig(env);
		const activeSymbols = tradingConfig.ACTIVE_SYMBOLS;

		logger.info(`Running market analysis for ${activeSymbols.length} symbols`, ctx, {
			symbols: activeSymbols
		});

		// Run analysis for all active symbols
		await Promise.all(
			activeSymbols.map((symbol) =>
				withTiming(
					logger,
					'analyze_market_data',
					() => analyzeMarketData(env, symbol),
					createContext(symbol, 'market_analysis')
				)
			)
		);

		logger.info('Completed scheduled trading cycle', ctx);
	} catch (error) {
		logger.error('Scheduled trading cycle failed', error as Error, ctx);
		throw error;
	} finally {
		await logger.flushNow();
		resetLogger();
	}
}

async function monitorPositions(env: EnvBindings) {
	const logger = getLogger(env);
	const ctx = createContext(undefined, 'position_monitor');

	logger.info('Starting position monitoring', ctx);

	try {
		const adapter = getAdapter(env);

		// Get active symbols for this environment
		const tradingConfig = getTradingConfig(env);
		const activeSymbols = tradingConfig.ACTIVE_SYMBOLS;

		logger.info(`Monitoring positions for ${activeSymbols.length} symbols`, ctx, {
			symbols: activeSymbols
		});

		// First, check which symbols have open positions and close SL/TP
		const symbolsWithPositions: PerpSymbol[] = [];
		await Promise.all(
			activeSymbols.map(async (symbol) => {
				const position = await adapter.getPosition(symbol);
				if (position) {
					symbolsWithPositions.push(symbol);
					// Check SL/TP immediately
					await withTiming(
						logger,
						'check_positions',
						() => checkAndClosePositions(adapter, env, symbol),
						createContext(symbol, 'position_check')
					);
				}
			})
		);

		// If no positions open, nothing more to do
		if (symbolsWithPositions.length === 0) {
			logger.info('No open positions to monitor for signal reversal', ctx);
			return;
		}

		logger.info(
			`Found ${symbolsWithPositions.length} open positions, fetching fresh indicators for signal reversal check (batch size: ${TAAPI_CONFIG.BATCH_SIZE})`,
			ctx,
			{
				symbols: symbolsWithPositions,
				batchSize: TAAPI_CONFIG.BATCH_SIZE
			}
		);

		// Fetch fresh TA indicators for symbols with open positions using batched API call
		const indicatorResults: Array<{
			symbol: PerpSymbol;
			currentPrice: number;
			vwap: number;
			bbandsUpper: number;
			bbandsLower: number;
			rsi: number;
			obv: number;
		} | null> = [];

		try {
			const batchResults = await fetchTaapiIndicatorsBatch(symbolsWithPositions, env);

			// Process each symbol's indicators from the batch response
			for (const symbol of symbolsWithPositions) {
				const result = batchResults.get(symbol);
				if (!result) {
					logger.error(`No indicators returned for ${symbol}`, undefined, ctx);
					indicatorResults.push(null);
					continue;
				}

				// Parse indicators into the format needed for analysis
				const indicatorMap = new Map(result.indicators.map((item) => [item.id, item.result]));

				const candle = indicatorMap.get('candle') as Indicators['candle'] | undefined;
				const vwap = indicatorMap.get('vwap') as Indicators['vwap'] | undefined;
				const bbands = indicatorMap.get('bbands') as Indicators['bbands'] | undefined;
				const rsi = indicatorMap.get('rsi') as Indicators['rsi'] | undefined;
				const obv = indicatorMap.get('obv') as Indicators['obv'] | undefined;

				indicatorResults.push({
					symbol,
					currentPrice: candle?.close ?? 0,
					vwap: vwap?.value ?? 0,
					bbandsUpper: bbands?.valueUpperBand ?? 0,
					bbandsLower: bbands?.valueLowerBand ?? 0,
					rsi: rsi?.value ?? 0,
					obv: obv?.value ?? 0
				});
			}
		} catch (error) {
			logger.error('Failed to fetch indicators batch for position monitoring', error as Error, ctx);
			// Mark all symbols as failed
			for (let i = 0; i < symbolsWithPositions.length; i++) {
				indicatorResults.push(null);
			}
		}

		// Check signal reversal for each symbol that successfully fetched indicators
		await Promise.all(
			indicatorResults.map(async (result) => {
				if (result) {
					const { symbol, currentPrice, vwap, bbandsUpper, bbandsLower, rsi, obv } = result;

					// For signal reversal, we need historical data (prices and OBVs)
					// Since we only have current values from fresh fetch, we'll use a simplified approach
					// Just pass current values as arrays (signal reversal calculation will work with single values)
					await withTiming(
						logger,
						'check_signal_reversal',
						() =>
							checkSignalReversal(
								adapter,
								env,
								symbol,
								currentPrice,
								vwap,
								bbandsUpper,
								bbandsLower,
								rsi,
								[currentPrice], // Single price point
								[obv] // Single OBV point
							),
						createContext(symbol, 'signal_reversal_check')
					);
				}
			})
		);

		logger.info('Completed position monitoring', ctx);
	} catch (error) {
		logger.error('Position monitoring failed', error as Error, ctx);
		throw error;
	} finally {
		await logger.flushNow();
		resetLogger();
	}
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		return app.fetch(request, env, ctx);
	},
	async scheduled(controller: ScheduledController, env: EnvBindings, ctx: ExecutionContext) {
		switch (controller.cron) {
			case '*/5 * * * *':
				ctx.waitUntil(updateIndicatorsAndTrade(env));
				break;
			case '* * * * *':
				// Skip 1-minute cron if too close to 5-minute boundary to avoid collision
				if (shouldSkip1MinCron()) {
					const logger = getLogger(env);
					logger.info(
						'Skipping 1-minute cron - too close to 5-minute boundary',
						createContext(undefined, 'cron_skip')
					);
					await logger.flushNow();
					resetLogger();
					return;
				}
				ctx.waitUntil(monitorPositions(env));
				break;
		}
	}
};
