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
import { getTradingConfig, HTTP_CONFIG } from './config';
import datapoints from './datapoints';
import { getLogger, resetLogger, createContext, withTiming } from './logger';
import { updateIndicators, analyzeMarketData } from './taapi';
import { checkAndClosePositions } from './trading';
import { EnvBindings } from './types';

dayjs.extend(duration);
dayjs.extend(relativeTime);
dayjs.extend(timezone);
dayjs.extend(utc);

const app = new Hono<Env>();

app.route('/api', datapoints);

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

app.notFound(() => {
	return new Response(null, { status: 404 });
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

		// Check positions for all active symbols
		await Promise.all(
			activeSymbols.map((symbol) =>
				withTiming(
					logger,
					'check_positions',
					() => checkAndClosePositions(adapter, env, symbol),
					createContext(symbol, 'position_check')
				)
			)
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
				ctx.waitUntil(monitorPositions(env));
				break;
		}
	}
};
