import { SymbolCard } from '@/components/SymbolCard';
import { useConfig } from '@/hooks/useApi';

export function Market() {
	const { data: config, isLoading } = useConfig();

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold text-text">Market</h1>
				<p className="text-text-muted mt-1">Select a trading pair to view detailed analysis</p>
			</div>

			{isLoading ? (
				<div className="flex items-center justify-center h-64">
					<div className="text-text-muted">Loading markets...</div>
				</div>
			) : (
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
					{config?.activeSymbols?.map((symbol) => (
						<SymbolCard key={symbol} symbol={symbol} />
					))}
				</div>
			)}
		</div>
	);
}
