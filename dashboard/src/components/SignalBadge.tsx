import dayjs from 'dayjs';

import { formatCurrency, formatNumber, formatScore } from '@/lib/format';
import type { Signal } from '@/types';

interface SignalBadgeProps {
	signal: Signal;
}

export function SignalBadge({ signal }: SignalBadgeProps) {
	const typeColors = {
		ENTRY: 'bg-success/10 text-success border-success/20',
		EXIT: 'bg-danger/10 text-danger border-danger/20',
		STOP_LOSS: 'bg-danger/20 text-danger border-danger/30',
		TAKE_PROFIT: 'bg-success/20 text-success border-success/30',
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

	const getScoreColor = (score: number) => {
		if (score > 0) return 'text-success';
		if (score < 0) return 'text-danger';
		return 'text-text-muted';
	};

	const indicators = signal.indicators;

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
								Price: <span className="text-text">{formatCurrency(signal.price, 2)}</span>
							</span>
							<span className="text-text-muted">
								TA Score: <span className="text-text">{formatScore(signal.taScore, 2)}</span>
							</span>
						</div>
					)}

					{(signal.type === 'EXIT' ||
						signal.type === 'STOP_LOSS' ||
						signal.type === 'TAKE_PROFIT') &&
						signal.unrealizedPnl !== undefined && (
							<div className="mt-3 flex items-center gap-4 text-xs">
								<span className="text-text-muted">
									PnL:{' '}
									<span className={signal.unrealizedPnl >= 0 ? 'text-success' : 'text-danger'}>
										{formatCurrency(signal.unrealizedPnl, 2)}
									</span>
								</span>
							</div>
						)}
				</div>

				<div className="ml-4 text-right">
					<div className="text-2xl font-bold text-text">{formatNumber(signal.taScore, 1)}</div>
					<div className="text-xs text-text-muted">TA Score</div>
				</div>
			</div>

			{/* Individual Scores Breakdown - Always Visible */}
			{indicators && (
				<div className="mt-3 pt-2 border-t border-surface/50 flex gap-4 text-xs">
					<span className={getScoreColor(indicators.vwap)}>
						VWAP: {formatScore(indicators.vwap, 1)}
					</span>
					<span className={getScoreColor(indicators.bbands)}>
						BBands: {formatScore(indicators.bbands, 1)}
					</span>
					<span className={getScoreColor(indicators.rsi)}>
						RSI: {formatScore(indicators.rsi, 1)}
					</span>
					<span className={getScoreColor(indicators.obv)}>
						OBV: {formatScore(indicators.obv, 1)}
					</span>
				</div>
			)}
		</div>
	);
}
