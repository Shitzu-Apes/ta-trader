import type { Position } from '@/types';

interface PositionRowProps {
	position: Position;
}

export function PositionRow({ position }: PositionRowProps) {
	const pnlPercent = ((position.markPrice - position.entryPrice) / position.entryPrice) * 100;
	const isProfit = position.unrealizedPnl >= 0;

	const formatPrice = (price: number) =>
		`$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
	const formatSize = (size: number) =>
		size.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
	const formatPnl = (pnl: number) => {
		const sign = pnl >= 0 ? '+' : '';
		return `${sign}$${pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	};

	return (
		<tr className="border-b border-border hover:bg-surface-hover transition-colors">
			<td className="py-4 px-4">
				<div className="font-medium text-text">
					{position.symbol.replace('PERP_', '').replace('_USDC', '')}
				</div>
			</td>
			<td className="py-4 px-4">
				<span
					className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
						position.isLong ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
					}`}
				>
					{position.isLong ? 'LONG' : 'SHORT'}
				</span>
			</td>
			<td className="py-4 px-4 text-text">{formatSize(position.size)}</td>
			<td className="py-4 px-4 text-text-muted">{formatPrice(position.entryPrice)}</td>
			<td className="py-4 px-4 text-text">{formatPrice(position.markPrice)}</td>
			<td className={`py-4 px-4 font-medium ${isProfit ? 'text-success' : 'text-danger'}`}>
				{formatPnl(position.unrealizedPnl)}
				<span className="text-xs ml-1">
					({pnlPercent >= 0 ? '+' : ''}
					{pnlPercent.toFixed(2)}%)
				</span>
			</td>
		</tr>
	);
}
