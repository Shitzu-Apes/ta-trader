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
			{/* Top Row: Type + Direction | Individual Scores */}
			<div className="flex items-center justify-between mb-2">
				<div className="flex items-center gap-2 flex-wrap">
					{signal.type === 'ADJUSTMENT' && signal.action ? (
						<span
							className={`px-2 py-1 rounded text-xs font-medium border ${typeColors[signal.type]}`}
						>
							{signal.action} {signal.direction}
						</span>
					) : (
						<>
							<span
								className={`px-2 py-1 rounded text-xs font-medium border ${typeColors[signal.type]}`}
							>
								{signal.type}
							</span>
							<span className={`text-sm font-medium ${directionColors[signal.direction]}`}>
								{signal.direction}
							</span>
						</>
					)}
				</div>

				{/* Individual Scores */}
				{indicators && (
					<div className="flex items-center gap-3 text-xs">
						<span className={getScoreColor(indicators.vwap)}>
							VWAP {formatScore(indicators.vwap, 1)}
						</span>
						<span className={getScoreColor(indicators.bbands)}>
							BB {formatScore(indicators.bbands, 1)}
						</span>
						<span className={getScoreColor(indicators.rsi)}>
							RSI {formatScore(indicators.rsi, 1)}
						</span>
						<span className={getScoreColor(indicators.obv)}>
							OBV {formatScore(indicators.obv, 1)}
						</span>
					</div>
				)}
			</div>

			{/* Info Row: Score + Price + Threshold + Reason */}
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm mb-2">
				<span className="text-text-muted">
					Score:{' '}
					<span className={`font-medium ${getScoreColor(signal.taScore)}`}>
						{formatScore(signal.taScore, 2)}
					</span>
				</span>
				<span className="text-text-muted">
					Price: <span className="text-text">{formatCurrency(signal.price, 2)}</span>
				</span>
				<span className="text-text-muted">
					Threshold:{' '}
					<span className={getScoreColor(signal.threshold)}>
						{formatScore(signal.threshold, 2)}
					</span>
				</span>
				{signal.reason && signal.reason.trim() !== '' && (
					<span className="text-text-muted">
						Reason: <span className="text-text">{signal.reason}</span>
					</span>
				)}
			</div>

			{/* Position Info Row */}
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm mb-2">
				{signal.positionSize !== undefined && signal.positionSize !== 0 && (
					<span className="text-text-muted">
						Size: <span className="text-text">{formatNumber(signal.positionSize, 2)}</span>
					</span>
				)}
				{signal.entryPrice !== undefined && signal.entryPrice !== 0 && (
					<span className="text-text-muted">
						Entry: <span className="text-text">{formatCurrency(signal.entryPrice, 2)}</span>
					</span>
				)}
				{/* Adjustment details */}
				{signal.type === 'ADJUSTMENT' && signal.currentSize !== undefined && (
					<span className="text-text-muted">
						Current: <span className="text-text">{formatNumber(signal.currentSize, 2)}</span>
					</span>
				)}
				{signal.type === 'ADJUSTMENT' && signal.targetSize !== undefined && (
					<span className="text-text-muted">
						Target: <span className="text-text">{formatNumber(signal.targetSize, 2)}</span>
					</span>
				)}
				{signal.intensity !== undefined && (
					<span className="text-text-muted">
						Intensity: <span className="text-text">{formatNumber(signal.intensity, 2)}</span>
					</span>
				)}
			</div>

			{/* PnL Row for exit signals - unrealized becomes realized when position is closed */}
			{(signal.type === 'EXIT' || signal.type === 'STOP_LOSS' || signal.type === 'TAKE_PROFIT') &&
				(signal.unrealizedPnl !== undefined || signal.realizedPnl !== undefined) && (
					<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm mb-2">
						{/* For closed positions, show the final PnL as Realized (the unrealized value at close becomes realized) */}
						{signal.unrealizedPnl !== undefined && (
							<span className="text-text-muted">
								PnL:{' '}
								<span className={signal.unrealizedPnl >= 0 ? 'text-success' : 'text-danger'}>
									{formatCurrency(signal.unrealizedPnl, 2)}
								</span>
							</span>
						)}
					</div>
				)}

			{/* Score Multipliers Row */}
			{(signal.profitScore !== undefined || signal.timeDecayScore !== undefined) && (
				<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm mb-2">
					{signal.profitScore !== undefined && (
						<span className="text-text-muted">
							Profit Score:{' '}
							<span className={getScoreColor(signal.profitScore)}>
								{formatScore(signal.profitScore, 2)}
							</span>
						</span>
					)}
					{signal.timeDecayScore !== undefined && (
						<span className="text-text-muted">
							Time Decay:{' '}
							<span className={getScoreColor(signal.timeDecayScore)}>
								{formatScore(signal.timeDecayScore, 2)}
							</span>
						</span>
					)}
					{signal.availableLeverage !== undefined && (
						<span className="text-text-muted">
							Leverage: <span className="text-text">{signal.availableLeverage}x</span>
						</span>
					)}
				</div>
			)}

			{/* Bottom: Timestamp */}
			<div className="text-xs text-text-muted">{formatTime(signal.timestamp)}</div>
		</div>
	);
}
