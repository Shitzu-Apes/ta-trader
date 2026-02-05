import { ReactNode } from 'react';

interface StatCardProps {
	title: string;
	value: string | number;
	subtitle?: string;
	icon?: ReactNode;
	trend?: 'up' | 'down' | 'neutral';
	trendValue?: string;
}

export function StatCard({ title, value, subtitle, icon, trend, trendValue }: StatCardProps) {
	const trendColors = {
		up: 'text-success',
		down: 'text-danger',
		neutral: 'text-text-muted'
	};

	return (
		<div className="card">
			<div className="flex items-start justify-between">
				<div>
					<p className="text-sm font-medium text-text-muted">{title}</p>
					<p className="mt-2 text-3xl font-bold text-text">{value}</p>
					{subtitle && <p className="mt-1 text-sm text-text-muted">{subtitle}</p>}
					{trend && trendValue && (
						<p className={`mt-1 text-sm font-medium ${trendColors[trend]}`}>
							{trend === 'up' && '↑'}
							{trend === 'down' && '↓'}
							{trend === 'neutral' && '→'} {trendValue}
						</p>
					)}
				</div>
				{icon && <div className="p-3 bg-primary/10 rounded-lg">{icon}</div>}
			</div>
		</div>
	);
}
