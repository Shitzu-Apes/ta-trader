import { useState } from 'react';

import { useConfig, useLatestData, useLatestSignal } from '@/hooks/useApi';

export function Market() {
	const { data: config } = useConfig();
	const [selectedSymbol, setSelectedSymbol] = useState(
		config?.activeSymbols?.[0] || 'PERP_BTC_USDC'
	);

	const { data: latestData, isLoading: dataLoading } = useLatestData(selectedSymbol);
	const { data: latestSignal, isLoading: signalLoading } = useLatestSignal(selectedSymbol);

	const isLoading = dataLoading || signalLoading;
	const indicators = latestData?.indicators;
	const signal = latestSignal?.signal;

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
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold text-text">Market Data</h1>
					<p className="text-text-muted mt-1">Technical indicators and analysis</p>
				</div>

				<select
					value={selectedSymbol}
					onChange={(e) => setSelectedSymbol(e.target.value)}
					className="select"
				>
					{config?.activeSymbols?.map((symbol) => (
						<option key={symbol} value={symbol}>
							{symbol.replace('PERP_', '').replace('_USDC', '')}
						</option>
					))}
				</select>
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
									{signal?.taScore?.toFixed(2) || '-'}
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
										{signal.indicators.vwap >= 0 ? '+' : ''}
										{signal.indicators.vwap.toFixed(2)}
									</p>
								</div>
								<div className="text-center p-3 bg-surface-hover rounded-lg">
									<p className="text-xs text-text-muted mb-1">BBands</p>
									<p
										className={`text-lg font-bold ${signal.indicators.bbands >= 0 ? 'text-success' : 'text-danger'}`}
									>
										{signal.indicators.bbands >= 0 ? '+' : ''}
										{signal.indicators.bbands.toFixed(2)}
									</p>
								</div>
								<div className="text-center p-3 bg-surface-hover rounded-lg">
									<p className="text-xs text-text-muted mb-1">RSI</p>
									<p
										className={`text-lg font-bold ${signal.indicators.rsi >= 0 ? 'text-success' : 'text-danger'}`}
									>
										{signal.indicators.rsi >= 0 ? '+' : ''}
										{signal.indicators.rsi.toFixed(2)}
									</p>
								</div>
								<div className="text-center p-3 bg-surface-hover rounded-lg">
									<p className="text-xs text-text-muted mb-1">OBV</p>
									<p
										className={`text-lg font-bold ${signal.indicators.obv >= 0 ? 'text-success' : 'text-danger'}`}
									>
										{signal.indicators.obv >= 0 ? '+' : ''}
										{signal.indicators.obv.toFixed(2)}
									</p>
								</div>
								<div className="text-center p-3 bg-primary/10 rounded-lg">
									<p className="text-xs text-text-muted mb-1">Total</p>
									<p
										className={`text-lg font-bold ${signal.indicators.total >= 0 ? 'text-success' : 'text-danger'}`}
									>
										{signal.indicators.total >= 0 ? '+' : ''}
										{signal.indicators.total.toFixed(2)}
									</p>
								</div>
							</div>
						</div>
					)}
				</>
			)}
		</div>
	);
}
