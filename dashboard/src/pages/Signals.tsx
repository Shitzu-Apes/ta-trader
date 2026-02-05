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

	const { data: signalsData, isLoading } = useSignals(selectedSymbol, 50);
	const signals = signalsData?.signals || [];

	const filteredSignals =
		filterType === 'ALL' ? signals : signals.filter((s) => s.type === filterType);

	const typeFilters: { value: Signal['type'] | 'ALL'; label: string }[] = [
		{ value: 'ALL', label: 'All' },
		{ value: 'ENTRY', label: 'Entry' },
		{ value: 'EXIT', label: 'Exit' },
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
					onChange={(e) => setSelectedSymbol(e.target.value)}
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
					<p className="text-sm text-text-muted">
						Showing {filteredSignals.length} of {signals.length} signals
					</p>

					{filteredSignals.map((signal, index) => (
						<SignalBadge key={`${signal.timestamp}-${index}`} signal={signal} />
					))}
				</div>
			)}
		</div>
	);
}
