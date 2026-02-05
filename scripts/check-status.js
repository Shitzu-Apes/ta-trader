#!/usr/bin/env node

/**
 * TA Trader API Status Checker
 *
 * Fetches and displays positions, balance, portfolio, and other data from the TA Trader API
 * Also integrates with Orderly Indexer API for trade events and historical data
 *
 * Usage:
 *   node scripts/check-status.js [env=testnet|production] [command]
 *
 * Commands:
 *   all                    - Show everything (default)
 *   balance                - Show USDC balance only
 *   positions              - Show all positions
 *   portfolio              - Show portfolio summary
 *   position <symbol>      - Show specific position (e.g., PERP_NEAR_USDC)
 *   price <symbol>         - Show current price for symbol
 *   indicators <symbol>    - Show latest indicators for symbol
 *   history <symbol> [indicator] [limit] - Show historical data
 *   logs [limit]           - Show recent logs
 *   health                 - Quick health check
 *   trades [limit]         - Show recent trades from Orderly Indexer
 *   events [type] [limit]  - Show account events (PERPTRADE, SETTLEMENT, etc.)
 *   funding                - Show funding payments
 *   volume                 - Show trading volume statistics
 *
 * Examples:
 *   node scripts/check-status.js
 *   node scripts/check-status.js testnet positions
 *   node scripts/check-status.js production balance
 *   node scripts/check-status.js testnet trades 20
 *   node scripts/check-status.js testnet events PERPTRADE 10
 */

import { config } from 'dotenv';

// Load environment variables from .env file
config();

const ENV_URLS = {
	testnet: 'https://ta-trader-api-testnet.shrm.workers.dev',
	production: 'https://ta-trader-api.shrm.workers.dev'
};

const INDEXER_URLS = {
	testnet: 'https://dev-orderly-dashboard-query-service.orderly.network',
	production: 'https://orderly-dashboard-query-service.orderly.network'
};

// Get account ID from environment or use default
function getAccountId() {
	return (
		process.env.ORDERLY_ACCOUNT_ID ||
		'0x66079dcb0045e2b765a68cec1f39baed69c934df32b069144a75d45c8f597463'
	);
}

// Parse command line arguments
function parseArgs() {
	const args = process.argv.slice(2);
	let env = 'testnet';
	let command = 'all';
	let params = [];

	// First argument could be environment or command
	if (args.length > 0) {
		if (args[0] === 'testnet' || args[0] === 'production') {
			env = args[0];
			command = args[1] || 'all';
			params = args.slice(2);
		} else {
			command = args[0];
			params = args.slice(1);
		}
	}

	return { env, command, params };
}

