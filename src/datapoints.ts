import dayjs from 'dayjs';
import { Hono } from 'hono';
import { z } from 'zod';

import { ExchangeType } from './adapters';
import { getAdapter } from './adapters';
import { ALL_PERP_SYMBOLS } from './config';
import { getSignals, getLatestSignal } from './signals';
import { EnvBindings } from './types';

const app = new Hono<{ Bindings: EnvBindings }>();

const symbolSchema = z.enum(ALL_PERP_SYMBOLS as [string, ...string[]]);
const indicatorSchema = z.enum(['candle', 'vwap', 'atr', 'bbands', 'rsi', 'obv'] as const);

type DataPoint = {
	id: number;
	symbol: string;
	indicator: string;
	timestamp: number;
	data: string;
	created_at: string;
};

// Cache for position history to avoid repeated API calls
// Key: symbol (or 'all'), Value: { data: history[], timestamp: number }
const positionHistoryCache = new Map<
	string,
	{
		history: Array<{
			symbol: string;
			side: 'LONG' | 'SHORT';
			size: number;
			entryPrice: number;
			exitPrice: number;
			realizedPnl: number;
			openedAt: number;
			closedAt: number;
		}>;
		timestamp: number;
	}
>();

const CACHE_TTL_MS = 30000; // 30 seconds

// Helper function to get the current 5-minute timeframe
export function getCurrentTimeframe() {
	const now = dayjs();
	const minutes = now.minute();
	const currentTimeframe = Math.floor(minutes / 5) * 5;
	return now.startOf('hour').add(currentTimeframe, 'minute');
}

// Get historical data with optional time range
app.get('/history/:symbol/:indicator', async (c) => {
	const symbol = c.req.param('symbol');
	const indicator = c.req.param('indicator');

	if (!symbolSchema.safeParse(symbol).success || !indicatorSchema.safeParse(indicator).success) {
		return c.json({ error: 'Invalid symbol or indicator' }, 400);
	}

	const limit = Number(c.req.query('limit') ?? '100');
	if (isNaN(limit) || limit < 1 || limit > 1000) {
		return c.json({ error: 'Invalid limit. Must be between 1 and 1000' }, 400);
	}

	// Optional time range filtering
	const from = c.req.query('from');
	const to = c.req.query('to');
	let fromTimestamp: number | undefined;
	let toTimestamp: number | undefined;

	if (from) {
		const fromDate = dayjs(from);
		if (!fromDate.isValid()) {
			return c.json({ error: 'Invalid from date' }, 400);
		}
		fromTimestamp = fromDate.valueOf();
	}

	if (to) {
		const toDate = dayjs(to);
		if (!toDate.isValid()) {
			return c.json({ error: 'Invalid to date' }, 400);
		}
		toTimestamp = toDate.valueOf();
	}

	try {
		let query = 'SELECT * FROM datapoints WHERE symbol = ? AND indicator = ?';
		const params: (string | number)[] = [symbol, indicator];

		if (fromTimestamp) {
			query += ' AND timestamp >= ?';
			params.push(fromTimestamp);
		}

		if (toTimestamp) {
			query += ' AND timestamp <= ?';
			params.push(toTimestamp);
		}

		query += ' ORDER BY timestamp DESC LIMIT ?';
		params.push(limit);

		const stmt = c.env.DB.prepare(query);
		const results = await stmt.bind(...params).all<DataPoint>();

		return c.json({
			symbol,
			indicator,
			data:
				results.results?.map((row) => ({
					timestamp: row.timestamp,
					data: JSON.parse(row.data)
				})) ?? []
		});
	} catch (error) {
		console.error('Error fetching historical data:', error);
		return c.json({ error: 'Internal server error' }, 500);
	}
});

