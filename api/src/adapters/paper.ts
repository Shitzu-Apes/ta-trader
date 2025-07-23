import { PAPER_CONFIG } from '../config';
import { Position } from '../trading';
import { EnvBindings } from '../types';

import {
	ExchangeType,
	TradingAdapter,
	MarketInfo,
	LiquidityDepth,
	TradeOptions,
	TradeResult
} from './index';

interface PaperPosition {
	symbol: string;
	size: number;
	entryPrice: number;
	timestamp: number;
	isLong: boolean;
	leverage: number;
	margin: number;
	fundingPaid: number;
}

export class PaperTradingAdapter implements TradingAdapter {
	private currentPrice: number | null = null;
	private readonly env: EnvBindings;

	constructor(env: EnvBindings) {
		this.env = env;
	}

	setCurrentPrice(price: number): void {
		this.currentPrice = price;
	}

	private getCurrentPrice(): number {
		if (this.currentPrice === null) {
			throw new Error('Current price not set. Call setCurrentPrice first.');
		}
		return this.currentPrice;
	}

	getExchangeType(): ExchangeType {
		return ExchangeType.ORDERBOOK;
	}

	async getMarketInfo(symbol: string): Promise<MarketInfo> {
		return {
			type: ExchangeType.ORDERBOOK,
			baseToken: symbol.split('/')[0],
			quoteToken: symbol.split('/')[1],
			baseDecimals: PAPER_CONFIG.BASE_DECIMALS,
			quoteDecimals: PAPER_CONFIG.QUOTE_DECIMALS,
			minTradeSize: PAPER_CONFIG.MIN_TRADE_SIZE,
			maxTradeSize: PAPER_CONFIG.MAX_TRADE_SIZE,
			marketId: symbol,
			tickSize: 0.01,
			stepSize: 0.01
		};
	}

	async getPrice(_symbol: string, _size?: number): Promise<number> {
		return this.getCurrentPrice();
	}

	async getLiquidityDepth(_symbol: string): Promise<LiquidityDepth> {
		return {
			type: ExchangeType.ORDERBOOK,
			orderBook: {
				bids: [
					{
						price: this.getCurrentPrice() * (1 - PAPER_CONFIG.SPREAD),
						size: PAPER_CONFIG.INFINITE_LIQUIDITY_SIZE
					}
				],
				asks: [
					{
						price: this.getCurrentPrice() * (1 + PAPER_CONFIG.SPREAD),
						size: PAPER_CONFIG.INFINITE_LIQUIDITY_SIZE
					}
				]
			}
		};
	}

	async getBalance(): Promise<number> {
		const balance = await this.env.KV.get<number>('paper:balance:USDC', 'json');
		return balance ?? PAPER_CONFIG.INITIAL_BALANCE;
	}

	private async updateBalance(balance: number): Promise<void> {
		await this.env.KV.put('paper:balance:USDC', JSON.stringify(balance));
	}

	async getPosition(symbol: string): Promise<Position | null> {
		const key = `paper:position:${symbol}`;
		const paperPosition = await this.env.KV.get<PaperPosition>(key, 'json');

		if (!paperPosition) return null;

		// Convert paper position to common position format
		return {
			symbol: paperPosition.symbol,
			size: paperPosition.size,
			isLong: paperPosition.isLong,
			lastUpdateTime: paperPosition.timestamp,
			cumulativePnl: 0, // Stats tracked separately
			successfulTrades: 0,
			totalTrades: 0,
			partials: [
				{
					size: paperPosition.size,
					entryPrice: paperPosition.entryPrice,
					openedAt: paperPosition.timestamp
				}
			]
		};
	}

	private async getPaperPosition(symbol: string): Promise<PaperPosition | null> {
		const key = `paper:position:${symbol}`;
		return this.env.KV.get<PaperPosition>(key, 'json');
	}

	private calculateMarginRatio(position: PaperPosition): number {
		const positionValue = Math.abs(position.size * this.getCurrentPrice());
		const unrealizedPnl = this.calculateUnrealizedPnl(position);
		return (position.margin + unrealizedPnl) / positionValue;
	}

	private calculateUnrealizedPnl(position: PaperPosition): number {
		const currentValue = position.size * this.getCurrentPrice();
		const entryValue = position.size * position.entryPrice;
		return position.isLong ? currentValue - entryValue : entryValue - currentValue;
	}

	private calculateFundingPayment(position: PaperPosition): number {
		const hoursSinceLastUpdate = (Date.now() - position.timestamp) / (1000 * 60 * 60);
		const positionValue = Math.abs(position.size * this.getCurrentPrice());
		return positionValue * PAPER_CONFIG.FUNDING_RATE * hoursSinceLastUpdate;
	}

