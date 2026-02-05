import dayjs from 'dayjs';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

import type { LogEntry } from '@/types';

interface LogEntryComponentProps {
	log: LogEntry;
}

export function LogEntryComponent({ log }: LogEntryComponentProps) {
	const [isExpanded, setIsExpanded] = useState(false);

	const levelColors = {
		ERROR: 'bg-danger/10 text-danger border-danger/20',
		WARN: 'bg-warning/10 text-warning border-warning/20',
		INFO: 'bg-info/10 text-info border-info/20',
		DEBUG: 'bg-text-muted/10 text-text-muted border-text-muted/20'
	};

	const formatTime = (timestamp: string) => {
		return dayjs(timestamp).format('lll');
	};

	const hasDetails = log.data.context || log.data.error;

	return (
		<div
			className={`border-b border-border last:border-b-0 ${isExpanded ? 'bg-surface-hover' : ''}`}
		>
			<button
				onClick={() => hasDetails && setIsExpanded(!isExpanded)}
				className={`w-full py-3 px-4 flex items-start gap-3 text-left transition-colors ${
					hasDetails ? 'hover:bg-surface-hover cursor-pointer' : 'cursor-default'
				}`}
			>
				{hasDetails && (
					<span className="mt-0.5 text-text-muted">
						{isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
					</span>
				)}

				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2 mb-1">
						<span
							className={`px-2 py-0.5 rounded text-xs font-medium border ${levelColors[log.data.level]}`}
						>
							{log.data.level}
						</span>
						<span className="text-xs text-text-muted">{formatTime(log.data.timestamp)}</span>
						{log.data.context?.operation && (
							<span className="text-xs text-text-muted">[{log.data.context.operation}]</span>
						)}
						{log.data.context?.symbol && (
							<span className="text-xs text-primary">{log.data.context.symbol}</span>
						)}
					</div>

					<p className="text-sm text-text truncate">{log.data.message}</p>
				</div>
			</button>

			{isExpanded && hasDetails && (
				<div className="px-4 pb-3 pl-12">
					{log.data.context && Object.keys(log.data.context).length > 0 && (
						<div className="mb-2">
							<p className="text-xs text-text-muted mb-1">Context:</p>
							<pre className="text-xs text-text bg-background p-2 rounded overflow-x-auto">
								{JSON.stringify(log.data.context, null, 2)}
							</pre>
						</div>
					)}

					{log.data.error && (
						<div>
							<p className="text-xs text-text-muted mb-1">Error:</p>
							<pre className="text-xs text-danger bg-background p-2 rounded overflow-x-auto">
								{JSON.stringify(log.data.error, null, 2)}
							</pre>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