// Get latest data for all indicators of a symbol
app.get('/latest/:symbol', async (c) => {
	const symbol = c.req.param('symbol');

	if (!symbolSchema.safeParse(symbol).success) {
		return c.json({ error: 'Invalid symbol' }, 400);
	}

	const date = getCurrentTimeframe();
	const timestamp = date.valueOf();

	try {
		// First try to get data for the current timeframe
		const stmt = c.env.DB.prepare('SELECT * FROM datapoints WHERE symbol = ? AND timestamp = ?');
		const results = await stmt.bind(symbol, timestamp).all<DataPoint>();

		if (results.results?.length) {
			return c.json({
				symbol,
				timestamp,
				indicators: results.results.reduce(
					(acc, row) => {
						acc[row.indicator] = JSON.parse(row.data);
						return acc;
					},
					{} as Record<string, unknown>
				)
			});
		}

		// Fallback: get the most recent data regardless of timeframe
		const fallbackStmt = c.env.DB.prepare(
			`SELECT * FROM datapoints 
			 WHERE symbol = ? 
			 AND timestamp = (
				 SELECT MAX(timestamp) FROM datapoints WHERE symbol = ?
			 )`
		);
		const fallbackResults = await fallbackStmt.bind(symbol, symbol).all<DataPoint>();

		if (!fallbackResults.results?.length) {
			return c.json({ error: 'No data found' }, 404);
		}

		const fallbackTimestamp = fallbackResults.results[0].timestamp;

		return c.json({
			symbol,
			timestamp: fallbackTimestamp,
			indicators: fallbackResults.results.reduce(
				(acc, row) => {
					acc[row.indicator] = JSON.parse(row.data);
					return acc;
				},
				{} as Record<string, unknown>
			)
		});
	} catch (error) {
		console.error('Error fetching latest data for all indicators:', error);
		return c.json({ error: 'Internal server error' }, 500);
	}
});

// Get historical data for all indicators of a symbol
app.get('/history/:symbol', async (c) => {
	const symbol = c.req.param('symbol');

	if (!symbolSchema.safeParse(symbol).success) {
		return c.json({ error: 'Invalid symbol' }, 400);
	}

	const limit = Number(c.req.query('limit') ?? '100');
	if (isNaN(limit) || limit < 1 || limit > 1000) {
		return c.json({ error: 'Invalid limit. Must be between 1 and 1000' }, 400);
	}

	// Optional time range filtering
	const from = c.req.query('from');
	const to = c.req.query('to');
	let fromTimestamp: number | undefined;
	let toTimestamp: number | undefined;

	if (from) {
		const fromDate = dayjs(from);
		if (!fromDate.isValid()) {
			return c.json({ error: 'Invalid from date' }, 400);
		}
		fromTimestamp = fromDate.valueOf();
	}

	if (to) {
		const toDate = dayjs(to);
		if (!toDate.isValid()) {
			return c.json({ error: 'Invalid to date' }, 400);
		}
		toTimestamp = toDate.valueOf();
	}

	try {
		const query = `
			WITH timestamps AS (
				SELECT DISTINCT timestamp
				FROM datapoints
				WHERE symbol = ?
				${fromTimestamp ? 'AND timestamp >= ?' : ''}
				${toTimestamp ? 'AND timestamp <= ?' : ''}
				ORDER BY timestamp DESC
				LIMIT ?
			)
			SELECT d.*
			FROM datapoints d
			INNER JOIN timestamps t ON d.timestamp = t.timestamp
			WHERE d.symbol = ?
			ORDER BY d.timestamp DESC, d.indicator
		`;

		const params: (string | number)[] = [symbol];
		if (fromTimestamp) params.push(fromTimestamp);
		if (toTimestamp) params.push(toTimestamp);
		params.push(limit, symbol);

		const stmt = c.env.DB.prepare(query);
		const results = await stmt.bind(...params).all<DataPoint>();

		if (!results.results?.length) {
			return c.json({ error: 'No data found' }, 404);
		}

		// Group results by timestamp
		const groupedData = results.results.reduce(
			(acc, row) => {
				const timestamp = row.timestamp;
				if (!acc[timestamp]) {
					acc[timestamp] = {};
				}
				acc[timestamp][row.indicator] = JSON.parse(row.data);
				return acc;
			},
			{} as Record<number, Record<string, unknown>>
		);

		// Convert to array and sort by timestamp
		const data = Object.entries(groupedData)
			.map(([timestamp, indicators]) => ({
				timestamp: Number(timestamp),
				indicators
			}))
			.sort((a, b) => b.timestamp - a.timestamp);

		return c.json({
			symbol,
			data
		});
	} catch (error) {
		console.error('Error fetching historical data for all indicators:', error);
		return c.json({ error: 'Internal server error' }, 500);
	}
});

