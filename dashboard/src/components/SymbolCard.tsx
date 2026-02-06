import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useLatestData, useLatestSignal } from '@/hooks/useApi';
import { formatCurrency, formatNumber } from '@/lib/format';

interface SymbolCardProps {
	symbol: string;
}

export function SymbolCard({ symbol }: SymbolCardProps) {
	const { data: latestData } = useLatestData(symbol);
	const { data: latestSignal } = useLatestSignal(symbol);

	const displaySymbol = symbol.replace('PERP_', '').replace('_USDC', '');
	const price = latestData?.indicators?.candle?.close;
	const taScore = latestSignal?.signal?.taScore;

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
		<div className="card group relative hover:border-primary/50 transition-colors">
			<Link
				to={`/market/${encodeURIComponent(symbol)}`}
				className="absolute top-3 right-3 p-2 text-text-muted hover:text-primary transition-colors"
				aria-label={`View details for ${displaySymbol}`}
			>
				<ArrowUpRight className="w-5 h-5" />
			</Link>

			<div className="pr-10">
				<h3 className="text-lg font-bold text-text">{displaySymbol}</h3>

				<div className="mt-4 space-y-2">
					<div>
						<p className="text-xs text-text-muted uppercase tracking-wide">Price</p>
						<p className="text-2xl font-bold text-text">
							{price !== undefined ? formatCurrency(price, 2) : '-'}
						</p>
					</div>

					<div>
						<p className="text-xs text-text-muted uppercase tracking-wide">TA Score</p>
						<div className="flex items-center gap-2">
							<p
								className={`text-xl font-bold ${taScore !== undefined ? getTaScoreColor(taScore) : 'text-text-muted'}`}
							>
								{taScore !== undefined ? formatNumber(taScore, 2) : '-'}
							</p>
							{taScore !== undefined && (
								<span className="text-xs text-text-muted">{getTaScoreLabel(taScore)}</span>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
