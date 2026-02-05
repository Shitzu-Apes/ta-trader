import { useState } from 'react';
import { useLogs } from '@/hooks/useApi';
import { LogEntryComponent } from '@/components/LogEntry';
import type { LogEntry } from '@/types';

export function Logs() {
	const [filterLevel, setFilterLevel] = useState<LogEntry['data']['level'] | 'ALL'>('ALL');
	const [searchQuery, setSearchQuery] = useState('');

	const { data: logsData, isLoading } = useLogs(100);
	const logs = logsData?.logs || [];

	const filteredLogs = logs.filter((log) => {
		const matchesLevel = filterLevel === 'ALL' || log.data.level === filterLevel;
		const matchesSearch =
			searchQuery === '' ||
			log.data.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
			log.data.context?.operation?.toLowerCase().includes(searchQuery.toLowerCase()) ||
			log.data.context?.symbol?.toLowerCase().includes(searchQuery.toLowerCase());

		return matchesLevel && matchesSearch;
	});

	const levelFilters: { value: LogEntry['data']['level'] | 'ALL'; label: string; color: string }[] =
		[
			{ value: 'ALL', label: 'All', color: 'bg-text-muted' },
			{ value: 'ERROR', label: 'Errors', color: 'bg-danger' },
			{ value: 'WARN', label: 'Warnings', color: 'bg-warning' },
			{ value: 'INFO', label: 'Info', color: 'bg-info' },
			{ value: 'DEBUG', label: 'Debug', color: 'bg-text-muted' }
		];

	const getLevelCount = (level: LogEntry['data']['level'] | 'ALL') => {
		if (level === 'ALL') return logs.length;
		return logs.filter((l) => l.data.level === level).length;
	};

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
				<div className="flex flex-wrap gap-2">
					{levelFilters.map((filter) => (
						<button
							key={filter.value}
							onClick={() => setFilterLevel(filter.value)}
							className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
								filterLevel === filter.value
									? 'bg-primary text-white'
									: 'bg-surface text-text-muted hover:text-text hover:bg-surface-hover'
							}`}
						>
							<span className={`w-2 h-2 rounded-full ${filter.color}`}></span>
							{filter.label}
							<span className="ml-1 text-xs opacity-70">({getLevelCount(filter.value)})</span>
						</button>
					))}
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
					<div className="px-4 py-3 border-b border-border bg-surface-hover">
						<p className="text-sm text-text-muted">
							Showing {filteredLogs.length} of {logs.length} logs
							{searchQuery && ` matching "${searchQuery}"`}
						</p>
					</div>

					<div className="divide-y divide-border">
						{filteredLogs.map((log) => (
							<LogEntryComponent key={log.key} log={log} />
						))}
					</div>
				</div>
			)}
		</div>
	);
}