// Make API request
async function fetchAPI(env, endpoint) {
	const baseUrl = ENV_URLS[env];
	const url = `${baseUrl}/api${endpoint}`;

	try {
		const response = await fetch(url);
		if (!response.ok) {
			if (response.status === 404) {
				return null;
			}
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		return await response.json();
	} catch (error) {
		console.error(`Error fetching ${url}:`, error.message);
		return null;
	}
}

// Make Indexer API request
async function fetchIndexer(env, endpoint, body = null) {
	const baseUrl = INDEXER_URLS[env];
	const url = `${baseUrl}${endpoint}`;

	try {
		const options = {
			method: body ? 'POST' : 'GET',
			headers: {
				'Content-Type': 'application/json'
			}
		};
		if (body) {
			options.body = JSON.stringify(body);
		}

		const response = await fetch(url, options);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		return await response.json();
	} catch (error) {
		console.error(`Error fetching ${url}:`, error.message);
		return null;
	}
}

// Format number with commas and decimals
function formatNumber(num, decimals = 2) {
	if (num === undefined || num === null) return 'N/A';
	return num.toLocaleString('en-US', {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals
	});
}

// Format currency
function formatCurrency(num) {
	if (num === undefined || num === null) return 'N/A';
	const formatted = formatNumber(num, 2);
	return num >= 0 ? `$${formatted}` : `-$${formatted.slice(1)}`;
}

// Format timestamp
function formatTimestamp(timestamp) {
	if (!timestamp) return 'N/A';
	// Handle both milliseconds and seconds
	const ts = timestamp > 1000000000000 ? timestamp : timestamp * 1000;
	const date = new Date(ts);
	return date.toLocaleString();
}

// Display balance
async function showBalance(env) {
	console.log('\n💰 BALANCE');
	console.log('─'.repeat(50));

	const data = await fetchAPI(env, '/balance');
	if (!data) {
		console.log('❌ Failed to fetch balance');
		return;
	}

	console.log(`USDC Balance: ${formatCurrency(data.balance)}`);
}

// Display all positions
async function showPositions(env) {
	console.log('\n📊 POSITIONS');
	console.log('─'.repeat(100));

	const data = await fetchAPI(env, '/positions');
	if (!data || !data.positions) {
		console.log('❌ Failed to fetch positions');
		return;
	}

	if (data.positions.length === 0) {
		console.log('No active positions');
		return;
	}

	// Header
	console.log(
		`${'Symbol'.padEnd(18)} ${'Side'.padEnd(8)} ${'Size'.padEnd(12)} ${'Entry'.padEnd(12)} ${'Mark'.padEnd(12)} ${'Unrealized PnL'.padEnd(16)} ${'Realized PnL'.padEnd(15)}`
	);
	console.log('─'.repeat(100));

	// Data rows
	for (const pos of data.positions) {
		const side = pos.isLong ? '🟢 LONG' : '🔴 SHORT';
		const unrealizedPnL = pos.unrealizedPnl || 0;
		const realizedPnL = pos.realizedPnl || 0;
		const markPrice = pos.markPrice || pos.entryPrice;

		console.log(
			`${pos.symbol.padEnd(18)} ` +
				`${side.padEnd(8)} ` +
				`${formatNumber(pos.size, 4).padEnd(12)} ` +
				`${formatCurrency(pos.entryPrice).padEnd(12)} ` +
				`${formatCurrency(markPrice).padEnd(12)} ` +
				`${formatCurrency(unrealizedPnL).padEnd(16)} ` +
				`${formatCurrency(realizedPnL).padEnd(15)}`
		);
	}

	// Summary
	const totalUnrealized = data.positions.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0);
	const totalRealized = data.positions.reduce((sum, p) => sum + (p.realizedPnl || 0), 0);
	console.log('─'.repeat(100));
	console.log(`Total Unrealized PnL: ${formatCurrency(totalUnrealized)}`);
	console.log(`Total Realized PnL:   ${formatCurrency(totalRealized)}`);
}

// Display specific position
async function showPosition(env, symbol) {
	if (!symbol) {
		console.log('❌ Please specify a symbol (e.g., PERP_NEAR_USDC)');
		return;
	}

	console.log(`\n📈 POSITION: ${symbol}`);
	console.log('─'.repeat(50));

	const data = await fetchAPI(env, `/position/${symbol}`);
	if (!data) {
		console.log(`No active position for ${symbol}`);
		return;
	}

	const side = data.isLong ? '🟢 LONG' : '🔴 SHORT';
	const markPrice = data.markPrice || data.entryPrice;
	console.log(`Side:           ${side}`);
	console.log(`Size:           ${formatNumber(data.size, 6)}`);
	console.log(`Entry Price:    ${formatCurrency(data.entryPrice)}`);
	console.log(`Mark Price:     ${formatCurrency(markPrice)}`);
	console.log(`Unrealized PnL: ${formatCurrency(data.unrealizedPnl)}`);
	console.log(`Realized PnL:   ${formatCurrency(data.realizedPnl)}`);
	console.log(`Last Updated:   ${formatTimestamp(data.lastUpdateTime)}`);
}