// Get current USDC balance
app.get('/balance', async (c) => {
	try {
		const adapter = getAdapter(c.env);
		const balance = await adapter.getBalance();

		// Calculate daily realized PnL (last 24 hours)
		let dailyPnl = 0;
		try {
			const history = await adapter.getPositionHistory?.(undefined, 1000);
			if (history?.history) {
				const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
				const yesterdayTrades = history.history.filter((pos) => pos.closedAt >= oneDayAgo);
				dailyPnl = yesterdayTrades.reduce((sum, pos) => sum + pos.realizedPnl, 0);
			}
		} catch (e) {
			console.error('Error calculating daily PnL:', e);
		}

		return c.json({
			balance,
			currency: 'USDC',
			dailyPnl
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('Error getting balance:', errorMessage);
		return c.json({ error: 'Internal server error', details: errorMessage }, 500);
	}
});

// Get current position for a symbol
app.get('/position/:symbol', async (c) => {
	const symbol = c.req.param('symbol');

	if (!symbolSchema.safeParse(symbol).success) {
		return c.json({ error: 'Invalid symbol' }, 400);
	}

	try {
		const adapter = getAdapter(c.env);
		const position = await adapter.getPosition(symbol);

		if (!position) {
			return c.json({ error: 'No active position' }, 404);
		}
		return c.json(position);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('Error getting position:', errorMessage);
		return c.json({ error: 'Internal server error', details: errorMessage }, 500);
	}
});

// Get all positions
app.get('/positions', async (c) => {
	try {
		const adapter = getAdapter(c.env);
		const positions = await adapter.getPositions();

		return c.json({
			positions
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('Error getting positions:', errorMessage);
		return c.json({ error: 'Internal server error', details: errorMessage }, 500);
	}
});

// Get position history with pagination
app.get('/position-history', async (c) => {
	try {
		const adapter = getAdapter(c.env);

		// Parse pagination params
		const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
		const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '25', 10)));

		// Get symbol filter (optional)
		const symbol = c.req.query('symbol') ?? undefined;
		const cacheKey = symbol ?? 'all';

		// Check cache first
		const cached = positionHistoryCache.get(cacheKey);
		const now = Date.now();
		let fullHistory: Array<{
			symbol: string;
			side: 'LONG' | 'SHORT';
			size: number;
			entryPrice: number;
			exitPrice: number;
			realizedPnl: number;
			openedAt: number;
			closedAt: number;
		}>;

		if (cached && now - cached.timestamp < CACHE_TTL_MS) {
			// Use cached data
			fullHistory = cached.history;
		} else {
			// Fetch fresh data from Orderly API with max limit of 1000
			const result = await adapter.getPositionHistory?.(symbol, 1000);

			if (!result) {
				return c.json({
					history: [],
					pagination: {
						page,
						limit,
						total: 0,
						totalPages: 0,
						hasNext: false,
						hasPrev: false
					}
				});
			}

			fullHistory = result.history;

			// Update cache
			positionHistoryCache.set(cacheKey, {
				history: fullHistory,
				timestamp: now
			});
		}

		// Calculate pagination from full dataset
		const total = fullHistory.length;
		const totalPages = Math.ceil(total / limit);
		const startIndex = (page - 1) * limit;
		const endIndex = startIndex + limit;
		const paginatedHistory = fullHistory.slice(startIndex, endIndex);

		return c.json({
			history: paginatedHistory,
			pagination: {
				page,
				limit,
				total,
				totalPages,
				hasNext: page < totalPages,
				hasPrev: page > 1
			}
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('Error getting position history:', errorMessage);
		return c.json({ error: 'Internal server error', details: errorMessage }, 500);
	}
});

// Get portfolio summary (balance + positions)
app.get('/portfolio', async (c) => {
	try {
		const adapter = getAdapter(c.env);

		// Get current balance
		const balance = await adapter.getBalance();

		// Get all positions
		const positions = await adapter.getPositions();

		// Calculate daily realized PnL (last 24 hours)
		let dailyPnl = 0;
		try {
			const history = await adapter.getPositionHistory?.(undefined, 1000);
			if (history?.history) {
				const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
				const yesterdayTrades = history.history.filter((pos) => pos.closedAt >= oneDayAgo);
				dailyPnl = yesterdayTrades.reduce((sum, pos) => sum + pos.realizedPnl, 0);
			}
		} catch (e) {
			console.error('Error calculating daily PnL:', e);
		}

		return c.json({
			balance,
			positions,
			dailyPnl
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('Error getting portfolio:', errorMessage);
		return c.json({ error: 'Internal server error', details: errorMessage }, 500);
	}
});

// Close all positions
app.post('/reset', async (c) => {
	try {
		const adapter = getAdapter(c.env);

		// Close all positions via Orderly API
		for (const symbol of symbolSchema.options) {
			try {
				const position = await adapter.getPosition(symbol);
				if (position) {
					const options = { type: ExchangeType.ORDERBOOK, orderType: 'market' as const } as const;
					if (position.isLong) {
						await adapter.closeLongPosition(symbol, position.size, options);
					} else if (adapter.closeShortPosition) {
						await adapter.closeShortPosition(symbol, position.size, options);
					}
				}
			} catch (error) {
				console.error(`Error closing position for ${symbol}:`, error);
			}
		}

		return c.json({
			message: 'All positions closed'
		});
	} catch (error) {
		console.error('Error closing positions:', error);
		return c.json({ error: 'Internal server error' }, 500);
	}
});

// Get logs from KV storage
app.get('/logs', async (c) => {
	try {
		const limit = Number(c.req.query('limit') ?? '50');
		const cursor = c.req.query('cursor');
		const levels = c.req.queries('level');
		const symbol = c.req.query('symbol');
		const operation = c.req.query('operation');
		const from = c.req.query('from');
		const to = c.req.query('to');

		if (isNaN(limit) || limit < 1 || limit > 1000) {
			return c.json({ error: 'Invalid limit. Must be between 1 and 1000' }, 400);
		}

		// Build base WHERE clause without cursor (for total count)
		let baseWhereClause = 'WHERE 1=1';
		const baseParams: (string | number)[] = [];

		if (levels && levels.length > 0) {
			// Support multiple levels via IN clause
			const placeholders = levels.map(() => '?').join(', ');
			baseWhereClause += ` AND level IN (${placeholders})`;
			baseParams.push(...levels);
		}
		if (symbol) {
			baseWhereClause += ' AND symbol = ?';
			baseParams.push(symbol);
		}
		if (operation) {
			baseWhereClause += ' AND operation = ?';
			baseParams.push(operation);
		}
		if (from) {
			baseWhereClause += ' AND timestamp >= ?';
			baseParams.push(parseInt(from));
		}
		if (to) {
			baseWhereClause += ' AND timestamp <= ?';
			baseParams.push(parseInt(to));
		}

		// Get total count (without cursor)
		const countResult = await c.env.DB.prepare(
			`SELECT COUNT(*) as total FROM logs ${baseWhereClause}`
		)
			.bind(...baseParams)
			.first<{ total: number }>();

		// Build data WHERE clause with cursor for pagination
		let dataWhereClause = baseWhereClause;
		const dataParams = [...baseParams];

		if (cursor) {
			// Cursor-based pagination using timestamp
			const cursorTimestamp = parseInt(cursor, 10);
			if (!isNaN(cursorTimestamp)) {
				dataWhereClause += ' AND timestamp < ?';
				dataParams.push(cursorTimestamp);
			}
		}

		// Get logs with pagination (limit + 1 to check for more)
		const fetchLimit = limit + 1;
		const logs = await c.env.DB.prepare(
			`SELECT * FROM logs ${dataWhereClause} ORDER BY timestamp DESC LIMIT ?`
		)
			.bind(...dataParams, fetchLimit)
			.all();

		// Format logs for response
		let formattedLogs =
			logs.results?.map((row: Record<string, unknown>) => ({
				id: row.id,
				timestamp: new Date(row.timestamp as number).toISOString(),
				level: row.level,
				message: row.message,
				requestId: row.request_id,
				symbol: row.symbol,
				operation: row.operation,
				data: row.data ? JSON.parse(row.data as string) : null,
				error: row.error ? JSON.parse(row.error as string) : null,
				createdAt: row.created_at
			})) ?? [];

		// Determine if there's more and get next cursor
		let nextCursor: string | undefined;
		const hasMore = formattedLogs.length > limit;

		if (hasMore) {
			// Remove the extra item we fetched
			formattedLogs = formattedLogs.slice(0, limit);
			// Use the timestamp of the last item as next cursor
			const lastLog = formattedLogs[formattedLogs.length - 1];
			if (lastLog) {
				nextCursor = String(new Date(lastLog.timestamp).getTime());
			}
		}

		return c.json({
			count: formattedLogs.length,
			total: countResult?.total ?? 0,
			logs: formattedLogs,
			pagination: {
				hasMore,
				nextCursor
			}
		});
	} catch (error) {
		console.error('Error fetching logs:', error);
		return c.json({ error: 'Internal server error' }, 500);
	}
});

// Get specific log entry
app.get('/logs/:id', async (c) => {
	try {
		const id = Number(c.req.param('id'));

		if (isNaN(id)) {
			return c.json({ error: 'Invalid log ID' }, 400);
		}

		const row = await c.env.DB.prepare('SELECT * FROM logs WHERE id = ?')
			.bind(id)
			.first<Record<string, unknown>>();

		if (!row) {
			return c.json({ error: 'Log not found' }, 404);
		}

		return c.json({
			id: row.id,
			timestamp: new Date(row.timestamp as number).toISOString(),
			level: row.level,
			message: row.message,
			requestId: row.request_id,
			symbol: row.symbol,
			operation: row.operation,
			data: row.data ? JSON.parse(row.data as string) : null,
			error: row.error ? JSON.parse(row.error as string) : null,
			createdAt: row.created_at
		});
	} catch (error) {
		console.error('Error fetching log:', error);
		return c.json({ error: 'Internal server error' }, 500);
	}
});

// Get trading signals for a symbol with pagination
app.get('/signals/:symbol', async (c) => {
	const symbol = c.req.param('symbol');

	if (!symbolSchema.safeParse(symbol).success) {
		return c.json({ error: 'Invalid symbol' }, 400);
	}

	try {
		const limit = Number(c.req.query('limit') ?? '50');
		const cursor = c.req.query('cursor') ?? undefined;
		const from = c.req.query('from');
		const to = c.req.query('to');
		const type = c.req.query('type') as
			| 'ENTRY'
			| 'EXIT'
			| 'STOP_LOSS'
			| 'TAKE_PROFIT'
			| 'NO_ACTION'
			| 'ADJUSTMENT'
			| 'HOLD'
			| undefined;

		if (isNaN(limit) || limit < 1 || limit > 100) {
			return c.json({ error: 'Invalid limit. Must be between 1 and 100' }, 400);
		}

		const result = await getSignals(c.env, symbol, {
			limit,
			cursor,
			from: from ? parseInt(from) : undefined,
			to: to ? parseInt(to) : undefined,
			type
		});

		return c.json({
			symbol,
			count: result.signals.length,
			totalCount: result.totalCount,
			signals: result.signals,
			pagination: {
				hasMore: !!result.nextCursor,
				nextCursor: result.nextCursor
			}
		});
	} catch (error) {
		console.error('Error fetching signals:', error);
		return c.json({ error: 'Internal server error' }, 500);
	}
});

// Get latest trading signal for a symbol
app.get('/signals/:symbol/latest', async (c) => {
	const symbol = c.req.param('symbol');

	if (!symbolSchema.safeParse(symbol).success) {
		return c.json({ error: 'Invalid symbol' }, 400);
	}

	try {
		const signal = await getLatestSignal(c.env, symbol);

		if (!signal) {
			return c.json({ error: 'No signals found' }, 404);
		}

		return c.json({
			symbol,
			signal
		});
	} catch (error) {
		console.error('Error fetching latest signal:', error);
		return c.json({ error: 'Internal server error' }, 500);
	}
});

export default app;
