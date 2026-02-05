/** @type {import('tailwindcss').Config} */
export default {
	darkMode: 'class',
	content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
	theme: {
		extend: {
			colors: {
				background: '#0f172a',
				surface: '#1e293b',
				'surface-hover': '#334155',
				border: '#475569',
				text: '#f8fafc',
				'text-muted': '#94a3b8',
				primary: '#3b82f6',
				'primary-hover': '#2563eb',
				success: '#22c55e',
				danger: '#ef4444',
				warning: '#f59e0b',
				info: '#06b6d4'
			}
		}
	},
	plugins: []
};