// Display portfolio summary
async function showPortfolio(env) {
	console.log('\n💼 PORTFOLIO SUMMARY');
	console.log('═'.repeat(60));

	const data = await fetchAPI(env, '/portfolio');
	if (!data) {
		console.log('❌ Failed to fetch portfolio');
		return;
	}

	// Balance section
	console.log('\n💰 Balance');
	console.log('─'.repeat(60));
	console.log(`USDC Balance: ${formatCurrency(data.balance)}`);

	// Positions section
	console.log('\n📊 Positions');
	console.log('─'.repeat(60));

	if (!data.positions || data.positions.length === 0) {
		console.log('No active positions');
	} else {
		console.log(`Active Positions: ${data.positions.length}`);

		let totalPositionValue = 0;
		let totalUnrealizedPnL = 0;

		for (const pos of data.positions) {
			const positionValue = pos.size * pos.entryPrice;
			totalPositionValue += positionValue;
			totalUnrealizedPnL += pos.unrealizedPnl || 0;

			const side = pos.isLong ? '🟢 LONG' : '🔴 SHORT';
			console.log(`\n  ${pos.symbol}`);
			console.log(
				`    Side: ${side} | Size: ${formatNumber(pos.size, 6)} | Entry: ${formatCurrency(pos.entryPrice)}`
			);
			console.log(`    Unrealized PnL: ${formatCurrency(pos.unrealizedPnl || 0)}`);
		}

		console.log('\n' + '─'.repeat(60));
		console.log(`Total Position Value: ${formatCurrency(totalPositionValue)}`);
		console.log(`Total Unrealized PnL: ${formatCurrency(totalUnrealizedPnL)}`);
		console.log(`Portfolio Value:      ${formatCurrency(data.balance + totalPositionValue)}`);
	}
}

// Display current price
async function showPrice(env, symbol) {
	if (!symbol) {
		console.log('❌ Please specify a symbol (e.g., PERP_NEAR_USDC)');
		return;
	}

	console.log(`\n💵 CURRENT PRICE: ${symbol}`);
	console.log('─'.repeat(50));

	// We'll need to fetch from the latest indicators endpoint
	const data = await fetchAPI(env, `/latest/${symbol}`);
	if (!data || !data.indicators || !data.indicators.candle) {
		console.log('❌ Failed to fetch price data');
		return;
	}

	const candle = data.indicators.candle;
	console.log(`Current Price: ${formatCurrency(candle.close)}`);
	console.log(`Open:          ${formatCurrency(candle.open)}`);
	console.log(`High:          ${formatCurrency(candle.high)}`);
	console.log(`Low:           ${formatCurrency(candle.low)}`);
	console.log(`Volume:        ${formatNumber(candle.volume, 2)}`);
	console.log(`Timestamp:     ${formatTimestamp(data.timestamp)}`);
}

// Display latest indicators
async function showIndicators(env, symbol) {
	if (!symbol) {
		console.log('❌ Please specify a symbol (e.g., PERP_NEAR_USDC)');
		return;
	}

	console.log(`\n📈 INDICATORS: ${symbol}`);
	console.log('─'.repeat(60));

	const data = await fetchAPI(env, `/latest/${symbol}`);
	if (!data || !data.indicators) {
		console.log('❌ No indicator data found');
		return;
	}

	console.log(`Timestamp: ${formatTimestamp(data.timestamp)}\n`);

	// Display each indicator
	for (const [indicator, value] of Object.entries(data.indicators)) {
		console.log(`${indicator.toUpperCase()}:`);
		console.log(JSON.stringify(value, null, 2));
		console.log();
	}
}

// Display historical data
async function showHistory(env, symbol, indicator, limit = 10) {
	if (!symbol) {
		console.log('❌ Please specify a symbol (e.g., PERP_NEAR_USDC)');
		return;
	}

	const endpoint = indicator
		? `/history/${symbol}/${indicator}?limit=${limit}`
		: `/history/${symbol}?limit=${limit}`;

	console.log(`\n📜 HISTORY: ${symbol}${indicator ? ` (${indicator})` : ''}`);
	console.log('─'.repeat(80));

	const data = await fetchAPI(env, endpoint);
	if (!data || (!data.data && !data.indicators)) {
		console.log('❌ No historical data found');
		return;
	}

	if (indicator) {
		// Single indicator history
		console.log(`Showing last ${data.data.length} entries:\n`);
		for (const entry of data.data.slice(0, limit)) {
			console.log(`${formatTimestamp(entry.timestamp)}: ${JSON.stringify(entry.data)}`);
		}
	} else {
		// All indicators history
		console.log(`Showing last ${data.data.length} timeframes:\n`);
		for (const entry of data.data.slice(0, limit)) {
			console.log(`\n${formatTimestamp(entry.timestamp)}:`);
			for (const [ind, value] of Object.entries(entry.indicators)) {
				console.log(
					`  ${ind}: ${JSON.stringify(value).substring(0, 60)}${JSON.stringify(value).length > 60 ? '...' : ''}`
				);
			}
		}
	}
}

