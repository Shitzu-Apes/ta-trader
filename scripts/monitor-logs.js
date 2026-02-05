#!/usr/bin/env node

/**
 * Log Monitor Script
 * Fetches logs from the deployed worker and checks for errors
 * Usage: node scripts/monitor-logs.js [--env testnet|production] [--limit N]
 */

const ENV = process.argv.includes('--env production') ? 'production' : 'testnet';
const LIMIT = process.argv.includes('--limit')
	? parseInt(process.argv[process.argv.indexOf('--limit') + 1])
	: 50;

const BASE_URL =
	ENV === 'production'
		? 'https://ta-trader-api.shrm.workers.dev'
		: 'https://ta-trader-api-testnet.shrm.workers.dev';

async function fetchLogs() {
	try {
		const response = await fetch(`${BASE_URL}/api/logs?limit=${LIMIT}`);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		return await response.json();
	} catch (error) {
		console.error('Failed to fetch logs:', error.message);
		process.exit(1);
	}
}

function analyzeLogs(logs) {
	const errors = [];
	const warnings = [];
	const stats = {
		total: 0,
		errors: 0,
		warnings: 0,
		info: 0,
		debug: 0,
		byOperation: {},
		bySymbol: {}
	};

	for (const log of logs.logs || []) {
		for (const entry of log.data || []) {
			stats.total++;

			// Count by level
			if (entry.level === 'ERROR') {
				stats.errors++;
				errors.push(entry);
			} else if (entry.level === 'WARN') {
				stats.warnings++;
				warnings.push(entry);
			} else if (entry.level === 'INFO') {
				stats.info++;
			} else if (entry.level === 'DEBUG') {
				stats.debug++;
			}

			// Count by operation
			const op = entry.context?.operation || 'unknown';
			stats.byOperation[op] = (stats.byOperation[op] || 0) + 1;

			// Count by symbol
			const symbol = entry.context?.symbol || 'none';
			stats.bySymbol[symbol] = (stats.bySymbol[symbol] || 0) + 1;
		}
	}

	return { errors, warnings, stats };
}

function printReport({ errors, warnings, stats }) {
	console.log('\n' + '='.repeat(80));
	console.log(`📊 LOG ANALYSIS REPORT - ${ENV.toUpperCase()}`);
	console.log('='.repeat(80));

	console.log('\n📈 STATISTICS:');
	console.log(`  Total logs: ${stats.total}`);
	console.log(`  Errors: ${stats.errors} ${stats.errors > 0 ? '❌' : '✅'}`);
	console.log(`  Warnings: ${stats.warnings} ${stats.warnings > 0 ? '⚠️' : '✅'}`);
	console.log(`  Info: ${stats.info}`);
	console.log(`  Debug: ${stats.debug}`);

	if (Object.keys(stats.byOperation).length > 0) {
		console.log('\n🔧 BY OPERATION:');
		Object.entries(stats.byOperation)
			.sort((a, b) => b[1] - a[1])
			.forEach(([op, count]) => {
				console.log(`  ${op}: ${count}`);
			});
	}

	if (Object.keys(stats.bySymbol).length > 1) {
		console.log('\n💱 BY SYMBOL:');
		Object.entries(stats.bySymbol)
			.filter(([sym]) => sym !== 'none')
			.sort((a, b) => b[1] - a[1])
			.forEach(([sym, count]) => {
				console.log(`  ${sym}: ${count}`);
			});
	}

	if (errors.length > 0) {
		console.log('\n' + '❌'.repeat(40));
		console.log('ERRORS FOUND:');
		console.log('❌'.repeat(40));

		// Group errors by message
		const errorGroups = {};
		for (const error of errors.slice(0, 10)) {
			const key = error.message;
			if (!errorGroups[key]) {
				errorGroups[key] = {
					count: 0,
					examples: [],
					symbols: new Set()
				};
			}
			errorGroups[key].count++;
			if (errorGroups[key].examples.length < 3) {
				errorGroups[key].examples.push({
					timestamp: error.timestamp,
					context: error.context,
					error: error.error
				});
			}
			if (error.context?.symbol) {
				errorGroups[key].symbols.add(error.context.symbol);
			}
		}

		Object.entries(errorGroups).forEach(([message, data], idx) => {
			console.log(`\n${idx + 1}. ${message}`);
			console.log(`   Count: ${data.count}`);
			if (data.symbols.size > 0) {
				console.log(`   Symbols: ${Array.from(data.symbols).join(', ')}`);
			}

			data.examples.forEach((ex, i) => {
				console.log(`   Example ${i + 1}:`);
				console.log(`     Time: ${ex.timestamp}`);
				if (ex.context?.operation) {
					console.log(`     Operation: ${ex.context.operation}`);
				}
				if (ex.error?.message) {
					console.log(`     Error: ${ex.error.message}`);
				}
			});
		});

		if (errors.length > 10) {
			console.log(`\n... and ${errors.length - 10} more errors`);
		}
	}

	if (warnings.length > 0) {
		console.log('\n' + '⚠️'.repeat(40));
		console.log('WARNINGS:');
		console.log('⚠️'.repeat(40));

		const warningGroups = {};
		for (const warning of warnings.slice(0, 5)) {
			const key = warning.message;
			warningGroups[key] = (warningGroups[key] || 0) + 1;
		}

		Object.entries(warningGroups).forEach(([message, count]) => {
			console.log(`  ${message} (${count}x)`);
		});

		if (warnings.length > 5) {
			console.log(`  ... and ${warnings.length - 5} more warnings`);
		}
	}

	console.log('\n' + '='.repeat(80));

	if (stats.errors === 0) {
		console.log('✅ NO ERRORS FOUND - System looks healthy!');
	} else {
		console.log(`❌ FOUND ${stats.errors} ERROR(S) - Action required!`);
		process.exit(1);
	}
	console.log('='.repeat(80) + '\n');
}

async function main() {
	console.log(`🔍 Fetching logs from ${ENV} environment...`);
	const logs = await fetchLogs();
	console.log(`📥 Retrieved ${logs.count} log entries`);

	const analysis = analyzeLogs(logs);
	printReport(analysis);
}

main().catch(console.error);
