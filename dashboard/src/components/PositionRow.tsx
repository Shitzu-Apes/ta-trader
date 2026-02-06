import { formatCurrency, formatPercent, formatNumber } from '@/lib/format';
import type { Position } from '@/types';

interface PositionRowProps {
	position: Position;
}

export function PositionRow({ position }: PositionRowProps) {
	const pnlPercent = ((position.markPrice - position.entryPrice) / position.entryPrice) * 100;
	const isProfit = position.unrealizedPnl >= 0;

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
			<td className="py-4 px-4 text-text">{formatNumber(position.size, 4)}</td>
			<td className="py-4 px-4 text-text-muted">{formatCurrency(position.entryPrice, 2)}</td>
			<td className="py-4 px-4 text-text">{formatCurrency(position.markPrice, 2)}</td>
			<td className={`py-4 px-4 font-medium ${isProfit ? 'text-success' : 'text-danger'}`}>
				{formatCurrency(position.unrealizedPnl, 2)}
				<span className="text-xs ml-1">({formatPercent(pnlPercent)})</span>
			</td>
		</tr>
	);
}
