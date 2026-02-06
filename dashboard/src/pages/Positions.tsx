import dayjs from 'dayjs';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { PositionRow } from '@/components/PositionRow';
import { usePositions, usePositionHistory } from '@/hooks/useApi';
import { formatCurrency } from '@/lib/format';

export function Positions() {
	const { data: positionsData, isLoading: positionsLoading } = usePositions();
	const [historyPage, setHistoryPage] = useState(1);
	const { data: historyData, isLoading: historyLoading } = usePositionHistory(historyPage, 25);

	const isLoading = positionsLoading;
	const positions = positionsData?.positions || [];
	const activePositions = positions.filter((p) => p.size > 0);
	const totalPnl = activePositions.reduce((sum, p) => sum + p.unrealizedPnl, 0);

	const history = historyData?.history || [];
	const pagination = historyData?.pagination;

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="text-text-muted">Loading positions...</div>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold text-text">Positions</h1>
					<p className="text-text-muted mt-1">
						{activePositions.length} active positions
						{totalPnl !== 0 && (
							<span className={`ml-2 ${totalPnl >= 0 ? 'text-success' : 'text-danger'}`}>
								Total PnL: {formatCurrency(totalPnl, 2)}
							</span>
						)}
					</p>
				</div>
			</div>

			{activePositions.length === 0 ? (
				<div className="card text-center py-12">
					<p className="text-text-muted">No active positions</p>
					<p className="text-sm text-text-muted mt-2">
						Positions will appear here when trades are executed
					</p>
				</div>
			) : (
				<div className="card overflow-hidden">
					<div className="overflow-x-auto">
						<table className="w-full">
							<thead className="bg-surface-hover">
								<tr>
									<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
										Symbol
									</th>
									<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">Side</th>
									<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">Size</th>
									<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
										Entry Price
									</th>
									<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
										Mark Price
									</th>
									<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
										Notional
									</th>
									<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
										Unrealized PnL
									</th>
								</tr>
							</thead>
							<tbody>
								{activePositions.map((position) => (
									<PositionRow key={position.symbol} position={position} />
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{/* Closed Positions */}
			{positions.length > activePositions.length && (
				<div className="card">
					<h2 className="text-lg font-semibold text-text mb-4">Closed Positions</h2>
					<div className="overflow-x-auto">
						<table className="w-full">
							<thead className="bg-surface-hover">
								<tr>
									<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
										Symbol
									</th>
									<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">Side</th>
									<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
										Realized PnL
									</th>
								</tr>
							</thead>
							<tbody>
								{positions
									.filter((p) => p.size === 0)
									.map((position) => (
										<tr key={position.symbol} className="border-b border-border opacity-60">
											<td className="py-3 px-4 text-text">
												{position.symbol.replace('PERP_', '').replace('_USDC', '')}
											</td>
											<td className="py-3 px-4">
												<span
													className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
														position.isLong
															? 'bg-success/10 text-success'
															: 'bg-danger/10 text-danger'
													}`}
												>
													{position.isLong ? 'LONG' : 'SHORT'}
												</span>
											</td>
											<td
												className={`py-3 px-4 font-medium ${
													position.realizedPnl >= 0 ? 'text-success' : 'text-danger'
												}`}
											>
												{formatCurrency(position.realizedPnl, 2)}
											</td>
										</tr>
									))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{/* Position History */}
			<div className="card">
				<div className="flex items-center justify-between mb-4">
					<h2 className="text-lg font-semibold text-text">Position History</h2>
					{pagination && pagination.total > 0 && (
						<div className="flex items-center gap-2">
							<button
								onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
								disabled={!pagination.hasPrev || historyLoading}
								className="p-1 rounded hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed text-text-muted"
							>
								<ChevronLeft className="w-5 h-5" />
							</button>
							<span className="text-sm text-text-muted">
								Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
							</span>
							<button
								onClick={() => setHistoryPage((p) => p + 1)}
								disabled={!pagination.hasNext || historyLoading}
								className="p-1 rounded hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed text-text-muted"
							>
								<ChevronRight className="w-5 h-5" />
							</button>
						</div>
					)}
				</div>
				{historyLoading ? (
					<div className="text-center py-8 text-text-muted">Loading history...</div>
				) : history.length === 0 ? (
					<div className="text-center py-8 text-text-muted">No position history available</div>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full">
							<thead className="bg-surface-hover">
								<tr>
									<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
										Symbol
									</th>
									<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">Side</th>
									<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">Size</th>
									<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
										Entry Price
									</th>
									<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
										Exit Price
									</th>
									<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
										Realized PnL
									</th>
									<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
										Opened
									</th>
									<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
										Closed
									</th>
								</tr>
							</thead>
							<tbody>
								{history.map((position, index) => (
									<tr
										key={`${position.symbol}-${position.closedAt}-${index}`}
										className="border-b border-border"
									>
										<td className="py-3 px-4 text-text">
											{position.symbol.replace('PERP_', '').replace('_USDC', '')}
										</td>
										<td className="py-3 px-4">
											<span
												className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
													position.side === 'LONG'
														? 'bg-success/10 text-success'
														: 'bg-danger/10 text-danger'
												}`}
											>
												{position.side}
											</span>
										</td>
										<td className="py-3 px-4 text-text">
											{formatCurrency(Math.abs(position.size ?? 0), 4)}
										</td>
										<td className="py-3 px-4 text-text">
											{formatCurrency(Math.abs(position.entryPrice ?? 0), 2)}
										</td>
										<td className="py-3 px-4 text-text">
											{formatCurrency(Math.abs(position.exitPrice ?? 0), 2)}
										</td>
										<td
											className={`py-3 px-4 font-medium ${
												(position.realizedPnl ?? 0) >= 0 ? 'text-success' : 'text-danger'
											}`}
										>
											{formatCurrency(position.realizedPnl, 2)}
										</td>
										<td className="py-3 px-4 text-text-muted text-sm">
											{position.openedAt ? dayjs(position.openedAt).format('lll') : '-'}
										</td>
										<td className="py-3 px-4 text-text-muted text-sm">
											{position.closedAt ? dayjs(position.closedAt).format('lll') : '-'}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</div>
	);
}
