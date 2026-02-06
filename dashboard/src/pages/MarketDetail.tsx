import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';

import { SignalBadge } from '@/components/SignalBadge';
import { useLatestData, useLatestSignal, useSignals } from '@/hooks/useApi';
import { formatScore } from '@/lib/format';
import type { Signal } from '@/types';

const SIGNAL_TYPES: Signal['type'][] = [
	'ENTRY',
	'EXIT',
	'STOP_LOSS',
	'TAKE_PROFIT',
	'ADJUSTMENT',
	'HOLD',
	'NO_ACTION'
];

const typeConfig: Record<Signal['type'], { label: string }> = {
	ENTRY: { label: 'Entry' },
	EXIT: { label: 'Exit' },
	STOP_LOSS: { label: 'Stop Loss' },
	TAKE_PROFIT: { label: 'Take Profit' },
	ADJUSTMENT: { label: 'Adjustment' },
	HOLD: { label: 'Hold' },
	NO_ACTION: { label: 'No Action' }
};

export function MarketDetail() {
	const { symbol } = useParams<{ symbol: string }>();
	const decodedSymbol = decodeURIComponent(symbol || '');

	const { data: latestData, isLoading: dataLoading } = useLatestData(decodedSymbol);
	const { data: latestSignal, isLoading: signalLoading } = useLatestSignal(decodedSymbol);

	const isLoading = dataLoading || signalLoading;
	const indicators = latestData?.indicators;
	const signal = latestSignal?.signal;

	const displaySymbol = decodedSymbol.replace('PERP_', '').replace('_USDC', '');

	// Signal history state
	const [selectedTypes, setSelectedTypes] = useState<Signal['type'][]>([]);
	const [cursorHistory, setCursorHistory] = useState<string[]>([]);
	const [currentCursor, setCurrentCursor] = useState<string | undefined>(undefined);

	// Initialize with all types selected
	useEffect(() => {
		if (selectedTypes.length === 0) {
			setSelectedTypes(SIGNAL_TYPES);
		}
	}, [selectedTypes.length]);

	const { data: signalsData, isLoading: signalsLoading } = useSignals(
		decodedSymbol,
		50,
		currentCursor
	);
	const signals = signalsData?.signals || [];
	const totalCount = signalsData?.totalCount || 0;
	const hasMore = signalsData?.pagination?.hasMore || false;

	// Handle next page
	const handleNext = () => {
		if (signalsData?.pagination?.nextCursor) {
			if (currentCursor) {
				setCursorHistory((prev) => [...prev, currentCursor]);
			} else {
				setCursorHistory(['']);
			}
			setCurrentCursor(signalsData.pagination.nextCursor);
		}
	};

	// Handle previous page
	const handlePrev = () => {
		if (cursorHistory.length > 0) {
			const newHistory = [...cursorHistory];
			const prevCursor = newHistory.pop();
			setCursorHistory(newHistory);
			setCurrentCursor(prevCursor === '' ? undefined : prevCursor);
		}
	};

	const hasPrev = cursorHistory.length > 0;

	// Filter signals based on selected types
	const filteredSignals = useMemo(() => {
		if (selectedTypes.length === 0) return signals;
		return signals.filter((signal) => selectedTypes.includes(signal.type));
	}, [signals, selectedTypes]);

	// Toggle type selection
	const toggleType = (type: Signal['type']) => {
		setSelectedTypes((prev) => {
			const isSelected = prev.includes(type);
			if (isSelected) {
				if (prev.length === 1) return prev;
				return prev.filter((t) => t !== type);
			}
			return [...prev, type];
		});
		setCurrentCursor(undefined);
		setCursorHistory([]);
	};

	// Select all types
	const selectAllTypes = () => {
		setSelectedTypes(SIGNAL_TYPES);
		setCurrentCursor(undefined);
		setCursorHistory([]);
	};

	const getTaScoreInterpretation = (score: number) => {
		if (score >= 2) return { label: 'STRONG BUY', color: 'bg-success text-white' };
		if (score >= 0.5) return { label: 'BUY', color: 'bg-success/80 text-white' };
		if (score >= -0.5) return { label: 'NEUTRAL', color: 'bg-text-muted text-white' };
		if (score >= -2) return { label: 'SELL', color: 'bg-danger/80 text-white' };
		return { label: 'STRONG SELL', color: 'bg-danger text-white' };
	};

	const formatNumber = (num: number | null | undefined, decimals = 2) => {
		if (num === undefined || num === null) return '-';
		return new Intl.NumberFormat('en-US', {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals
		}).format(num);
	};

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-4">
				<Link
					to="/markets"
					className="p-2 text-text-muted hover:text-text transition-colors"
					aria-label="Back to market"
				>
					<ArrowLeft className="w-5 h-5" />
				</Link>
				<div>
					<h1 className="text-2xl font-bold text-text">{displaySymbol}</h1>
					<p className="text-text-muted mt-1">Technical indicators and analysis</p>
				</div>
			</div>

			{isLoading ? (
				<div className="flex items-center justify-center h-64">
					<div className="text-text-muted">Loading market data...</div>
				</div>
			) : (
				<>
					{/* Price and Signal */}
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div className="card">
							<p className="text-sm text-text-muted mb-2">Current Price</p>
							<p className="text-4xl font-bold text-text">
								${formatNumber(indicators?.candle?.close ?? undefined)}
							</p>
							<div className="mt-2 flex items-center gap-4 text-sm">
								<span className="text-text-muted">
									High:{' '}
									<span className="text-text">
										${formatNumber(indicators?.candle?.high ?? undefined)}
									</span>
								</span>
								<span className="text-text-muted">
									Low:{' '}
									<span className="text-text">
										${formatNumber(indicators?.candle?.low ?? undefined)}
									</span>
								</span>
								<span className="text-text-muted">
									Vol:{' '}
									<span className="text-text">
										{formatNumber(indicators?.candle?.volume ?? undefined, 0)}
									</span>
								</span>
							</div>
						</div>

						<div className="card">
							<p className="text-sm text-text-muted mb-2">TA Score</p>
							<div className="flex items-center gap-4">
								<div className="text-4xl font-bold text-text">
									{signal?.taScore !== undefined ? formatNumber(signal.taScore, 2) : '-'}
								</div>
								{signal?.taScore !== undefined && (
									<span
										className={`px-3 py-1 rounded-lg text-sm font-medium ${getTaScoreInterpretation(signal.taScore).color}`}
									>
										{getTaScoreInterpretation(signal.taScore).label}
									</span>
								)}
							</div>
							<p className="text-sm text-text-muted mt-2">Threshold: {signal?.threshold || '-'}</p>
						</div>
					</div>

					{/* Indicators Table */}
					<div className="card">
						<h2 className="text-lg font-semibold text-text mb-4">Technical Indicators</h2>
						<div className="overflow-x-auto">
							<table className="w-full">
								<thead className="bg-surface-hover">
									<tr>
										<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
											Indicator
										</th>
										<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
											Value
										</th>
										<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
											Signal
										</th>
									</tr>
								</thead>
								<tbody>
									<tr className="border-b border-border">
										<td className="py-3 px-4 text-text font-medium">RSI</td>
										<td className="py-3 px-4 text-text">
											{formatNumber(indicators?.rsi?.value ?? undefined)}
										</td>
										<td className="py-3 px-4">
											<span
												className={`text-sm ${
													(indicators?.rsi?.value || 50) > 70
														? 'text-danger'
														: (indicators?.rsi?.value || 50) < 30
															? 'text-success'
															: 'text-text-muted'
												}`}
											>
												{(indicators?.rsi?.value || 50) > 70
													? 'Overbought'
													: (indicators?.rsi?.value || 50) < 30
														? 'Oversold'
														: 'Neutral'}
											</span>
										</td>
									</tr>
									<tr className="border-b border-border">
										<td className="py-3 px-4 text-text font-medium">VWAP</td>
										<td className="py-3 px-4 text-text">
											{formatNumber(indicators?.vwap?.value ?? undefined)}
										</td>
										<td className="py-3 px-4">
											<span
												className={`text-sm ${
													(indicators?.candle?.close || 0) > (indicators?.vwap?.value || 0)
														? 'text-danger'
														: 'text-success'
												}`}
											>
												{(indicators?.candle?.close || 0) > (indicators?.vwap?.value || 0)
													? 'Above'
													: 'Below'}
											</span>
										</td>
									</tr>
									<tr className="border-b border-border">
										<td className="py-3 px-4 text-text font-medium">Bollinger Bands</td>
										<td className="py-3 px-4 text-text">
											U: {formatNumber(indicators?.bbands?.valueUpperBand ?? undefined)} | M:{' '}
											{formatNumber(indicators?.bbands?.valueMiddleBand ?? undefined)} | L:{' '}
											{formatNumber(indicators?.bbands?.valueLowerBand ?? undefined)}
										</td>
										<td className="py-3 px-4">
											<span
												className={`text-sm ${
													(indicators?.candle?.close || 0) >
													(indicators?.bbands?.valueUpperBand || 0)
														? 'text-danger'
														: (indicators?.candle?.close || 0) <
															  (indicators?.bbands?.valueLowerBand || 0)
															? 'text-success'
															: 'text-text-muted'
												}`}
											>
												{(indicators?.candle?.close || 0) >
												(indicators?.bbands?.valueUpperBand || 0)
													? 'Above Upper'
													: (indicators?.candle?.close || 0) <
														  (indicators?.bbands?.valueLowerBand || 0)
														? 'Below Lower'
														: 'Within Bands'}
											</span>
										</td>
									</tr>
									<tr className="border-b border-border">
										<td className="py-3 px-4 text-text font-medium">OBV</td>
										<td className="py-3 px-4 text-text">
											{formatNumber(indicators?.obv?.value ?? undefined, 0)}
										</td>
										<td className="py-3 px-4">
											<span className="text-sm text-text-muted">Volume momentum</span>
										</td>
									</tr>
									<tr>
										<td className="py-3 px-4 text-text font-medium">ATR</td>
										<td className="py-3 px-4 text-text">
											{formatNumber(indicators?.atr?.value ?? undefined)}
										</td>
										<td className="py-3 px-4">
											<span className="text-sm text-text-muted">Volatility measure</span>
										</td>
									</tr>
								</tbody>
							</table>
						</div>
					</div>

					{/* Signal Breakdown */}
					{signal?.indicators && (
						<div className="card">
							<h2 className="text-lg font-semibold text-text mb-4">Signal Breakdown</h2>
							<div className="grid grid-cols-2 md:grid-cols-5 gap-4">
								<div className="text-center p-3 bg-surface-hover rounded-lg">
									<p className="text-xs text-text-muted mb-1">VWAP</p>
									<p
										className={`text-lg font-bold ${signal.indicators.vwap >= 0 ? 'text-success' : 'text-danger'}`}
									>
										{formatScore(signal.indicators.vwap, 2)}
									</p>
								</div>
								<div className="text-center p-3 bg-surface-hover rounded-lg">
									<p className="text-xs text-text-muted mb-1">BBands</p>
									<p
										className={`text-lg font-bold ${signal.indicators.bbands >= 0 ? 'text-success' : 'text-danger'}`}
									>
										{formatScore(signal.indicators.bbands, 2)}
									</p>
								</div>
								<div className="text-center p-3 bg-surface-hover rounded-lg">
									<p className="text-xs text-text-muted mb-1">RSI</p>
									<p
										className={`text-lg font-bold ${signal.indicators.rsi >= 0 ? 'text-success' : 'text-danger'}`}
									>
										{formatScore(signal.indicators.rsi, 2)}
									</p>
								</div>
								<div className="text-center p-3 bg-surface-hover rounded-lg">
									<p className="text-xs text-text-muted mb-1">OBV</p>
									<p
										className={`text-lg font-bold ${signal.indicators.obv >= 0 ? 'text-success' : 'text-danger'}`}
									>
										{formatScore(signal.indicators.obv, 2)}
									</p>
								</div>
								<div className="text-center p-3 bg-primary/10 rounded-lg">
									<p className="text-xs text-text-muted mb-1">Total</p>
									<p
										className={`text-lg font-bold ${signal.indicators.total >= 0 ? 'text-success' : 'text-danger'}`}
									>
										{formatScore(signal.indicators.total, 2)}
									</p>
								</div>
							</div>
						</div>
					)}

					{/* Signal History */}
					<div className="space-y-4">
						<div className="flex items-center justify-between">
							<h2 className="text-lg font-semibold text-text">Signal History</h2>
							<p className="text-sm text-text-muted">{totalCount} total signals</p>
						</div>

						{/* Filter by Type */}
						<div className="card">
							<div className="flex items-center justify-between mb-4">
								<h3 className="font-semibold text-text">Filter by Type</h3>
								<button
									onClick={selectAllTypes}
									className="text-sm text-primary hover:text-primary-hover transition-colors"
									disabled={selectedTypes.length === SIGNAL_TYPES.length}
								>
									Select All
								</button>
							</div>
							<div className="flex flex-wrap gap-3">
								{SIGNAL_TYPES.map((type) => {
									const isSelected = selectedTypes.includes(type);
									return (
										<label
											key={type}
											className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all ${
												isSelected
													? 'bg-surface-hover ring-2 ring-primary'
													: 'bg-surface opacity-50 hover:opacity-75'
											}`}
										>
											<input
												type="checkbox"
												checked={isSelected}
												onChange={() => toggleType(type)}
												className="w-4 h-4 rounded border-border bg-surface text-primary focus:ring-primary focus:ring-offset-0"
											/>
											<span
												className={`text-sm font-medium ${isSelected ? 'text-text' : 'text-text-muted'}`}
											>
												{typeConfig[type].label}
											</span>
										</label>
									);
								})}
							</div>
						</div>

						{signalsLoading ? (
							<div className="flex items-center justify-center h-32">
								<div className="text-text-muted">Loading signals...</div>
							</div>
						) : filteredSignals.length === 0 ? (
							<div className="card text-center py-12">
								<p className="text-text-muted">No signals found</p>
								<p className="text-sm text-text-muted mt-2">
									Signals will appear here when trading conditions are met
								</p>
							</div>
						) : (
							<div className="space-y-4">
								<div className="flex items-center justify-between">
									<p className="text-sm text-text-muted">
										Showing {filteredSignals.length} of {totalCount} signals
									</p>
									{/* Pagination Controls */}
									<div className="flex items-center gap-2">
										<button
											onClick={handlePrev}
											disabled={!hasPrev || signalsLoading}
											className="p-1 rounded hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed text-text-muted"
										>
											<ChevronLeft className="w-5 h-5" />
										</button>
										<span className="text-sm text-text-muted px-2">
											Page {cursorHistory.length + 1}
										</span>
										<button
											onClick={handleNext}
											disabled={!hasMore || signalsLoading}
											className="p-1 rounded hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed text-text-muted"
										>
											<ChevronRight className="w-5 h-5" />
										</button>
									</div>
								</div>

								{filteredSignals.map((signalItem, index) => (
									<SignalBadge key={`${signalItem.timestamp}-${index}`} signal={signalItem} />
								))}

								{/* Bottom Pagination Controls */}
								<div className="flex items-center justify-center gap-2 pt-4">
									<button
										onClick={handlePrev}
										disabled={!hasPrev || signalsLoading}
										className="px-4 py-2 rounded-lg bg-surface text-text-muted hover:text-text hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
									>
										← Previous
									</button>
									<span className="text-sm text-text-muted px-4">
										Page {cursorHistory.length + 1}
									</span>
									<button
										onClick={handleNext}
										disabled={!hasMore || signalsLoading}
										className="px-4 py-2 rounded-lg bg-surface text-text-muted hover:text-text hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
									>
										Next →
									</button>
								</div>
							</div>
						)}
					</div>
				</>
			)}
		</div>
	);
}
