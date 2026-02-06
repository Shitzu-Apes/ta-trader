import {
	LayoutDashboard,
	TrendingUp,
	ShoppingCart,
	BarChart3,
	Activity,
	FileText,
	Menu,
	X
} from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

const navItems = [
	{ path: '/', label: 'Overview', icon: LayoutDashboard },
	{ path: '/positions', label: 'Positions', icon: TrendingUp },
	{ path: '/orders', label: 'Orders', icon: ShoppingCart },
	{ path: '/markets', label: 'Markets', icon: BarChart3 },
	{ path: '/signals', label: 'Signals', icon: Activity },
	{ path: '/logs', label: 'Logs', icon: FileText }
];

export function Navigation() {
	const [isOpen, setIsOpen] = useState(false);
	const location = useLocation();

	return (
		<nav className="bg-surface border-b border-border">
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
				<div className="flex justify-between h-16">
					<div className="flex items-center">
						<Link to="/" className="flex items-center gap-2">
							<Activity className="h-6 w-6 text-primary" />
							<span className="font-bold text-lg">TA Trader</span>
						</Link>
					</div>

					{/* Desktop Navigation */}
					<div className="hidden md:flex items-center space-x-1">
						{navItems.map((item) => {
							const Icon = item.icon;
							const isActive =
								location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
							return (
								<Link
									key={item.path}
									to={item.path}
									className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
										isActive
											? 'bg-primary/10 text-primary'
											: 'text-text-muted hover:text-text hover:bg-surface-hover'
									}`}
								>
									<Icon className="h-4 w-4" />
									{item.label}
								</Link>
							);
						})}
					</div>

					{/* Mobile menu button */}
					<div className="flex items-center md:hidden">
						<button
							onClick={() => setIsOpen(!isOpen)}
							className="p-2 rounded-lg text-text-muted hover:text-text hover:bg-surface-hover"
						>
							{isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
						</button>
					</div>
				</div>
			</div>

			{/* Mobile Navigation */}
			{isOpen && (
				<div className="md:hidden border-t border-border">
					<div className="px-2 pt-2 pb-3 space-y-1">
						{navItems.map((item) => {
							const Icon = item.icon;
							const isActive =
								location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
							return (
								<Link
									key={item.path}
									to={item.path}
									onClick={() => setIsOpen(false)}
									className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
										isActive
											? 'bg-primary/10 text-primary'
											: 'text-text-muted hover:text-text hover:bg-surface-hover'
									}`}
								>
									<Icon className="h-4 w-4" />
									{item.label}
								</Link>
							);
						})}
					</div>
				</div>
			)}
		</nav>
	);
}
