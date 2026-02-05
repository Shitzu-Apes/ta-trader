#!/usr/bin/env node

/**
 * Trading Signal Investigator
 *
 * Investigates recent trading signals for a given symbol using the signals API
 *
 * Usage:
 *   node scripts/investigate-signals.js [env=testnet|production] <symbol> [limit]
 *
 * Examples:
 *   node scripts/investigate-signals.js PERP_NEAR_USDC
 *   node scripts/investigate-signals.js testnet PERP_NEAR_USDC 50
 *   node scripts/investigate-signals.js production PERP_ETH_USDC 20
 */

import { config } from 'dotenv';

// Load environment variables from .env file
config();

const ENV_URLS = {
	testnet: 'https://ta-trader-api-testnet.shrm.workers.dev',
	production: 'https://ta-trader-api.shrm.workers.dev'
};

// Parse command line arguments
function parseArgs() {
	const args = process.argv.slice(2);
	let env = 'testnet';
	let symbol = null;
	let limit = 50;

	if (args.length === 0) {
		return {
			env: null,
			symbol: null,
			limit: null,
			error: 'Please specify a symbol (e.g., PERP_NEAR_USDC)'
		};
	}

	// First argument could be environment or symbol
	if (args[0] === 'testnet' || args[0] === 'production') {
		env = args[0];
		symbol = args[1];
		limit = parseInt(args[2]) || 50;
	} else {
		symbol = args[0];
		limit = parseInt(args[1]) || 50;
	}

	if (!symbol) {
		return {
			env: null,
			symbol: null,
			limit: null,
			error: 'Please specify a symbol (e.g., PERP_NEAR_USDC)'
		};
	}

	return { env, symbol, limit };
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

// Format timestamp
function formatTimestamp(timestamp) {
	if (!timestamp) return 'N/A';
	const ts = timestamp > 1000000000000 ? timestamp : timestamp * 1000;
	const date = new Date(ts);
	return date.toLocaleString();
}

// Format number
function formatNumber(num, decimals = 4) {
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

// Get signal emoji
function getSignalEmoji(type, direction) {
	if (type === 'ENTRY') {
		return direction === 'LONG' ? '🟢' : '🔴';
	} else if (type === 'EXIT') {
		return '⚪';
	} else if (type === 'HOLD') {
		return '💎';
	} else {
		return '⏸️';
	}
}

// Investigate trading signals for a symbol
async function investigateSignals(env, symbol, limit) {
	console.log(`\n🔍 INVESTIGATING TRADING SIGNALS - ${symbol}`);
	console.log('═'.repeat(80));
	console.log(`Environment: ${env.toUpperCase()}`);
	console.log(`Limit: ${limit}`);
	console.log('');

	// Fetch signals from API
	const data = await fetchAPI(env, `/signals/${symbol}?limit=${limit}`);

	if (!data) {
		console.log('❌ Failed to fetch signals');
		return;
	}

	if (data.error) {
		console.log(`❌ Error: ${data.error}`);
		return;
	}

	const signals = data.signals || [];

	if (signals.length === 0) {
		console.log(`❌ No trading signals found for ${symbol}`);
		console.log('\n💡 This could mean:');
		console.log('   - No trading signals were generated recently');
		console.log('   - The TA score never crossed the buy/sell thresholds');
		console.log('   - Try increasing the limit to see older signals');
		return;
	}

	console.log(`✅ Found ${signals.length} trading signals\n`);

	// Count by type
	const entrySignals = signals.filter((s) => s.type === 'ENTRY');
	const exitSignals = signals.filter((s) => s.type === 'EXIT');
	const holdSignals = signals.filter((s) => s.type === 'HOLD');
	const noActionSignals = signals.filter((s) => s.type === 'NO_ACTION');

	console.log('📊 SIGNAL BREAKDOWN');
	console.log('─'.repeat(80));
	console.log(`Entry Signals:  ${entrySignals.length}`);
	console.log(`Exit Signals:   ${exitSignals.length}`);
	console.log(`Hold Signals:   ${holdSignals.length}`);
	console.log(`No Action:      ${noActionSignals.length}`);
	console.log('');

	// Display recent signals
	console.log('📈 RECENT SIGNALS');
	console.log('═'.repeat(80));

	for (let i = 0; i < Math.min(signals.length, 20); i++) {
		const signal = signals[i];
		const emoji = getSignalEmoji(signal.type, signal.direction);
		const timestamp = formatTimestamp(signal.timestamp);

		console.log(`\n${emoji} ${signal.type} - ${timestamp}`);
		console.log('─'.repeat(80));

		if (signal.type === 'ENTRY') {
			console.log(`   Direction: ${signal.direction}`);
			console.log(`   Action: ${signal.action}`);
			console.log(`   Reason: ${signal.reason}`);
			console.log(`   TA Score: ${formatNumber(signal.taScore, 2)}`);
			console.log(`   Threshold: ${formatNumber(signal.threshold, 2)}`);
			console.log(`   Price: ${formatCurrency(signal.price)}`);
			console.log(`   Position Size: ${formatCurrency(signal.positionSize)}`);
		} else if (signal.type === 'EXIT') {
			console.log(`   Direction: ${signal.direction}`);
			console.log(`   Action: ${signal.action}`);
			console.log(`   Reason: ${signal.reason}`);
			console.log(`   TA Score: ${formatNumber(signal.taScore, 2)}`);
			console.log(`   Threshold: ${formatNumber(signal.threshold, 2)}`);
			console.log(`   Price: ${formatCurrency(signal.price)}`);
			console.log(`   Entry Price: ${formatCurrency(signal.entryPrice)}`);
			console.log(`   Position Size: ${formatNumber(signal.positionSize, 6)}`);
			console.log(`   Unrealized PnL: ${formatCurrency(signal.unrealizedPnl)}`);
			console.log(`   Realized PnL: ${formatCurrency(signal.realizedPnl)}`);
		} else if (signal.type === 'HOLD') {
			console.log(`   Direction: ${signal.direction}`);
			console.log(`   TA Score: ${formatNumber(signal.taScore, 2)}`);
			console.log(`   Threshold: ${formatNumber(signal.threshold, 2)}`);
			console.log(`   Price: ${formatCurrency(signal.price)}`);
			console.log(`   Entry Price: ${formatCurrency(signal.entryPrice)}`);
			console.log(`   Position Size: ${formatNumber(signal.positionSize, 6)}`);
			console.log(`   Unrealized PnL: ${formatCurrency(signal.unrealizedPnl)}`);
		} else {
			console.log(`   TA Score: ${formatNumber(signal.taScore, 2)}`);
			console.log(`   Threshold: ${formatNumber(signal.threshold, 2)}`);
			console.log(`   Price: ${formatCurrency(signal.price)}`);
		}

		// Display indicator scores if available
		if (signal.indicators) {
			console.log(`\n   📊 Indicator Scores:`);
			if (signal.indicators.vwap !== undefined) {
				console.log(`      VWAP:   ${formatNumber(signal.indicators.vwap, 2)}`);
			}
			if (signal.indicators.bbands !== undefined) {
				console.log(`      BBands: ${formatNumber(signal.indicators.bbands, 2)}`);
			}
			if (signal.indicators.rsi !== undefined) {
				console.log(`      RSI:    ${formatNumber(signal.indicators.rsi, 2)}`);
			}
			if (signal.indicators.obv !== undefined) {
				console.log(`      OBV:    ${formatNumber(signal.indicators.obv, 2)}`);
			}
			if (signal.indicators.total !== undefined) {
				console.log(`      TOTAL:  ${formatNumber(signal.indicators.total, 2)}`);
			}
		}
	}

	// Summary statistics
	console.log('\n' + '═'.repeat(80));
	console.log('📊 SUMMARY');
	console.log('═'.repeat(80));
	console.log(`Total Signals: ${signals.length}`);
	console.log(`Entry Signals: ${entrySignals.length}`);
	console.log(`Exit Signals: ${exitSignals.length}`);
	console.log(`Hold Signals: ${holdSignals.length}`);
	console.log(`No Action: ${noActionSignals.length}`);

	if (entrySignals.length > 0) {
		const longEntries = entrySignals.filter((s) => s.direction === 'LONG');
		const shortEntries = entrySignals.filter((s) => s.direction === 'SHORT');
		console.log(`\nEntry Breakdown:`);
		console.log(`   Long:  ${longEntries.length}`);
		console.log(`   Short: ${shortEntries.length}`);
	}

	if (exitSignals.length > 0) {
		const stopLossExits = exitSignals.filter((s) => s.reason === 'STOP_LOSS');
		const takeProfitExits = exitSignals.filter((s) => s.reason === 'TAKE_PROFIT');
		const reversalExits = exitSignals.filter((s) => s.reason === 'SIGNAL_REVERSAL');
		console.log(`\nExit Breakdown:`);
		console.log(`   Stop Loss:       ${stopLossExits.length}`);
		console.log(`   Take Profit:     ${takeProfitExits.length}`);
		console.log(`   Signal Reversal: ${reversalExits.length}`);
	}

	// Calculate average TA scores
	if (signals.length > 0) {
		const avgTaScore = signals.reduce((sum, s) => sum + (s.taScore || 0), 0) / signals.length;
		console.log(`\nAverage TA Score: ${formatNumber(avgTaScore, 2)}`);
	}
}

// Main function
async function main() {
	const { env, symbol, limit, error } = parseArgs();

	if (error) {
		console.error(`❌ ${error}`);
		console.log('\nUsage:');
		console.log('  node scripts/investigate-signals.js <symbol> [limit]');
		console.log('  node scripts/investigate-signals.js testnet PERP_NEAR_USDC 50');
		console.log('  node scripts/investigate-signals.js production PERP_ETH_USDC 20');
		process.exit(1);
	}

	if (!ENV_URLS[env]) {
		console.error(`❌ Unknown environment: ${env}`);
		console.error(`Supported environments: ${Object.keys(ENV_URLS).join(', ')}`);
		process.exit(1);
	}

	console.log(`\n🔌 Connecting to ${env} environment...`);
	await investigateSignals(env, symbol, limit);
	console.log();
}

main().catch((error) => {
	console.error('❌ Fatal error:', error.message);
	process.exit(1);
});