	private async checkAndHandleLiquidation(position: PaperPosition): Promise<boolean> {
		const marginRatio = this.calculateMarginRatio(position);
		if (marginRatio < PAPER_CONFIG.LIQUIDATION_THRESHOLD) {
			// Liquidate position
			await this.updatePaperPosition(null, position.symbol);
			return true;
		}
		return false;
	}

	async openLongPosition(
		symbol: string,
		size: number,
		options: TradeOptions
	): Promise<TradeResult> {
		if (options.type !== ExchangeType.ORDERBOOK) {
			throw new Error('Invalid options type for paper trading');
		}

		const leverage = options.leverage ?? 1;
		if (leverage > PAPER_CONFIG.MAX_LEVERAGE) {
			throw new Error(`Leverage cannot exceed ${PAPER_CONFIG.MAX_LEVERAGE}x`);
		}

		// size is in USDC, convert to base token amount
		const baseTokenAmount = size / this.getCurrentPrice();
		const positionValue = size; // size is already in USDC
		const requiredMargin = (positionValue * PAPER_CONFIG.INITIAL_MARGIN) / leverage;
		const fee = positionValue * PAPER_CONFIG.DEFAULT_FEE;
		const totalRequired = requiredMargin + fee;

		const balance = await this.getBalance();
		if (totalRequired > balance) {
			throw new Error('Insufficient balance for margin requirement and fees');
		}

		// Update balance
		await this.updateBalance(balance - totalRequired);

		// Create or update position
		const existingPosition = await this.getPaperPosition(symbol);
		const newPosition: PaperPosition = existingPosition
			? {
					...existingPosition,
					size: existingPosition.size + baseTokenAmount,
					entryPrice:
						(existingPosition.entryPrice * existingPosition.size +
							this.getCurrentPrice() * baseTokenAmount) /
						(existingPosition.size + baseTokenAmount),
					margin: existingPosition.margin + requiredMargin,
					timestamp: Date.now(),
					fundingPaid: existingPosition.fundingPaid
				}
			: {
					symbol,
					size: baseTokenAmount,
					entryPrice: this.getCurrentPrice(),
					timestamp: Date.now(),
					isLong: true,
					leverage,
					margin: requiredMargin,
					fundingPaid: 0
				};

		await this.updatePaperPosition(newPosition, symbol);

		return {
			type: ExchangeType.ORDERBOOK,
			success: true,
			executedPrice: this.getCurrentPrice(),
			executedSize: baseTokenAmount,
			fee,
			orderId: `paper-${Date.now()}`
		};
	}

	async openShortPosition(
		symbol: string,
		size: number,
		options: TradeOptions
	): Promise<TradeResult> {
		if (options.type !== ExchangeType.ORDERBOOK) {
			throw new Error('Invalid options type for paper trading');
		}

		const leverage = options.leverage ?? 1;
		if (leverage > PAPER_CONFIG.MAX_LEVERAGE) {
			throw new Error(`Leverage cannot exceed ${PAPER_CONFIG.MAX_LEVERAGE}x`);
		}

		// size is in USDC, convert to base token amount
		const baseTokenAmount = size / this.getCurrentPrice();
		const positionValue = size; // size is already in USDC
		const requiredMargin = (positionValue * PAPER_CONFIG.INITIAL_MARGIN) / leverage;
		const fee = positionValue * PAPER_CONFIG.DEFAULT_FEE;
		const totalRequired = requiredMargin + fee;

		const balance = await this.getBalance();
		if (totalRequired > balance) {
			throw new Error('Insufficient balance for margin requirement and fees');
		}

		// Update balance
		await this.updateBalance(balance - totalRequired);

		// Create position (shorts are always new positions)
		const newPosition: PaperPosition = {
			symbol,
			size: -baseTokenAmount, // Negative size indicates short position
			entryPrice: this.getCurrentPrice(),
			timestamp: Date.now(),
			isLong: false,
			leverage,
			margin: requiredMargin,
			fundingPaid: 0
		};

		await this.updatePaperPosition(newPosition, symbol);

		return {
			type: ExchangeType.ORDERBOOK,
			success: true,
			executedPrice: this.getCurrentPrice(),
			executedSize: baseTokenAmount,
			fee,
			orderId: `paper-${Date.now()}`
		};
	}

