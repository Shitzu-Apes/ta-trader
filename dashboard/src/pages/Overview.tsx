import { Wallet, TrendingUp, AlertCircle, Activity } from 'lucide-react';

import { StatCard } from '@/components/StatCard';
import { usePortfolio, useConfig, useLogs } from '@/hooks/useApi';
import { formatCurrency, formatPercent, formatNumber } from '@/lib/format';

export function Overview() {
	const { data: portfolio, isLoading: portfolioLoading } = usePortfolio();
	const { data: config, isLoading: configLoading } = useConfig();
	const { data: logs, isLoading: logsLoading } = useLogs(50);

	const isLoading = portfolioLoading || configLoading || logsLoading;

	const activePositions = portfolio?.positions?.filter((p) => p.size > 0) || [];
	const totalPnl = activePositions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
	const errorCount = logs?.logs?.filter((l) => l.level === 'ERROR').length || 0;

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="text-text-muted">Loading...</div>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold text-text">Dashboard Overview</h1>
					<p className="text-text-muted mt-1">
						Environment:{' '}
						<span
							className={`font-medium ${
								config?.environment === 'production' ? 'text-success' : 'text-warning'
							}`}
						>
							{config?.environment?.toUpperCase()}
						</span>
					</p>
				</div>
				<div className="text-right">
					<p className="text-xs text-text-muted">Auto-refresh every 30s</p>
				</div>
			</div>

			{/* Stats Grid */}
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
				<StatCard
					title="Balance"
					value={formatCurrency(portfolio?.balance, 2)}
					subtitle="USDC"
					trend={
						(portfolio?.dailyPnl || 0) > 0
							? 'up'
							: (portfolio?.dailyPnl || 0) < 0
								? 'down'
								: 'neutral'
					}
					trendValue={`24h: ${formatCurrency(portfolio?.dailyPnl || 0, 2)}`}
					icon={<Wallet className="h-5 w-5 text-primary" />}
				/>

				<StatCard
					title="Active Positions"
					value={activePositions.length}
					subtitle={`of ${config?.activeSymbols?.length || 0} symbols monitored`}
					icon={<TrendingUp className="h-5 w-5 text-primary" />}
				/>

				<StatCard
					title="Total Unrealized PnL"
					value={formatCurrency(totalPnl, 2)}
					trend={totalPnl > 0 ? 'up' : totalPnl < 0 ? 'down' : 'neutral'}
					trendValue={formatPercent((totalPnl / (portfolio?.balance || 1)) * 100)}
					icon={<Activity className="h-5 w-5 text-primary" />}
				/>

				<StatCard
					title="Recent Errors"
					value={errorCount}
					subtitle="Last 50 logs"
					trend={errorCount > 0 ? 'down' : 'neutral'}
					icon={<AlertCircle className="h-5 w-5 text-primary" />}
				/>
			</div>

			{/* Active Positions Summary */}
			{activePositions.length > 0 && (
				<div className="card">
					<h2 className="text-lg font-semibold text-text mb-4">Active Positions Summary</h2>
					<div className="overflow-x-auto">
						<table className="w-full">
							<thead>
								<tr className="border-b border-border">
									<th className="text-left py-2 px-4 text-sm font-medium text-text-muted">
										Symbol
									</th>
									<th className="text-left py-2 px-4 text-sm font-medium text-text-muted">Side</th>
									<th className="text-left py-2 px-4 text-sm font-medium text-text-muted">Size</th>
									<th className="text-left py-2 px-4 text-sm font-medium text-text-muted">
										Entry Price
									</th>
									<th className="text-left py-2 px-4 text-sm font-medium text-text-muted">
										Mark Price
									</th>
									<th className="text-left py-2 px-4 text-sm font-medium text-text-muted">
										Notional
									</th>
									<th className="text-left py-2 px-4 text-sm font-medium text-text-muted">PnL</th>
								</tr>
							</thead>
							<tbody>
								{activePositions.map((position) => {
									const pnlPercent =
										((position.markPrice - position.entryPrice) / position.entryPrice) * 100;
									const isProfit = position.unrealizedPnl >= 0;

									return (
										<tr key={position.symbol} className="border-b border-border last:border-b-0">
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
											<td className="py-3 px-4 text-text">{formatNumber(position.size, 4)}</td>
											<td className="py-3 px-4 text-text-muted">
												{formatCurrency(position.entryPrice, 2)}
											</td>
											<td className="py-3 px-4 text-text">
												{formatCurrency(position.markPrice, 2)}
											</td>
											<td className="py-3 px-4 text-text">
												{formatCurrency(position.size * position.markPrice, 2)}
											</td>
											<td
												className={`py-3 px-4 font-medium ${isProfit ? 'text-success' : 'text-danger'}`}
											>
												{formatCurrency(position.unrealizedPnl, 2)}
												<span className="text-xs ml-1">({formatPercent(pnlPercent)})</span>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{/* Quick Links */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
				<a href="#/positions" className="card hover:bg-surface-hover transition-colors">
					<h3 className="font-medium text-text">View All Positions →</h3>
					<p className="text-sm text-text-muted mt-1">Detailed position management</p>
				</a>
				<a href="#/market" className="card hover:bg-surface-hover transition-colors">
					<h3 className="font-medium text-text">Market Data →</h3>
					<p className="text-sm text-text-muted mt-1">Technical indicators and analysis</p>
				</a>
				<a href="#/logs" className="card hover:bg-surface-hover transition-colors">
					<h3 className="font-medium text-text">View Logs →</h3>
					<p className="text-sm text-text-muted mt-1">System logs and errors</p>
				</a>
			</div>
		</div>
	);
}
