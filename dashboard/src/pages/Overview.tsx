import { useQueries } from '@tanstack/react-query';
import { Wallet, AlertCircle, Activity, TrendingUp, TrendingDown } from 'lucide-react';

import { StatCard } from '@/components/StatCard';
import { usePortfolio, useConfig, useLogs, usePositionHistory } from '@/hooks/useApi';
import { formatCurrency, formatPercent, formatNumber } from '@/lib/format';
import { api } from '@/services/api';

export function Overview() {
	const { data: portfolio, isLoading: portfolioLoading } = usePortfolio();
	const { data: config, isLoading: configLoading } = useConfig();
	const { data: logs, isLoading: logsLoading } = useLogs(50);
	const { data: positionHistoryData, isLoading: historyLoading } = usePositionHistory(1, 1000);

	const isLoading = portfolioLoading || configLoading || logsLoading || historyLoading;

	const activePositions = portfolio?.positions?.filter((p) => p.size > 0) || [];
	const totalPnl = activePositions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
	const errorCount = logs?.logs?.filter((l) => l.level === 'ERROR').length || 0;

	// Fetch latest data for all tracked symbols
	const activeSymbols = config?.activeSymbols || [];
	const latestDataQueries = useQueries({
		queries: activeSymbols.map((symbol) => ({
			queryKey: ['latest', symbol],
			queryFn: () => api.getLatest(symbol),
			refetchInterval: 30000,
			staleTime: 25000,
			enabled: !!symbol
		}))
	});

	// Calculate 24h PnL per symbol
	const calculate24hPnlPerSymbol = () => {
		const history = positionHistoryData?.history || [];
		const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
		const yesterdayTrades = history.filter((pos) => pos.closedAt >= oneDayAgo);

		const pnlBySymbol: Record<string, number> = {};
		yesterdayTrades.forEach((pos) => {
			if (!pnlBySymbol[pos.symbol]) {
				pnlBySymbol[pos.symbol] = 0;
			}
			pnlBySymbol[pos.symbol] += pos.realizedPnl;
		});

		return pnlBySymbol;
	};

	const pnl24hBySymbol = calculate24hPnlPerSymbol();

	// Build symbol summary data
	const symbolSummary = activeSymbols.map((symbol, index) => {
		const latestData = latestDataQueries[index]?.data;
		const position = activePositions.find((p) => p.symbol === symbol);
		const pnl24h = pnl24hBySymbol[symbol] || 0;

		return {
			symbol: symbol.replace('PERP_', '').replace('_USDC', ''),
			fullSymbol: symbol,
			price: latestData?.indicators?.candle?.close || 0,
			position: position
				? {
						side: position.isLong ? 'LONG' : 'SHORT',
						size: position.size,
						unrealizedPnl: position.unrealizedPnl,
						entryPrice: position.entryPrice
					}
				: null,
			pnl24h
		};
	});

	// Sort by 24h PnL (descending)
	const sortedSymbols = [...symbolSummary].sort((a, b) => b.pnl24h - a.pnl24h);

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
			<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

			{/* Symbol Summary */}
			{sortedSymbols.length > 0 && (
				<div>
					<h2 className="text-lg font-semibold text-text mb-4">Symbol Summary</h2>
					<div className="flex flex-wrap justify-between gap-4">
						{sortedSymbols.map((symbolData) => (
							<div
								key={symbolData.fullSymbol}
								className={`card p-4 min-w-[180px] flex-1 ${
									symbolData.position ? 'ring-1 ring-primary/30 bg-primary/5' : ''
								}`}
							>
								{/* Header */}
								<div className="flex items-center justify-between mb-3">
									<h3 className="font-semibold text-text">{symbolData.symbol}</h3>
									{symbolData.position ? (
										<span
											className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
												symbolData.position.side === 'LONG'
													? 'bg-success/20 text-success border border-success/30'
													: 'bg-danger/20 text-danger border border-danger/30'
											}`}
										>
											{symbolData.position.side}
										</span>
									) : (
										<span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-surface text-text-muted border border-border">
											No Position
										</span>
									)}
								</div>

								{/* Current Price */}
								<div className="mb-3">
									<p className="text-xs text-text-muted">Current Price</p>
									<p className="text-lg font-medium text-text">
										{symbolData.price > 0 ? formatCurrency(symbolData.price, 2) : '-'}
									</p>
								</div>

								{/* 24h Realized PnL */}
								<div className="mb-3">
									<p className="text-xs text-text-muted">24h Realized PnL</p>
									<div className="flex items-center gap-1">
										{symbolData.pnl24h !== 0 && (
											<>
												{symbolData.pnl24h > 0 ? (
													<TrendingUp className="h-4 w-4 text-success" />
												) : (
													<TrendingDown className="h-4 w-4 text-danger" />
												)}
											</>
										)}
										<p
											className={`font-medium ${
												symbolData.pnl24h > 0
													? 'text-success'
													: symbolData.pnl24h < 0
														? 'text-danger'
														: 'text-text-muted'
											}`}
										>
											{formatCurrency(symbolData.pnl24h, 2)}
										</p>
									</div>
								</div>

								{/* Unrealized PnL (only if active position) */}
								{symbolData.position && (
									<div>
										<p className="text-xs text-text-muted">Unrealized PnL</p>
										<div className="flex items-center gap-1">
											{symbolData.position.unrealizedPnl !== 0 && (
												<>
													{symbolData.position.unrealizedPnl > 0 ? (
														<TrendingUp className="h-4 w-4 text-success" />
													) : (
														<TrendingDown className="h-4 w-4 text-danger" />
													)}
												</>
											)}
											<p
												className={`font-medium ${
													symbolData.position.unrealizedPnl > 0
														? 'text-success'
														: symbolData.position.unrealizedPnl < 0
															? 'text-danger'
															: 'text-text-muted'
												}`}
											>
												{formatCurrency(symbolData.position.unrealizedPnl, 2)}
											</p>
										</div>
										{symbolData.position.size > 0 && (
											<p className="text-xs text-text-muted mt-1">
												Size: {formatNumber(symbolData.position.size, 4)}
											</p>
										)}
									</div>
								)}
							</div>
						))}
					</div>
				</div>
			)}

			{/* Active Positions Table */}
			{activePositions.length > 0 && (
				<div className="card">
					<h2 className="text-lg font-semibold text-text mb-4">Active Positions</h2>
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
									<th className="text-left py-2 px-4 text-sm font-medium text-text-muted">
										Unrealized PnL
									</th>
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
				<a href="/positions" className="card hover:bg-surface-hover transition-colors">
					<h3 className="font-medium text-text">View All Positions →</h3>
					<p className="text-sm text-text-muted mt-1">Detailed position management</p>
				</a>
				<a href="/markets" className="card hover:bg-surface-hover transition-colors">
					<h3 className="font-medium text-text">Market Data →</h3>
					<p className="text-sm text-text-muted mt-1">Technical indicators and analysis</p>
				</a>
				<a href="/logs" className="card hover:bg-surface-hover transition-colors">
					<h3 className="font-medium text-text">View Logs →</h3>
					<p className="text-sm text-text-muted mt-1">System logs and errors</p>
				</a>
			</div>
		</div>
	);
}
