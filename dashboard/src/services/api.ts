import type {
	Config,
	Balance,
	Position,
	Portfolio,
	LatestData,
	HistoricalData,
	SignalsData,
	LogsData,
	PositionHistoryResponse
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
	getSignals: (symbol: string, limit = 50, cursor?: string) => {
		const params = new URLSearchParams();
		params.append('limit', String(limit));
		if (cursor) {
			params.append('cursor', cursor);
		}
		return fetchJson<SignalsData>(`${API_BASE}/api/signals/${symbol}?${params.toString()}`);
	},
	getLatestSignal: (symbol: string) =>
		fetchJson<{ symbol: string; signal: SignalsData['signals'][0] }>(
			`${API_BASE}/api/signals/${symbol}/latest`
		),
	getLogs: (limit = 50, cursor?: string, levels?: string[]) => {
		const params = new URLSearchParams();
		params.append('limit', String(limit));
		if (cursor) {
			params.append('cursor', cursor);
		}
		if (levels && levels.length > 0) {
			levels.forEach((level) => params.append('level', level));
		}
		return fetchJson<LogsData>(`${API_BASE}/api/logs?${params.toString()}`);
	},
	getPositionHistory: (page = 1, limit = 10) =>
		fetchJson<PositionHistoryResponse>(
			`${API_BASE}/api/position-history?page=${page}&limit=${limit}`
		)
};
