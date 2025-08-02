import { describe, it, expect, beforeEach, vi } from 'vitest';

import { PAPER_CONFIG } from '../config';
import { EnvBindings } from '../types';

import historyData from './__fixtures__/near-usdt-history.json';
import { ExchangeType } from './index';
import { PaperTradingAdapter } from './paper';

const createMockEnv = (): EnvBindings => {
	const kvStore = new Map<string, string>();

	return {
		TAAPI_SECRET: 'test-secret',
		BINANCE_API_URL: 'https://api.binance.com',
		NODE_URL: 'https://rpc.mainnet.near.org',
		REF_CONTRACT_ID: 'v2.ref-finance.near',
		ACCOUNT_ID: 'test.near',
		KV: {
			get: vi.fn(async (key: string, type?: string) => {
				const value = kvStore.get(key);
				if (!value) return null;
				return type === 'json' ? JSON.parse(value) : value;
			}),
			put: vi.fn(async (key: string, value: string) => {
				kvStore.set(key, value);
			}),
			delete: vi.fn(async (key: string) => {
				kvStore.delete(key);
			}),
			list: vi.fn(),
			getWithMetadata: vi.fn(),
			putWithMetadata: vi.fn()
		} as EnvBindings['KV'],
		DB: {} as EnvBindings['DB']
	};
};

describe('PaperTradingAdapter', () => {
	let adapter: PaperTradingAdapter;
	let mockEnv: EnvBindings;
	const symbol = 'NEAR/USDT';

	beforeEach(() => {
		mockEnv = createMockEnv();
		adapter = new PaperTradingAdapter(mockEnv);
	});

	describe('Basic Functionality', () => {
		it('should return correct exchange type', () => {
			expect(adapter.getExchangeType()).toBe(ExchangeType.ORDERBOOK);
		});

		it('should set and get current price', async () => {
			const newPrice = 150;
			adapter.setCurrentPrice(newPrice);
			const price = await adapter.getPrice(symbol);
			expect(price).toBe(newPrice);
		});

		it('should return initial balance correctly', async () => {
			const balance = await adapter.getBalance();
			expect(balance).toBe(PAPER_CONFIG.INITIAL_BALANCE);
		});

		it('should return no position initially', async () => {
			const position = await adapter.getPosition(symbol);
			expect(position).toBeNull();
		});
	});

	describe('Real Market Data Trading Simulation', () => {
		it('should handle a complete trading cycle with real market data', async () => {
			const firstCandle = historyData.data[0];
			const secondCandle = historyData.data[1];
			const openPrice = firstCandle.indicators.candle.open;
			const closePrice = secondCandle.indicators.candle.close;

			adapter.setCurrentPrice(openPrice);
			const tradeSize = 500;
			const options = {
				type: ExchangeType.ORDERBOOK as const,
				orderType: 'market' as const,
				leverage: 1
			};

			const openResult = await adapter.openLongPosition(symbol, tradeSize, options);
			expect(openResult.success).toBe(true);
			expect(openResult.executedPrice).toBe(openPrice);

			const position = await adapter.getPosition(symbol);
			expect(position).toBeTruthy();
			expect(position!.symbol).toBe(symbol);
			expect(position!.isLong).toBe(true);
			expect(position!.size).toBe(tradeSize / openPrice);

			const expectedFee = tradeSize * PAPER_CONFIG.DEFAULT_FEE;
			const expectedMargin = tradeSize * PAPER_CONFIG.INITIAL_MARGIN;
			const expectedBalance = PAPER_CONFIG.INITIAL_BALANCE - expectedFee - expectedMargin;
			const balanceAfterOpen = await adapter.getBalance();
			expect(balanceAfterOpen).toBe(expectedBalance);

			adapter.setCurrentPrice(closePrice);
			const closeResult = await adapter.closeLongPosition(symbol, position!.size, options);
			expect(closeResult.success).toBe(true);
			expect(closeResult.executedPrice).toBe(closePrice);

			const finalPosition = await adapter.getPosition(symbol);
			expect(finalPosition).toBeNull();

			const pnl = (closePrice - openPrice) * position!.size;
			const closeFee = position!.size * closePrice * PAPER_CONFIG.DEFAULT_FEE;
			const expectedFinalBalance = expectedBalance + expectedMargin + pnl - closeFee;
			const finalBalance = await adapter.getBalance();
			expect(finalBalance).toBeCloseTo(expectedFinalBalance, 6);

			console.log(`Trade completed:
				Entry: $${openPrice} -> Exit: $${closePrice}
				Position Size: ${position!.size.toFixed(4)} NEAR
				PnL: $${pnl.toFixed(2)}
				Final Balance: $${finalBalance.toFixed(2)}
			`);
		});
	});
});
