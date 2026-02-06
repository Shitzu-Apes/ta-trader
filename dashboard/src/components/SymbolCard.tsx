import { TrendingUp, TrendingDown } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useLatestData, useLatestSignal, useHistory } from '@/hooks/useApi';
import { formatCurrency, formatNumber } from '@/lib/format';
import type { Signal } from '@/types';

interface SymbolCardProps {
	symbol: string;
}

const typeConfig: Record<Signal['type'], { label: string; color: string }> = {
	ENTRY: { label: 'Entry', color: 'bg-success/10 text-success border-success/20' },
	EXIT: { label: 'Exit', color: 'bg-danger/10 text-danger border-danger/20' },
	STOP_LOSS: { label: 'Stop Loss', color: 'bg-danger/20 text-danger border-danger/30' },
	TAKE_PROFIT: { label: 'Take Profit', color: 'bg-success/20 text-success border-success/30' },
	ADJUSTMENT: { label: 'Adjustment', color: 'bg-info/10 text-info border-info/20' },
	HOLD: { label: 'Hold', color: 'bg-warning/10 text-warning border-warning/20' },
	NO_ACTION: { label: 'No Action', color: 'bg-text-muted/10 text-text-muted border-text-muted/20' }
};

export function SymbolCard({ symbol }: SymbolCardProps) {
	const { data: latestData } = useLatestData(symbol);
	const { data: latestSignal } = useLatestSignal(symbol);
	const { data: historyData } = useHistory(symbol, 100);

	const displaySymbol = symbol.replace('PERP_', '').replace('_USDC', '');
	const price = latestData?.indicators?.candle?.close;
	const volume = latestData?.indicators?.candle?.volume;
	const taScore = latestSignal?.signal?.taScore;
	const lastSignal = latestSignal?.signal;

	// Calculate 24h price change
	const calculate24hChange = () => {
		if (!historyData?.data || historyData.data.length < 2 || !price) return null;

		// Find data point closest to 24h ago
		const now = Date.now();
		const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

		// Sort by timestamp descending and find first point >= 24h ago
		const sortedData = [...historyData.data].sort((a, b) => b.timestamp - a.timestamp);
		const dayAgoPoint = sortedData.find((d) => d.timestamp <= twentyFourHoursAgo);

		if (!dayAgoPoint) return null;

		const oldPrice = dayAgoPoint.indicators.candle?.close;
		if (!oldPrice) return null;

		const change = ((price - oldPrice) / oldPrice) * 100;
		return change;
	};

	const priceChange24h = calculate24hChange();

	const getTaScoreColor = (score: number) => {
		if (score >= 2) return 'text-success';
		if (score >= 0.5) return 'text-success/80';
		if (score >= -0.5) return 'text-text-muted';
		if (score >= -2) return 'text-danger/80';
		return 'text-danger';
	};

	const getTaScoreLabel = (score: number) => {
		if (score >= 2) return 'Strong Buy';
		if (score >= 0.5) return 'Buy';
		if (score >= -0.5) return 'Neutral';
		if (score >= -2) return 'Sell';
		return 'Strong Sell';
	};

	return (
		<Link
			to={`/markets/${encodeURIComponent(symbol)}`}
			className="card group block relative hover:border-primary/50 transition-colors"
		>
			<div className="pr-10">
				<div className="flex items-center justify-between">
					<h3 className="text-lg font-bold text-text">{displaySymbol}</h3>
					{lastSignal && (
						<span
							className={`text-xs font-medium px-2 py-1 rounded border ${typeConfig[lastSignal.type].color}`}
						>
							{typeConfig[lastSignal.type].label}
						</span>
					)}
				</div>

				<div className="mt-4 space-y-3">
					<div>
						<p className="text-xs text-text-muted uppercase tracking-wide">Price</p>
						<div className="flex items-center gap-2">
							<p className="text-2xl font-bold text-text">
								{price !== undefined ? formatCurrency(price, 2) : '-'}
							</p>
							{priceChange24h !== null && (
								<div
									className={`flex items-center gap-1 text-sm ${priceChange24h >= 0 ? 'text-success' : 'text-danger'}`}
								>
									{priceChange24h >= 0 ? (
										<TrendingUp className="w-4 h-4" />
									) : (
										<TrendingDown className="w-4 h-4" />
									)}
									<span>
										{priceChange24h >= 0 ? '+' : ''}
										{priceChange24h.toFixed(2)}%
									</span>
								</div>
							)}
						</div>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div>
							<p className="text-xs text-text-muted uppercase tracking-wide">TA Score</p>
							<div className="flex flex-col">
								<p
									className={`text-xl font-bold ${taScore !== undefined ? getTaScoreColor(taScore) : 'text-text-muted'}`}
								>
									{taScore !== undefined ? formatNumber(taScore, 2) : '-'}
								</p>
								{taScore !== undefined && (
									<span className="text-xs text-text-muted truncate">
										{getTaScoreLabel(taScore)}
									</span>
								)}
							</div>
						</div>
						<div>
							<p className="text-xs text-text-muted uppercase tracking-wide">Volume (USD)</p>
							<p className="text-lg font-bold text-text">
								{volume !== undefined && price !== undefined
									? formatCurrency(volume * price, 0)
									: '-'}
							</p>
						</div>
					</div>
				</div>
			</div>
		</Link>
	);
}