// Display recent logs
async function showLogs(env, limit = 20) {
	console.log(`\n📝 RECENT LOGS (last ${limit})`);
	console.log('─'.repeat(100));

	const data = await fetchAPI(env, `/logs?limit=${limit}`);
	if (!data || !data.logs) {
		console.log('❌ Failed to fetch logs');
		return;
	}

	if (data.logs.length === 0) {
		console.log('No logs found');
		return;
	}

	for (const log of data.logs) {
		const logData = log.data;
		const timestamp = logData?.timestamp || log.key;
		const level = logData?.level || 'UNKNOWN';
		const message = logData?.message || 'No message';
		const symbol = logData?.symbol || '-';
		const operation = logData?.operation || '-';

		// Color code by level
		let levelIcon = '⚪';
		if (level === 'ERROR') levelIcon = '🔴';
		else if (level === 'WARN') levelIcon = '🟡';
		else if (level === 'INFO') levelIcon = '🟢';
		else if (level === 'DEBUG') levelIcon = '🔵';

		console.log(
			`${levelIcon} [${level.padEnd(5)}] ${formatTimestamp(timestamp)} | ${symbol.padEnd(16)} | ${operation.padEnd(20)} | ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`
		);
	}
}

// Display recent trades from Orderly Indexer
async function showTrades(env, limit = 10) {
	console.log(`\n💹 RECENT TRADES (last ${limit})`);
	console.log('═'.repeat(100));

	const accountId = getAccountId();
	console.log(`Account ID: ${accountId}\n`);

	const toTime = Math.floor(Date.now() / 1000);
	const fromTime = toTime - 7 * 24 * 60 * 60; // 7 days ago

	const data = await fetchIndexer(env, '/events_v2', {
		account_id: accountId,
		event_type: 'PERPTRADE',
		from_time: fromTime,
		to_time: toTime
	});

	if (!data || !data.success) {
		console.log('❌ Failed to fetch trades:', data?.message || 'Unknown error');
		return;
	}

	if (!data.data || !data.data.events || data.data.events.length === 0) {
		console.log('No trades found in the last 7 days');
		return;
	}

	// Collect all trades from events
	const allTrades = [];
	for (const event of data.data.events) {
		if (event.data?.ProcessedTrades?.trades) {
			for (const trade of event.data.ProcessedTrades.trades) {
				allTrades.push({
					...trade,
					block_timestamp: event.block_timestamp
				});
			}
		}
	}

	if (allTrades.length === 0) {
		console.log('No individual trades found in the last 7 days');
		return;
	}

	// Sort by timestamp descending (most recent first)
	allTrades.sort((a, b) => b.timestamp - a.timestamp);

	console.log(
		`Found ${allTrades.length} total trades (showing latest ${Math.min(limit, allTrades.length)})\n`
	);

	// Header
	console.log(
		`${'Time'.padEnd(20)} ${'Symbol'.padEnd(18)} ${'Side'.padEnd(6)} ${'Qty'.padEnd(12)} ${'Price'.padEnd(15)} ${'Fee'.padEnd(12)}`
	);
	console.log('─'.repeat(100));

	// Display trades (latest first)
	for (let i = 0; i < Math.min(limit, allTrades.length); i++) {
		const trade = allTrades[i];
		const timestamp = formatTimestamp(trade.timestamp);
		const symbol = trade.symbol_hash?.substring(0, 16) || 'Unknown';
		const side = trade.side || '-';
		const qty = formatNumber(parseFloat(trade.trade_qty), 6);
		const price = formatCurrency(parseFloat(trade.executed_price));
		const fee = formatNumber(parseFloat(trade.fee), 6);

		console.log(
			`${timestamp.padEnd(20)} ${symbol.padEnd(18)} ${side.padEnd(6)} ${qty.padEnd(12)} ${price.padEnd(15)} ${fee.padEnd(12)}`
		);
	}

	if (data.data.trading_event_next_cursor) {
		console.log('\n⚠️  More trades available (use pagination)');
	}
}