	async closeLongPosition(
		symbol: string,
		size: number,
		options: TradeOptions
	): Promise<TradeResult> {
		if (options.type !== ExchangeType.ORDERBOOK) {
			throw new Error('Invalid options type for paper trading');
		}

		const position = await this.getPaperPosition(symbol);
		if (!position || !position.isLong || position.size < size) {
			throw new Error('Insufficient long position size to close');
		}

		// Calculate funding payment before closing
		const fundingPayment = this.calculateFundingPayment(position);

		// size is in base token amount
		const value = size * this.getCurrentPrice(); // Convert to USDC value
		const fee = value * PAPER_CONFIG.DEFAULT_FEE;
		const pnl = (this.getCurrentPrice() - position.entryPrice) * size;
		const marginToRelease = (position.margin * size) / position.size;
		const netValue = marginToRelease + pnl - fee - fundingPayment;

		// Update balance
		const balance = await this.getBalance();
		await this.updateBalance(balance + netValue);

		// Update position
		const remainingSize = position.size - size;
		if (remainingSize > 0) {
			await this.updatePaperPosition(
				{
					...position,
					size: remainingSize,
					margin: position.margin - marginToRelease,
					timestamp: Date.now(),
					fundingPaid: position.fundingPaid + fundingPayment
				},
				symbol
			);
		} else {
			// Delete position if fully closed
			await this.updatePaperPosition(null, symbol);
		}

		return {
			type: ExchangeType.ORDERBOOK,
			success: true,
			executedPrice: this.getCurrentPrice(),
			executedSize: size,
			fee,
			orderId: `paper-${Date.now()}`
		};
	}

	async closeShortPosition(
		symbol: string,
		size: number,
		options: TradeOptions
	): Promise<TradeResult> {
		if (options.type !== ExchangeType.ORDERBOOK) {
			throw new Error('Invalid options type for paper trading');
		}

		const position = await this.getPaperPosition(symbol);
		if (!position || position.isLong || Math.abs(position.size) < size) {
			throw new Error('Insufficient short position size to close');
		}

		// Calculate funding payment before closing
		const fundingPayment = this.calculateFundingPayment(position);

		// size is in base token amount
		const value = size * this.getCurrentPrice(); // Convert to USDC value
		const fee = value * PAPER_CONFIG.DEFAULT_FEE;
		const pnl = (position.entryPrice - this.getCurrentPrice()) * size;
		const marginToRelease = (position.margin * size) / Math.abs(position.size);
		const netValue = marginToRelease + pnl - fee - fundingPayment;

		// Update balance
		const balance = await this.getBalance();
		await this.updateBalance(balance + netValue);

		// Update position
		const remainingSize = Math.abs(position.size) - size;
		if (remainingSize > 0) {
			await this.updatePaperPosition(
				{
					...position,
					size: -remainingSize, // Keep negative for shorts
					margin: position.margin - marginToRelease,
					timestamp: Date.now(),
					fundingPaid: position.fundingPaid + fundingPayment
				},
				symbol
			);
		} else {
			// Delete position if fully closed
			await this.updatePaperPosition(null, symbol);
		}

		return {
			type: ExchangeType.ORDERBOOK,
			success: true,
			executedPrice: this.getCurrentPrice(),
			executedSize: size,
			fee,
			orderId: `paper-${Date.now()}`
		};
	}

	async getExpectedTradeReturn(
		symbol: string,
		size: number,
		isLong: boolean,
		isOpen: boolean,
		options: TradeOptions
	) {
		if (options.type !== ExchangeType.ORDERBOOK) {
			throw new Error('Invalid options type for paper trading');
		}

		const leverage = options.leverage ?? 1;
		let positionValue;
		let expectedSize;

		if (isOpen) {
			// For opening positions, size is in USDC
			positionValue = size;
			expectedSize = size / this.getCurrentPrice(); // Convert to base token amount
		} else {
			// For closing positions, size is in base token
			positionValue = size * this.getCurrentPrice();
			expectedSize = size;
		}

		const fee = positionValue * PAPER_CONFIG.DEFAULT_FEE;
		let margin = 0;
		if (isOpen) {
			margin = (positionValue * PAPER_CONFIG.INITIAL_MARGIN) / leverage;
		}

		return {
			type: ExchangeType.ORDERBOOK as const,
			expectedPrice: this.getCurrentPrice(),
			expectedSize,
			fee,
			margin
		};
	}

	async isMarketActive(_symbol: string): Promise<boolean> {
		return true;
	}

	async getFees(_symbol: string): Promise<{
		type: ExchangeType.ORDERBOOK;
		makerFee: number;
		takerFee: number;
	}> {
		return {
			type: ExchangeType.ORDERBOOK,
			makerFee: PAPER_CONFIG.DEFAULT_FEE,
			takerFee: PAPER_CONFIG.DEFAULT_FEE
		};
	}

	private async updatePaperPosition(position: PaperPosition | null, symbol: string): Promise<void> {
		const key = `paper:position:${symbol}`;
		if (position) {
			await this.env.KV.put(key, JSON.stringify(position));
		} else {
			await this.env.KV.delete(key);
		}
	}
}
