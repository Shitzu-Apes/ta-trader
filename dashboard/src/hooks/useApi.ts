import { useQuery } from '@tanstack/react-query';

import { api } from '@/services/api';

const REFRESH_INTERVAL = 30000; // 30 seconds

export function useConfig() {
	return useQuery({
		queryKey: ['config'],
		queryFn: api.getConfig,
		staleTime: Infinity // Config doesn't change during session
	});
}

export function useBalance() {
	return useQuery({
		queryKey: ['balance'],
		queryFn: api.getBalance,
		refetchInterval: REFRESH_INTERVAL,
		staleTime: 25000
	});
}

export function usePositions() {
	return useQuery({
		queryKey: ['positions'],
		queryFn: api.getPositions,
		refetchInterval: REFRESH_INTERVAL,
		staleTime: 25000
	});
}

export function usePortfolio() {
	return useQuery({
		queryKey: ['portfolio'],
		queryFn: api.getPortfolio,
		refetchInterval: REFRESH_INTERVAL,
		staleTime: 25000
	});
}

export function useLatestData(symbol: string) {
	return useQuery({
		queryKey: ['latest', symbol],
		queryFn: () => api.getLatest(symbol),
		refetchInterval: REFRESH_INTERVAL,
		staleTime: 25000,
		enabled: !!symbol
	});
}

export function useHistory(symbol: string, limit = 100) {
	return useQuery({
		queryKey: ['history', symbol, limit],
		queryFn: () => api.getHistory(symbol, limit),
		refetchInterval: REFRESH_INTERVAL,
		staleTime: 25000,
		enabled: !!symbol
	});
}

export function useSignals(symbol: string, limit = 50, cursor?: string) {
	return useQuery({
		queryKey: ['signals', symbol, limit, cursor],
		queryFn: () => api.getSignals(symbol, limit, cursor),
		refetchInterval: REFRESH_INTERVAL,
		staleTime: 25000,
		enabled: !!symbol
	});
}

export function useLatestSignal(symbol: string) {
	return useQuery({
		queryKey: ['latestSignal', symbol],
		queryFn: () => api.getLatestSignal(symbol),
		refetchInterval: REFRESH_INTERVAL,
		staleTime: 25000,
		enabled: !!symbol
	});
}

export function useLogs(limit = 50, cursor?: string, levels?: string[]) {
	return useQuery({
		queryKey: ['logs', limit, cursor, levels],
		queryFn: () => api.getLogs(limit, cursor, levels),
		refetchInterval: REFRESH_INTERVAL,
		staleTime: 25000
	});
}

export function usePositionHistory(page = 1, limit = 10) {
	return useQuery({
		queryKey: ['positionHistory', page, limit],
		queryFn: () => api.getPositionHistory(page, limit),
		refetchInterval: REFRESH_INTERVAL,
		staleTime: 25000
	});
}
