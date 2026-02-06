import { useState } from 'react';

import { LogEntryComponent } from '@/components/LogEntry';
import { useLogs } from '@/hooks/useApi';
import type { LogEntry } from '@/types';

const LOG_LEVELS: LogEntry['level'][] = ['ERROR', 'WARN', 'INFO', 'DEBUG'];

const levelConfig: Record<LogEntry['level'], { label: string; color: string }> = {
	ERROR: { label: 'Error', color: 'bg-danger' },
	WARN: { label: 'Warning', color: 'bg-warning' },
	INFO: { label: 'Info', color: 'bg-info' },
	DEBUG: { label: 'Debug', color: 'bg-text-muted' }
};

export function Logs() {
	// Multi-select filter state - exclude DEBUG by default
	const [selectedLevels, setSelectedLevels] = useState<LogEntry['level'][]>([
		'ERROR',
		'WARN',
		'INFO'
	]);
	const [searchQuery, setSearchQuery] = useState('');

	// Cursor pagination state
	const [cursorHistory, setCursorHistory] = useState<string[]>([]);
	const [currentCursor, setCurrentCursor] = useState<string | undefined>(undefined);

	const { data: logsData, isLoading } = useLogs(50, currentCursor, selectedLevels);
	const logs = logsData?.logs || [];

	// Handle level toggle
	const toggleLevel = (level: LogEntry['level']) => {
		setSelectedLevels((prev) => {
			const isSelected = prev.includes(level);
			if (isSelected) {
				// Don't allow deselecting all levels
				if (prev.length === 1) return prev;
				return prev.filter((l) => l !== level);
			}
			return [...prev, level];
		});
		// Reset pagination when filter changes
		setCursorHistory([]);
		setCurrentCursor(undefined);
	};

	// Handle select all
	const selectAll = () => {
		setSelectedLevels([...LOG_LEVELS]);
		// Reset pagination when filter changes
		setCursorHistory([]);
		setCurrentCursor(undefined);
	};

	// Handle next page
	const handleNext = () => {
		if (logsData?.pagination?.nextCursor) {
			if (currentCursor) {
				setCursorHistory((prev) => [...prev, currentCursor]);
			} else {
				setCursorHistory(['']); // First page marker
			}
			setCurrentCursor(logsData.pagination.nextCursor);
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
	const hasNext = logsData?.pagination?.hasMore ?? false;

	// Client-side search filter (only on current page)
	const filteredLogs = logs.filter((log) => {
		if (searchQuery === '') return true;
		const query = searchQuery.toLowerCase();
		return (
			log.message.toLowerCase().includes(query) ||
			log.operation?.toLowerCase().includes(query) ||
			log.symbol?.toLowerCase().includes(query)
		);
	});

	// Pagination component
	const Pagination = () => (
		<div className="px-4 py-3 bg-surface-hover flex items-center justify-between">
			<button
				onClick={handlePrev}
				disabled={!hasPrev}
				className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-surface hover:bg-surface-hover text-text"
			>
				Previous
			</button>
			<span className="text-sm text-text-muted">Page {cursorHistory.length + 1}</span>
			<button
				onClick={handleNext}
				disabled={!hasNext}
				className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-surface hover:bg-surface-hover text-text"
			>
				Next
			</button>
		</div>
	);

	return (
		<div className="space-y-6">
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold text-text">System Logs</h1>
					<p className="text-text-muted mt-1">Recent log entries and errors</p>
				</div>
			</div>

			{/* Filters */}
			<div className="space-y-4">
				{/* Level filters with multi-select checkboxes */}
				<div className="card">
					<div className="flex items-center justify-between mb-3">
						<span className="text-sm font-medium text-text">Filter by Level</span>
						<button
							onClick={selectAll}
							className="text-xs px-2 py-1 rounded bg-surface hover:bg-surface-hover text-text-muted hover:text-text transition-colors"
						>
							Select All
						</button>
					</div>
					<div className="flex flex-wrap gap-3">
						{LOG_LEVELS.map((level) => {
							const isSelected = selectedLevels.includes(level);
							const config = levelConfig[level];
							return (
								<label
									key={level}
									className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all ${
										isSelected
											? 'bg-surface-hover ring-1 ring-primary'
											: 'bg-surface opacity-60 hover:opacity-80'
									}`}
								>
									<input
										type="checkbox"
										checked={isSelected}
										onChange={() => toggleLevel(level)}
										className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
									/>
									<span className={`w-2 h-2 rounded-full ${config.color}`}></span>
									<span className="text-sm font-medium text-text">{config.label}</span>
								</label>
							);
						})}
					</div>
				</div>

				<input
					type="text"
					placeholder="Search logs..."
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					className="input w-full"
				/>
			</div>

			{isLoading ? (
				<div className="flex items-center justify-center h-64">
					<div className="text-text-muted">Loading logs...</div>
				</div>
			) : filteredLogs.length === 0 ? (
				<div className="card text-center py-12">
					<p className="text-text-muted">No logs found</p>
					{searchQuery && (
						<p className="text-sm text-text-muted mt-2">Try adjusting your search or filters</p>
					)}
				</div>
			) : (
				<div className="card overflow-hidden">
					{/* Top pagination */}
					<Pagination />

					<div className="px-4 py-3 border-y border-border bg-surface-hover">
						<p className="text-sm text-text-muted">
							Showing {filteredLogs.length} logs
							{searchQuery && ` matching "${searchQuery}"`}
							{logsData?.total !== undefined && ` (of ${logsData.total} total)`}
						</p>
					</div>

					<div className="divide-y divide-border">
						{filteredLogs.map((log) => (
							<LogEntryComponent key={log.id} log={log} />
						))}
					</div>

					{/* Bottom pagination */}
					<div className="border-t border-border">
						<Pagination />
					</div>
				</div>
			)}
		</div>
	);
}
