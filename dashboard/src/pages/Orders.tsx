import { useEffect, useMemo, useState } from 'react';

import { useOrders, useConfig } from '@/hooks/useApi';
import { formatCurrency, formatNumber } from '@/lib/format';
import type { Order } from '@/types';

const ITEMS_PER_PAGE = 25;

export function Orders() {
	const { data: config } = useConfig();
	const activeSymbols = config?.activeSymbols || [];

	// Multi-select filter state for symbols - all selected by default
	const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
	const [page, setPage] = useState(1);

	// Cache orders in state
	const [cachedOrders, setCachedOrders] = useState<Order[]>([]);

	// Set all symbols as selected once config is loaded
	useEffect(() => {
		if (activeSymbols.length > 0 && selectedSymbols.length === 0) {
			setSelectedSymbols(activeSymbols);
		}
	}, [activeSymbols, selectedSymbols.length]);

	// Fetch orders with caching
	const { data: ordersData, isLoading } = useOrders();

	// Update cache when new data arrives
	useEffect(() => {
		if (ordersData?.orders) {
			setCachedOrders(ordersData.orders);
		}
	}, [ordersData]);

	// Filter orders client-side by selected symbols
	const filteredOrders = useMemo(() => {
		if (selectedSymbols.length === 0) return cachedOrders;
		return cachedOrders.filter((order) => selectedSymbols.includes(order.symbol));
	}, [cachedOrders, selectedSymbols]);

	// Client-side pagination
	const totalPages = Math.ceil(filteredOrders.length / ITEMS_PER_PAGE);
	const paginatedOrders = useMemo(() => {
		const start = (page - 1) * ITEMS_PER_PAGE;
		return filteredOrders.slice(start, start + ITEMS_PER_PAGE);
	}, [filteredOrders, page]);

	// Handle symbol toggle
	const toggleSymbol = (symbol: string) => {
		setSelectedSymbols((prev) => {
			const isSelected = prev.includes(symbol);
			if (isSelected) {
				// Don't allow deselecting all symbols
				if (prev.length === 1) return prev;
				return prev.filter((s) => s !== symbol);
			}
			return [...prev, symbol];
		});
		// Reset to first page when filter changes
		setPage(1);
	};

	// Handle select all
	const selectAll = () => {
		setSelectedSymbols([...activeSymbols]);
		setPage(1);
	};

	// Handle page navigation
	const handlePrev = () => {
		if (page > 1) {
			setPage((p) => p - 1);
		}
	};

	const handleNext = () => {
		if (page < totalPages) {
			setPage((p) => p + 1);
		}
	};

	// Format timestamp
	const formatTime = (timestamp: number) => {
		return new Date(timestamp).toLocaleString();
	};

	// Pagination component
	const Pagination = () => (
		<div className="px-4 py-3 bg-surface-hover flex items-center justify-between">
			<button
				onClick={handlePrev}
				disabled={page <= 1}
				className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-surface hover:bg-surface-hover text-text"
			>
				Previous
			</button>
			<span className="text-sm text-text-muted">
				Page {page} {totalPages > 0 && `of ${totalPages}`}
			</span>
			<button
				onClick={handleNext}
				disabled={page >= totalPages}
				className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-surface hover:bg-surface-hover text-text"
			>
				Next
			</button>
		</div>
	);

	// Format symbol for display
	const formatSymbol = (symbol: string) => {
		return symbol.replace('PERP_', '').replace('_USDC', '');
	};

	return (
		<div className="space-y-6">
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold text-text">Orders</h1>
					<p className="text-text-muted mt-1">Filled order history from the last 30 days</p>
				</div>
			</div>

			{/* Symbol Filters */}
			{activeSymbols.length > 0 && (
				<div className="card">
					<div className="flex items-center justify-between mb-3">
						<span className="text-sm font-medium text-text">Filter by Symbol</span>
						<button
							onClick={selectAll}
							className="text-xs px-2 py-1 rounded bg-surface hover:bg-surface-hover text-text-muted hover:text-text transition-colors"
						>
							Select All
						</button>
					</div>
					<div className="flex flex-wrap gap-3">
						{activeSymbols.map((symbol) => {
							const isSelected = selectedSymbols.includes(symbol);
							return (
								<label
									key={symbol}
									className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all ${
										isSelected
											? 'bg-surface-hover ring-1 ring-primary'
											: 'bg-surface opacity-60 hover:opacity-80'
									}`}
								>
									<input
										type="checkbox"
										checked={isSelected}
										onChange={() => toggleSymbol(symbol)}
										className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
									/>
									<span className="text-sm font-medium text-text">{formatSymbol(symbol)}</span>
								</label>
							);
						})}
					</div>
				</div>
			)}

			{isLoading ? (
				<div className="flex items-center justify-center h-64">
					<div className="text-text-muted">Loading orders...</div>
				</div>
			) : paginatedOrders.length === 0 ? (
				<div className="card text-center py-12">
					<p className="text-text-muted">No orders found</p>
					{selectedSymbols.length !== activeSymbols.length && (
						<p className="text-sm text-text-muted mt-2">Try selecting more symbols</p>
					)}
				</div>
			) : (
				<div className="card overflow-hidden">
					{/* Top pagination */}
					<Pagination />

					<div className="px-4 py-3 border-y border-border bg-surface-hover">
						<p className="text-sm text-text-muted">
							Showing {paginatedOrders.length} of {filteredOrders.length} orders
							{cachedOrders.length > 0 && ` (${cachedOrders.length} total)`}
						</p>
					</div>

					<div className="overflow-x-auto">
						<table className="w-full">
							<thead>
								<tr className="border-b border-border">
									<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">Time</th>
									<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
										Symbol
									</th>
									<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">Side</th>
									<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
										Filled
									</th>
									<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
										Avg Price
									</th>
									<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
										Realized PnL
									</th>
									<th className="text-left py-3 px-4 text-sm font-medium text-text-muted">Fee</th>
								</tr>
							</thead>
							<tbody>
								{paginatedOrders.map((order: Order) => (
									<tr key={order.orderId} className="border-b border-border last:border-b-0">
										<td className="py-3 px-4 text-text-muted text-sm">
											{formatTime(order.createdAt)}
										</td>
										<td className="py-3 px-4 text-text font-medium">
											{formatSymbol(order.symbol)}
										</td>
										<td className="py-3 px-4">
											<span
												className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
													order.side === 'BUY'
														? 'bg-success/10 text-success'
														: 'bg-danger/10 text-danger'
												}`}
											>
												{order.side}
											</span>
										</td>
										<td className="py-3 px-4 text-text">{formatNumber(order.filledSize, 4)}</td>
										<td className="py-3 px-4 text-text">
											{order.avgPrice ? formatCurrency(order.avgPrice, 2) : '-'}
										</td>
										<td
											className={`py-3 px-4 font-medium ${
												order.realizedPnl > 0
													? 'text-success'
													: order.realizedPnl < 0
														? 'text-danger'
														: 'text-text-muted'
											}`}
										>
											{formatCurrency(order.realizedPnl, 2)}
										</td>
										<td className="py-3 px-4 text-text-muted">
											{formatCurrency(order.totalFee, 4)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
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