// Display account events
async function showEvents(env, eventType = null, limit = 20) {
	const eventTypeDisplay = eventType || 'ALL';
	console.log(`\n📋 ACCOUNT EVENTS (${eventTypeDisplay})`);
	console.log('═'.repeat(100));

	const accountId = getAccountId();
	console.log(`Account ID: ${accountId}\n`);

	const toTime = Math.floor(Date.now() / 1000);
	const fromTime = toTime - 30 * 24 * 60 * 60; // 30 days ago

	const body = {
		account_id: accountId,
		from_time: fromTime,
		to_time: toTime
	};

	if (eventType) {
		body.event_type = eventType;
	}

	const data = await fetchIndexer(env, '/events_v2', body);

	if (!data || !data.success) {
		console.log('❌ Failed to fetch events:', data?.message || 'Unknown error');
		return;
	}

	if (!data.data || !data.data.events || data.data.events.length === 0) {
		console.log('No events found in the last 30 days');
		return;
	}

	console.log(`Found ${data.data.events.length} events\n`);

	// Display events
	for (let i = 0; i < Math.min(data.data.events.length, limit); i++) {
		const event = data.data.events[i];
		const timestamp = formatTimestamp(event.block_timestamp);
		const txId = event.transaction_id?.substring(0, 20) + '...' || 'N/A';

		// Determine event type
		let eventTypeStr = 'UNKNOWN';
		let details = '';

		if (event.data?.Transaction) {
			eventTypeStr = 'TRANSACTION';
			const tx = event.data.Transaction;
			details = `${tx.side?.toUpperCase() || 'UNKNOWN'} ${tx.token_amount} ${tx.token_hash?.substring(0, 10)}...`;
		} else if (event.data?.ProcessedTrades) {
			eventTypeStr = 'PERPTRADE';
			const trades = event.data.ProcessedTrades.trades;
			details = `${trades?.length || 0} trade(s)`;
		} else if (event.data?.SettlementResult) {
			eventTypeStr = 'SETTLEMENT';
			details = `Settled: ${event.data.SettlementResult.settled_amount}`;
		} else if (event.data?.LiquidationResult || event.data?.LiquidationResultV2) {
			eventTypeStr = 'LIQUIDATION';
			details = 'Liquidation event';
		} else if (event.data?.AdlResult || event.data?.AdlResultV2) {
			eventTypeStr = 'ADL';
			details = 'Auto-deleveraging';
		}

		console.log(`${timestamp} | ${eventTypeStr.padEnd(12)} | ${txId} | ${details}`);
	}

	// Show pagination info
	if (data.data.trading_event_next_cursor) {
		console.log('\n📄 Trading events have more pages');
	}
	if (data.data.settlement_event_next_cursor) {
		console.log('📄 Settlement events have more pages');
	}
	if (data.data.liquidation_event_next_cursor) {
		console.log('📄 Liquidation events have more pages');
	}
}

// Display funding payments
async function showFunding(env) {
	console.log('\n💸 FUNDING PAYMENTS');
	console.log('═'.repeat(80));

	const accountId = getAccountId();
	console.log(`Account ID: ${accountId}\n`);

	const toTime = Math.floor(Date.now() / 1000);
	const fromTime = toTime - 7 * 24 * 60 * 60; // 7 days ago

	const data = await fetchIndexer(env, '/events_v2', {
		account_id: accountId,
		event_type: 'SETTLEMENT',
		from_time: fromTime,
		to_time: toTime
	});

	if (!data || !data.success) {
		console.log('❌ Failed to fetch funding data:', data?.message || 'Unknown error');
		return;
	}

	if (!data.data || !data.data.events || data.data.events.length === 0) {
		console.log('No funding payments in the last 7 days');
		return;
	}

	console.log(`Found ${data.data.events.length} settlement events\n`);

	// Header
	console.log(`${'Time'.padEnd(20)} ${'Amount'.padEnd(20)} ${'Asset'.padEnd(15)}`);
	console.log('─'.repeat(80));

	// Display funding payments
	for (const event of data.data.events) {
		if (event.data?.SettlementResult) {
			const settlement = event.data.SettlementResult;
			const timestamp = formatTimestamp(event.block_timestamp);
			const amount = formatCurrency(parseFloat(settlement.settled_amount));
			const asset = settlement.settled_asset_hash?.substring(0, 12) || 'Unknown';

			console.log(`${timestamp.padEnd(20)} ${amount.padEnd(20)} ${asset.padEnd(15)}`);
		}
	}
}

