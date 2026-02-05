#!/usr/bin/env node

/**
 * TA Trader API Status Checker
 *
 * Fetches and displays positions, balance, portfolio, and other data from the TA Trader API
 *
 * Usage:
 *   node scripts/check-status.js [env=testnet|production] [command]
 *
 * Commands:
 *   all          - Show everything (default)
 *   balance      - Show USDC balance only
 *   positions    - Show all positions
 *   portfolio    - Show portfolio summary
 *   position <symbol> - Show specific position (e.g., PERP_NEAR_USDC)
 *   price <symbol>    - Show current price for symbol
 *   indicators <symbol> - Show latest indicators for symbol
 *   history <symbol> [indicator] [limit] - Show historical data
 *   logs [limit] - Show recent logs
 *   health       - Quick health check
 *
 * Examples:
 *   node scripts/check-status.js
 *   node scripts/check-status.js testnet positions
 *   node scripts/check-status.js production balance
 *   node scripts/check-status.js testnet position PERP_NEAR_USDC
 *   node scripts/check-status.js testnet indicators PERP_BTC_USDC
 *   node scripts/check-status.js testnet history PERP_NEAR_USDC rsi 20
 */

const ENV_URLS = {
	testnet: 'https://ta-trader-api-testnet.shrm.workers.dev',
	production: 'https://ta-trader-api.shrm.workers.dev'
};

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
	const date = new Date(timestamp);
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
		`${'Symbol'.padEnd(18)} ${'Side'.padEnd(8)} ${'Size'.padEnd(15)} ${'Entry Price'.padEnd(15)} ${'Unrealized PnL'.padEnd(18)} ${'Realized PnL'.padEnd(15)}`
	);
	console.log('─'.repeat(100));

	// Data rows
	for (const pos of data.positions) {
		const side = pos.isLong ? '🟢 LONG' : '🔴 SHORT';
		const unrealizedPnL = pos.unrealizedPnl || 0;
		const realizedPnL = pos.realizedPnl || 0;

		console.log(
			`${pos.symbol.padEnd(18)} ` +
				`${side.padEnd(8)} ` +
				`${formatNumber(pos.size, 6).padEnd(15)} ` +
				`${formatCurrency(pos.entryPrice).padEnd(15)} ` +
				`${formatCurrency(unrealizedPnL).padEnd(18)} ` +
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
	console.log(`Side:           ${side}`);
	console.log(`Size:           ${formatNumber(data.size, 6)}`);
	console.log(`Entry Price:    ${formatCurrency(data.entryPrice)}`);
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

	await showBalance(env);
	await showPositions(env);
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
			console.log('  health                 - Quick health check');
			console.log('\nExamples:');
			console.log('  node scripts/check-status.js');
			console.log('  node scripts/check-status.js testnet positions');
			console.log('  node scripts/check-status.js production balance');
			console.log('  node scripts/check-status.js testnet position PERP_NEAR_USDC');
	}

	console.log();
}

main().catch((error) => {
	console.error('❌ Fatal error:', error.message);
	process.exit(1);
});
