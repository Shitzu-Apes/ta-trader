import dayjs from 'dayjs';

import type { Signal } from '@/types';

interface SignalBadgeProps {
	signal: Signal;
}

export function SignalBadge({ signal }: SignalBadgeProps) {
	const typeColors = {
		ENTRY: 'bg-success/10 text-success border-success/20',
		EXIT: 'bg-danger/10 text-danger border-danger/20',
		ADJUSTMENT: 'bg-info/10 text-info border-info/20',
		HOLD: 'bg-warning/10 text-warning border-warning/20',
		NO_ACTION: 'bg-text-muted/10 text-text-muted border-text-muted/20'
	};

	const directionColors = {
		LONG: 'text-success',
		SHORT: 'text-danger'
	};

	const formatTime = (timestamp: number) => {
		return dayjs(timestamp).format('lll');
	};

	return (
		<div className="card border-l-4 border-l-primary">
			<div className="flex items-start justify-between">
				<div className="flex-1">
					<div className="flex items-center gap-2 mb-2">
						<span
							className={`px-2 py-1 rounded text-xs font-medium border ${typeColors[signal.type]}`}
						>
							{signal.type}
						</span>
						<span className={`text-sm font-medium ${directionColors[signal.direction]}`}>
							{signal.direction}
						</span>
						<span className="text-xs text-text-muted">{formatTime(signal.timestamp)}</span>
					</div>

					<p className="text-sm text-text mb-1">{signal.action}</p>
					<p className="text-xs text-text-muted">{signal.reason}</p>

					{signal.type === 'ENTRY' && (
						<div className="mt-3 flex items-center gap-4 text-xs">
							<span className="text-text-muted">
								Price: <span className="text-text">${signal.price.toFixed(2)}</span>
							</span>
							<span className="text-text-muted">
								TA Score: <span className="text-text">{signal.taScore.toFixed(2)}</span>
							</span>
						</div>
					)}

					{signal.type === 'EXIT' && signal.unrealizedPnl !== undefined && (
						<div className="mt-3 flex items-center gap-4 text-xs">
							<span className="text-text-muted">
								PnL:{' '}
								<span className={signal.unrealizedPnl >= 0 ? 'text-success' : 'text-danger'}>
									{signal.unrealizedPnl >= 0 ? '+' : ''}${signal.unrealizedPnl.toFixed(2)}
								</span>
							</span>
						</div>
					)}
				</div>

				<div className="ml-4 text-right">
					<div className="text-2xl font-bold text-text">{signal.taScore.toFixed(1)}</div>
					<div className="text-xs text-text-muted">TA Score</div>
				</div>
			</div>
		</div>
	);
}
