#!/usr/bin/env -S npx tsx

/**
 * TA Trader API Market Data Overview
 *
 * Fetches and displays market data using shared indicator calculations.
 *
 * Usage:
 *   node scripts/api-market.js [testnet|production] [symbol]
 *
 * Examples:
 *   node scripts/api-market.js
 *   node scripts/api-market.js production PERP_NEAR_USDC
 */

import { config } from 'dotenv';

import { TRADING_CONFIG } from '../src/config.js';
import { calculateTaScore, getObvDivergenceDetails } from '../src/indicators.js';

config();

const ENV_URLS = {
	testnet: 'https://ta-trader-api-testnet.shrm.workers.dev',
	production: 'https://ta-trader-api.shrm.workers.dev'
};

const ENV =
	process.argv[2] === 'production'
		? 'production'
		: process.argv[2] === 'testnet'
			? 'testnet'
			: 'testnet';
const SYMBOL =
	process.argv[3] || (process.argv[2]?.startsWith('PERP') ? process.argv[2] : 'PERP_NEAR_USDC');
const BASE_URL = ENV_URLS[ENV];

// Fetch from API
async function fetchAPI(endpoint) {
	try {
		const response = await fetch(`${BASE_URL}/api${endpoint}`);
		if (!response.ok) {
			return { error: `HTTP ${response.status}` };
		}
		return await response.json();
	} catch (error) {
		return { error: error.message };
	}
}