// Quick health check
async function showHealth(env) {
	console.log('\n🏥 HEALTH CHECK');
	console.log('═'.repeat(60));

	const checks = [
		{ name: 'API Connection', endpoint: '/balance' },
		{ name: 'Positions Endpoint', endpoint: '/positions' },
		{ name: 'Portfolio Endpoint', endpoint: '/portfolio' },
		{ name: 'Logs Endpoint', endpoint: '/logs?limit=1' }
	];

	let healthy = true;

	for (const check of checks) {
		process.stdout.write(`Checking ${check.name}... `);
		try {
			const result = await fetchAPI(env, check.endpoint);
			if (result !== null) {
				console.log('✅ OK');
			} else {
				console.log('❌ FAILED');
				healthy = false;
			}
		} catch (error) {
			console.log('❌ ERROR', error);
			healthy = false;
		}
	}

	console.log('\n' + '═'.repeat(60));
	if (healthy) {
		console.log('✅ All systems operational');
	} else {
		console.log('⚠️  Some endpoints are not responding');
	}
}

// Show everything
async function showAll(env) {
	console.log(`\n🤖 TA TRADER STATUS - ${env.toUpperCase()}`);
	console.log('═'.repeat(60));
	console.log(`API URL: ${ENV_URLS[env]}`);
	console.log(`Time: ${new Date().toLocaleString()}`);

	await showPortfolio(env);

	console.log('\n✅ Status check complete');
}

// Main function
async function main() {
	const { env, command, params } = parseArgs();

	if (!ENV_URLS[env]) {
		console.error(`❌ Unknown environment: ${env}`);
		console.error(`Supported environments: ${Object.keys(ENV_URLS).join(', ')}`);
		process.exit(1);
	}

	console.log(`\n🔌 Connecting to ${env} environment...`);

	switch (command) {
		case 'all':
			await showAll(env);
			break;
		case 'balance':
			await showBalance(env);
			break;
		case 'positions':
			await showPositions(env);
			break;
		case 'position':
			await showPosition(env, params[0]);
			break;
		case 'portfolio':
			await showPortfolio(env);
			break;
		case 'price':
			await showPrice(env, params[0]);
			break;
		case 'indicators':
			await showIndicators(env, params[0]);
			break;
		case 'history':
			await showHistory(env, params[0], params[1], parseInt(params[2]) || 10);
			break;
		case 'logs':
			await showLogs(env, parseInt(params[0]) || 20);
			break;
		case 'trades':
			await showTrades(env, parseInt(params[0]) || 20);
			break;
		case 'events':
			await showEvents(env, params[0], parseInt(params[1]) || 20);
			break;
		case 'funding':
			await showFunding(env);
			break;
		case 'health':
			await showHealth(env);
			break;
		default:
			console.log('❌ Unknown command:', command);
			console.log('\nAvailable commands:');
			console.log('  all                    - Show everything (default)');
			console.log('  balance                - Show USDC balance');
			console.log('  positions              - Show all positions');
			console.log('  position <symbol>      - Show specific position');
			console.log('  portfolio              - Show portfolio summary');
			console.log('  price <symbol>         - Show current price');
			console.log('  indicators <symbol>    - Show latest indicators');
			console.log('  history <symbol> [ind] [limit] - Show historical data');
			console.log('  logs [limit]           - Show recent logs');
			console.log('  trades [limit]         - Show recent trades (Indexer API)');
			console.log('  events [type] [limit]  - Show account events (Indexer API)');
			console.log('  funding                - Show funding payments (Indexer API)');
			console.log('  health                 - Quick health check');
			console.log('\nExamples:');
			console.log('  node scripts/check-status.js');
			console.log('  node scripts/check-status.js testnet positions');
			console.log('  node scripts/check-status.js production balance');
			console.log('  node scripts/check-status.js testnet trades 20');
			console.log('  node scripts/check-status.js testnet events PERPTRADE 10');
	}

	console.log();
}

main().catch((error) => {
	console.error('❌ Fatal error:', error.message);
	process.exit(1);
});
