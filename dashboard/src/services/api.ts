import type {
	Config,
	Balance,
	Position,
	Portfolio,
	LatestData,
	HistoricalData,
	SignalsData,
	LogsData
} from '@/types';

const API_BASE = '';

async function fetchJson<T>(url: string): Promise<T> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`HTTP error! status: ${response.status}`);
	}
	return response.json();
}

export const api = {
	getConfig: () => fetchJson<Config>(`${API_BASE}/api/config`),
	getBalance: () => fetchJson<Balance>(`${API_BASE}/api/balance`),
	getPositions: () => fetchJson<{ positions: Position[] }>(`${API_BASE}/api/positions`),
	getPortfolio: () => fetchJson<Portfolio>(`${API_BASE}/api/portfolio`),
	getLatest: (symbol: string) => fetchJson<LatestData>(`${API_BASE}/api/latest/${symbol}`),
	getHistory: (symbol: string, limit = 100) =>
		fetchJson<HistoricalData>(`${API_BASE}/api/history/${symbol}?limit=${limit}`),
	getSignals: (symbol: string, limit = 50) =>
		fetchJson<SignalsData>(`${API_BASE}/api/signals/${symbol}?limit=${limit}`),
	getLatestSignal: (symbol: string) =>
		fetchJson<{ symbol: string; signal: SignalsData['signals'][0] }>(
			`${API_BASE}/api/signals/${symbol}/latest`
		),
	getLogs: (limit = 100) => fetchJson<LogsData>(`${API_BASE}/api/logs?limit=${limit}`)
};