// Format helpers
const fmt = {
	currency: (n) =>
		n === undefined
			? 'N/A'
			: `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`,
	number: (n, d = 4) =>
		n === undefined
			? 'N/A'
			: n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }),
	percent: (n) => (n === undefined ? 'N/A' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`),
	time: (ts) => (ts ? new Date(ts).toLocaleString() : 'N/A')
};

async function main() {
	console.log(`\n📈 MARKET DATA OVERVIEW - ${ENV.toUpperCase()}`);
	console.log(`Symbol: ${SYMBOL}`);
	console.log(`URL: ${BASE_URL}`);
	console.log('═'.repeat(70));

	// Fetch latest indicators and history
	const [latest, history] = await Promise.all([
		fetchAPI(`/latest/${SYMBOL}`),
		fetchAPI(`/history/${SYMBOL}?limit=24`)
	]);

	// LATEST PRICE & CANDLE
	console.log('\n💵 CURRENT PRICE');
	console.log('─'.repeat(70));
	if (latest.error) {
		console.log(`❌ Error: ${latest.error}`);
	} else if (!latest.indicators || !latest.indicators.candle) {
		console.log('❌ No price data available');
	} else {
		const candle = latest.indicators.candle;
		console.log(`Current: ${fmt.currency(candle.close)}`);
		console.log(`Open:    ${fmt.currency(candle.open)}`);
		console.log(`High:    ${fmt.currency(candle.high)}`);
		console.log(`Low:     ${fmt.currency(candle.low)}`);
		console.log(`Volume:  ${fmt.number(candle.volume, 0)}`);

		const change = ((candle.close - candle.open) / candle.open) * 100;
		console.log(`Change:  ${fmt.percent(change)}`);
		console.log(`Updated: ${fmt.time(latest.timestamp)}`);
	}

	// TECHNICAL INDICATORS
	console.log('\n📊 TECHNICAL INDICATORS');
	console.log('─'.repeat(70));
	if (latest.error || !latest.indicators) {
		console.log('❌ No indicator data available');
	} else {
		const ind = latest.indicators;

		// RSI
		if (ind.rsi) {
			const rsiIcon = ind.rsi.value > 70 ? '🔴' : ind.rsi.value < 30 ? '🟢' : '⚪';
			console.log(`\n${rsiIcon} RSI: ${fmt.number(ind.rsi.value, 2)}`);
			if (ind.rsi.value > 70) console.log(`   ⚠️  Overbought (>70)`);
			if (ind.rsi.value < 30) console.log(`   ⚠️  Oversold (<30)`);
		}

		// VWAP
		if (ind.vwap) {
			console.log(`\n📊 VWAP: ${fmt.currency(ind.vwap.value)}`);
			const vwapDiff = ((latest.indicators.candle.close - ind.vwap.value) / ind.vwap.value) * 100;
			console.log(`   vs Price: ${fmt.percent(vwapDiff)}`);
		}

		// Bollinger Bands
		if (ind.bbands) {
			console.log(`\n📊 Bollinger Bands`);
			console.log(`   Upper:  ${fmt.currency(ind.bbands.valueUpperBand)}`);
			console.log(`   Middle: ${fmt.currency(ind.bbands.valueMiddleBand)}`);
			console.log(`   Lower:  ${fmt.currency(ind.bbands.valueLowerBand)}`);

			const close = latest.indicators.candle.close;
			if (close > ind.bbands.valueUpperBand) {
				console.log(`   🔴 Price above upper band (overbought)`);
			} else if (close < ind.bbands.valueLowerBand) {
				console.log(`   🟢 Price below lower band (oversold)`);
			} else {
				console.log(`   ⚪ Price within bands`);
			}
		}

		// OBV
		if (ind.obv) {
			console.log(`\n📊 OBV: ${fmt.number(ind.obv.value, 0)}`);
			console.log(`   (On-Balance Volume)`);
		}

		// ATR
		if (ind.atr) {
			console.log(`\n📊 ATR: ${fmt.currency(ind.atr.value)}`);
			console.log(`   (Average True Range - Volatility)`);
		}
	}

	// CALCULATED SCORES (same as trading bot)
	console.log('\n🧮 CALCULATED TA SCORES (same as trading bot)');
	console.log('─'.repeat(70));

	if (history.error || !history.data || history.data.length < TRADING_CONFIG.OBV_WINDOW_SIZE) {
		console.log(
			`❌ Need at least ${TRADING_CONFIG.OBV_WINDOW_SIZE} data points for OBV divergence calculation`
		);
		console.log(`   Current: ${history.data?.length || 0} points`);
	} else if (
		!latest.indicators?.candle ||
		!latest.indicators?.vwap ||
		!latest.indicators?.bbands ||
		!latest.indicators?.rsi
	) {
		console.log('❌ Missing required indicator data');
	} else {
		// Extract data for calculations
		const prices = history.data.map((d) => d.indicators?.candle?.close).filter(Boolean);
		const obvs = history.data.map((d) => d.indicators?.obv?.value).filter(Boolean);

		if (
			prices.length < TRADING_CONFIG.OBV_WINDOW_SIZE ||
			obvs.length < TRADING_CONFIG.OBV_WINDOW_SIZE
		) {
			console.log(`❌ Insufficient data: ${prices.length} prices, ${obvs.length} OBV values`);
		} else {
			const ind = latest.indicators;
			const scores = calculateTaScore(
				ind.candle.close,
				ind.vwap.value,
				ind.bbands.valueUpperBand,
				ind.bbands.valueLowerBand,
				ind.rsi.value,
				prices,
				obvs
			);

			console.log(`\nIndividual Scores:`);
			console.log(
				`  VWAP:   ${fmt.number(scores.vwap, 4)} (multiplier: ${TRADING_CONFIG.VWAP_MULTIPLIER})`
			);
			console.log(
				`  BBands: ${fmt.number(scores.bbands, 4)} (multiplier: ${TRADING_CONFIG.BBANDS_MULTIPLIER})`
			);
			console.log(
				`  RSI:    ${fmt.number(scores.rsi, 4)} (multiplier: ${TRADING_CONFIG.RSI_MULTIPLIER})`
			);
			console.log(
				`  OBV:    ${fmt.number(scores.obv, 4)} (multiplier: ${TRADING_CONFIG.OBV_DIVERGENCE_MULTIPLIER})`
			);

			console.log(`\n${'─'.repeat(70)}`);
			console.log(`  TOTAL SCORE: ${fmt.number(scores.total, 4)}`);

			// Signal interpretation
			console.log(`\n📊 Signal Interpretation:`);
			if (scores.total > 2.0) {
				console.log(`   🟢 STRONG BUY (score > 2.0)`);
			} else if (scores.total > 0.5) {
				console.log(`   🟢 BUY (score > 0.5)`);
			} else if (scores.total < -2.0) {
				console.log(`   🔴 STRONG SELL (score < -2.0)`);
			} else if (scores.total < -0.5) {
				console.log(`   🔴 SELL (score < -0.5)`);
			} else {
				console.log(`   ⚪ NEUTRAL (-0.5 to 0.5)`);
			}

			// Show OBV divergence details using the helper function
			const obvDetails = getObvDivergenceDetails(prices, obvs);
			console.log(`\n📈 OBV Divergence Details:`);
			console.log(`  Window Size: ${TRADING_CONFIG.OBV_WINDOW_SIZE} periods`);
			console.log(`  Price Slope (raw): ${fmt.number(obvDetails.priceSlope, 6)}`);
			console.log(`  OBV Slope (raw):   ${fmt.number(obvDetails.obvSlope, 6)}`);
			console.log(`  Normalized Price Slope: ${fmt.number(obvDetails.normalizedPriceSlope, 6)}`);
			console.log(`  Normalized OBV Slope:   ${fmt.number(obvDetails.normalizedObvSlope, 6)}`);
		}
	}

	// PRICE HISTORY
	console.log('\n📜 PRICE HISTORY (last 5 periods)');
	console.log('─'.repeat(70));
	if (history.error) {
		console.log(`❌ Error: ${history.error}`);
	} else if (!history.data || history.data.length === 0) {
		console.log('❌ No historical data available');
	} else {
		console.log(
			`${'Time'.padEnd(20)} ${'Close'.padEnd(12)} ${'Change'.padEnd(10)} ${'Volume'.padEnd(12)}`
		);
		console.log('─'.repeat(70));

		let prevClose = null;
		for (const entry of history.data.slice(0, 5)) {
			if (!entry.indicators || !entry.indicators.candle) continue;

			const candle = entry.indicators.candle;
			const time = fmt.time(entry.timestamp);
			const close = candle.close;
			const change = prevClose ? ((close - prevClose) / prevClose) * 100 : 0;
			const changeStr = prevClose ? fmt.percent(change) : '-';
			const volume = fmt.number(candle.volume, 0);

			console.log(
				`${time.padEnd(20)} ` +
					`${fmt.currency(close).padEnd(12)} ` +
					`${changeStr.padEnd(10)} ` +
					`${volume.padEnd(12)}`
			);

			prevClose = close;
		}
	}

	// OTHER SYMBOLS
	console.log('\n🔗 CHECK OTHER SYMBOLS');
	console.log('─'.repeat(70));
	console.log('Try these commands:');
	console.log(`  node scripts/api-market.js ${ENV} PERP_ETH_USDC`);
	console.log(`  node scripts/api-market.js ${ENV} PERP_BTC_USDC`);
	console.log(`  node scripts/api-market.js ${ENV} PERP_SOL_USDC`);

	console.log('\n' + '═'.repeat(70));
	console.log(`✅ Market data complete - ${new Date().toLocaleString()}`);
	console.log();
}

main().catch((err) => {
	console.error('❌ Fatal error:', err.message);
	process.exit(1);
});
