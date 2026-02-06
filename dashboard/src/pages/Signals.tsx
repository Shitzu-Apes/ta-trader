import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { SignalBadge } from '@/components/SignalBadge';
import { useConfig, useSignals } from '@/hooks/useApi';
import type { Signal } from '@/types';

export function Signals() {
	const { data: config } = useConfig();
	const [selectedSymbol, setSelectedSymbol] = useState(
		config?.activeSymbols?.[0] || 'PERP_BTC_USDC'
	);
	const [filterType, setFilterType] = useState<Signal['type'] | 'ALL'>('ALL');

	// Pagination state - cursor history for previous/next navigation
	const [cursorHistory, setCursorHistory] = useState<string[]>([]);
	const [currentCursor, setCurrentCursor] = useState<string | undefined>(undefined);

	const { data: signalsData, isLoading } = useSignals(selectedSymbol, 50, currentCursor);
	const signals = signalsData?.signals || [];
	const totalCount = signalsData?.totalCount || 0;
	const hasMore = signalsData?.pagination?.hasMore || false;

	// Handle next page
	const handleNext = () => {
		if (signalsData?.pagination?.nextCursor) {
			// Save current cursor to history before moving forward
			if (currentCursor) {
				setCursorHistory((prev) => [...prev, currentCursor]);
			} else {
				// First page - mark with empty string
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
			// Empty string means first page (no cursor)
			setCurrentCursor(prevCursor === '' ? undefined : prevCursor);
		}
	};

	const hasPrev = cursorHistory.length > 0;

	const filteredSignals =
		filterType === 'ALL' ? signals : signals.filter((s) => s.type === filterType);

	// Reset pagination when symbol changes
	const handleSymbolChange = (symbol: string) => {
		setSelectedSymbol(symbol);
		setCurrentCursor(undefined);
		setCursorHistory([]);
	};

	const typeFilters: { value: Signal['type'] | 'ALL'; label: string }[] = [
		{ value: 'ALL', label: 'All' },
		{ value: 'ENTRY', label: 'Entry' },
		{ value: 'EXIT', label: 'Exit' },
		{ value: 'STOP_LOSS', label: 'Stop Loss' },
		{ value: 'TAKE_PROFIT', label: 'Take Profit' },
		{ value: 'ADJUSTMENT', label: 'Adjustment' },
		{ value: 'HOLD', label: 'Hold' },
		{ value: 'NO_ACTION', label: 'No Action' }
	];

	return (
		<div className="space-y-6">
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold text-text">Trading Signals</h1>
					<p className="text-text-muted mt-1">Signal history and analysis</p>
				</div>

				<select
					value={selectedSymbol}
					onChange={(e) => handleSymbolChange(e.target.value)}
					className="select w-full sm:w-auto"
				>
					{config?.activeSymbols?.map((symbol) => (
						<option key={symbol} value={symbol}>
							{symbol.replace('PERP_', '').replace('_USDC', '')}
						</option>
					))}
				</select>
			</div>

			{/* Filter Tabs */}
			<div className="flex flex-wrap gap-2">
				{typeFilters.map((filter) => (
					<button
						key={filter.value}
						onClick={() => setFilterType(filter.value)}
						className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
							filterType === filter.value
								? 'bg-primary text-white'
								: 'bg-surface text-text-muted hover:text-text hover:bg-surface-hover'
						}`}
					>
						{filter.label}
					</button>
				))}
			</div>

			{isLoading ? (
				<div className="flex items-center justify-center h-64">
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
								disabled={!hasPrev || isLoading}
								className="p-1 rounded hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed text-text-muted"
							>
								<ChevronLeft className="w-5 h-5" />
							</button>
							<span className="text-sm text-text-muted px-2">Page {cursorHistory.length + 1}</span>
							<button
								onClick={handleNext}
								disabled={!hasMore || isLoading}
								className="p-1 rounded hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed text-text-muted"
							>
								<ChevronRight className="w-5 h-5" />
							</button>
						</div>
					</div>

					{filteredSignals.map((signal, index) => (
						<SignalBadge key={`${signal.timestamp}-${index}`} signal={signal} />
					))}

					{/* Bottom Pagination Controls */}
					{filteredSignals.length > 0 && (
						<div className="flex items-center justify-center gap-2 pt-4">
							<button
								onClick={handlePrev}
								disabled={!hasPrev || isLoading}
								className="px-4 py-2 rounded-lg bg-surface text-text-muted hover:text-text hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
							>
								← Previous
							</button>
							<span className="text-sm text-text-muted px-4">Page {cursorHistory.length + 1}</span>
							<button
								onClick={handleNext}
								disabled={!hasMore || isLoading}
								className="px-4 py-2 rounded-lg bg-surface text-text-muted hover:text-text hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
							>
								Next →
							</button>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
