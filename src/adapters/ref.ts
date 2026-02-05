import { FixedNumber } from '../FixedNumber';
import { REF_CONFIG } from '../config';
import { view } from '../near';
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

export type PoolInfo = {
	pool_kind: string;
	token_account_ids: string[];
	amounts: string[];
	total_fee: number;
	shares_total_supply: string;
	amp: number;
};

type SmartRouterResponse = {
	result_code: number;
	result_message: string;
	result_data: {
		routes: {
			pools: {
				pool_id: string;
				token_in: string;
				token_out: string;
				amount_in: string;
				amount_out: string;
				min_amount_out: string;
			}[];
			amount_in: string;
			min_amount_out: string;
			amount_out: string;
		}[];
		contract_in: string;
		contract_out: string;
		amount_in: string;
		amount_out: string;
	};
};

export class RefFinanceAdapter implements TradingAdapter {
	private env: EnvBindings;

	constructor(env: EnvBindings) {
		this.env = env;
	}

	getExchangeType(): ExchangeType {
		return ExchangeType.AMM;
	}

	async getBalance(): Promise<number> {
		const balance = await this.env.KV.get<number>('ref:balance:USDC', 'json');
		return balance ?? 0; // REF adapter starts with 0 balance, user needs to deposit
	}

	private async updateBalance(balance: number): Promise<void> {
		await this.env.KV.put('ref:balance:USDC', JSON.stringify(balance));
	}

	async getMarketInfo(symbol: string): Promise<MarketInfo> {
		const info = REF_CONFIG.SYMBOLS[symbol as keyof typeof REF_CONFIG.SYMBOLS];
		if (!info) {
			throw new Error(`Unsupported symbol: ${symbol}`);
		}

		const baseInfo = REF_CONFIG.TOKENS[info.base as keyof typeof REF_CONFIG.TOKENS];
		const quoteInfo = REF_CONFIG.TOKENS[info.quote as keyof typeof REF_CONFIG.TOKENS];

		return {
			type: ExchangeType.AMM,
			baseToken: info.base,
			quoteToken: info.quote,
			baseDecimals: baseInfo.decimals,
			quoteDecimals: quoteInfo.decimals,
			poolId: info.poolId,
			poolFee: await this.getPoolFee(info.poolId),
			minTradeSize: REF_CONFIG.MIN_TRADE_SIZE,
			maxTradeSize: REF_CONFIG.MAX_TRADE_SIZE,
			marketId: info.poolId.toString()
		};
	}

	private async getPoolFee(poolId: number): Promise<number> {
		const pool = await this.getPool(poolId);
		return pool.total_fee / 10000; // Convert from basis points
	}

	async getPrice(_symbol: string, _size?: number): Promise<number> {
		// TODO: Implement price calculation based on reserves or router
		// Could use getExpectedTradeReturn with a small size if no direct price method
		throw new Error('Method not implemented.');
	}

	async getLiquidityDepth(symbol: string): Promise<LiquidityDepth> {
		const info = REF_CONFIG.SYMBOLS[symbol as keyof typeof REF_CONFIG.SYMBOLS];
		if (!info) {
			throw new Error(`Unsupported symbol: ${symbol}`);
		}

		const pool = await this.getPool(info.poolId);
		const [baseReserve, quoteReserve] = pool.amounts.map(Number);

		return {
			type: ExchangeType.AMM,
			poolLiquidity: {
				baseReserve,
				quoteReserve,
				totalLiquidity: baseReserve + quoteReserve // TODO: Calculate proper total liquidity
			}
		};
	}

	async openLongPosition(
		symbol: string,
		size: number,
		options: TradeOptions
	): Promise<TradeResult> {
		if (options.type !== ExchangeType.AMM) {
			throw new Error('Invalid options type for AMM');
		}

		// TODO: Implement actual trade execution
		// This will need integration with the actual contract calls
		const expectedReturn = await this.getExpectedTradeReturn(symbol, size, true, true, options);

		return {
			type: ExchangeType.AMM,
			success: false, // TODO: Implement actual trade
			executedPrice: expectedReturn.expectedPrice,
			executedSize: expectedReturn.expectedSize,
			fee: expectedReturn.fee,
			priceImpact: expectedReturn.priceImpact,
			route: expectedReturn.route
		};
	}

	async closeLongPosition(
		symbol: string,
		size: number,
		options: TradeOptions
	): Promise<TradeResult> {
		if (options.type !== ExchangeType.AMM) {
			throw new Error('Invalid options type for AMM');
		}

		// TODO: Implement actual trade execution
		const expectedReturn = await this.getExpectedTradeReturn(symbol, size, true, false, options);

		return {
			type: ExchangeType.AMM,
			success: false, // TODO: Implement actual trade
			executedPrice: expectedReturn.expectedPrice,
			executedSize: expectedReturn.expectedSize,
			fee: expectedReturn.fee,
			priceImpact: expectedReturn.priceImpact,
			route: expectedReturn.route
		};
	}

	async getExpectedTradeReturn(
		symbol: string,
		size: number,
		isLong: boolean,
		isOpen: boolean,
		options: TradeOptions
	) {
		if (options.type !== ExchangeType.AMM) {
			throw new Error('Invalid options type for AMM');
		}

		const info = REF_CONFIG.SYMBOLS[symbol as keyof typeof REF_CONFIG.SYMBOLS];
		if (!info) {
			throw new Error(`Unsupported symbol: ${symbol}`);
		}

		const tokenIn = isOpen ? info.quote : info.base;
		const tokenOut = isOpen ? info.base : info.quote;
		const decimalsIn = REF_CONFIG.TOKENS[tokenIn as keyof typeof REF_CONFIG.TOKENS].decimals;

		const amountIn = new FixedNumber(BigInt(Math.floor(size * 10 ** decimalsIn)), decimalsIn);

		const response = await this.findBestRoute({
			tokenIn,
			tokenOut,
			amountIn: amountIn.toU128(),
			slippage: options.slippage ?? REF_CONFIG.DEFAULT_SLIPPAGE,
			pathDeep: options.routeHops ?? REF_CONFIG.DEFAULT_ROUTE_HOPS
		});

		if (response.result_code !== 0) {
			throw new Error(`Smart Router error: ${response.result_message}`);
		}

		const route = response.result_data.routes[0].pools.map((pool) => ({
			poolId: parseInt(pool.pool_id),
			tokenIn: pool.token_in,
			tokenOut: pool.token_out
		}));

		const expectedSize =
			Number(response.result_data.amount_out) /
			10 ** REF_CONFIG.TOKENS[tokenOut as keyof typeof REF_CONFIG.TOKENS].decimals;
		const expectedPrice = size / expectedSize;

		return {
			type: ExchangeType.AMM as const,
			expectedPrice,
			expectedSize,
			fee: 0.003, // TODO: Calculate actual fee
			minAmountOut: Number(response.result_data.routes[0].min_amount_out),
			priceImpact: 0, // TODO: Calculate price impact
			route
		};
	}

	async isMarketActive(symbol: string): Promise<boolean> {
		try {
			const info = REF_CONFIG.SYMBOLS[symbol as keyof typeof REF_CONFIG.SYMBOLS];
			if (!info) return false;

			const pool = await this.getPool(info.poolId);
			return pool.amounts.every((amount) => Number(amount) > 0);
		} catch {
			return false;
		}
	}

	async getPosition(_symbol: string): Promise<Position | null> {
		// REF Finance doesn't support position tracking
		return null;
	}

	// Helper methods from original Ref class
	private async getPool(poolId: number): Promise<PoolInfo> {
		return view<PoolInfo>(
			this.env.REF_CONTRACT_ID,
			'get_pool',
			{
				pool_id: poolId
			},
			this.env
		);
	}

	private async findBestRoute({
		tokenIn,
		tokenOut,
		amountIn,
		slippage = REF_CONFIG.DEFAULT_SLIPPAGE,
		pathDeep = REF_CONFIG.DEFAULT_ROUTE_HOPS
	}: {
		tokenIn: string;
		tokenOut: string;
		amountIn: string;
		slippage?: number;
		pathDeep?: number;
	}): Promise<SmartRouterResponse> {
		const url = `https://smartrouter.ref.finance/findPath?amountIn=${amountIn}&tokenIn=${tokenIn}&tokenOut=${tokenOut}&pathDeep=${pathDeep}&slippage=${slippage}`;

		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Smart Router API error: ${response.status}`);
		}

		return response.json();
	}
}
