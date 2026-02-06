export interface Config {
	environment: 'testnet' | 'production';
	activeSymbols: string[];
	version: string;
}

export interface Balance {
	balance: number;
	currency: string;
	dailyPnl?: number;
}

export interface Position {
	symbol: string;
	isLong: boolean;
	size: number;
	entryPrice: number;
	markPrice: number;
	unrealizedPnl: number;
	realizedPnl: number;
	lastUpdateTime: number;
}

export interface Portfolio {
	balance: number;
	positions: Position[];
	dailyPnl?: number;
}

export interface IndicatorData {
	candle?: {
		open: number;
		high: number;
		low: number;
		close: number;
		volume: number;
	};
	rsi?: { value: number };
	vwap?: { value: number };
	bbands?: {
		valueUpperBand: number;
		valueMiddleBand: number;
		valueLowerBand: number;
	};
	obv?: { value: number };
	atr?: { value: number };
}

export interface LatestData {
	symbol: string;
	timestamp: number;
	indicators: IndicatorData;
}

export interface HistoricalDataPoint {
	timestamp: number;
	indicators: IndicatorData;
}

export interface HistoricalData {
	symbol: string;
	data: HistoricalDataPoint[];
}

export interface Signal {
	timestamp: number;
	type: 'ENTRY' | 'EXIT' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'ADJUSTMENT' | 'HOLD' | 'NO_ACTION';
	direction: 'LONG' | 'SHORT';
	action: string;
	reason: string;
	taScore: number;
	threshold: number;
	price: number;
	positionSize: number;
	entryPrice: number;
	unrealizedPnl: number;
	realizedPnl: number;
	indicators: {
		vwap: number;
		bbands: number;
		rsi: number;
		obv: number;
		total: number;
	};
}

export interface SignalsData {
	symbol: string;
	count: number;
	totalCount: number;
	signals: Signal[];
	pagination: {
		hasMore: boolean;
		nextCursor?: string;
	};
}

export interface LogEntry {
	id: number;
	timestamp: string;
	level: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
	message: string;
	requestId: string;
	symbol?: string;
	operation?: string;
	data?: Record<string, unknown>;
	error?: {
		message: string;
		stack?: string;
		code?: string;
	};
	createdAt: string;
}

export interface LogsData {
	count: number;
	total: number;
	offset: number;
	limit: number;
	logs: LogEntry[];
}

export interface PositionHistory {
	symbol: string;
	side: 'LONG' | 'SHORT';
	size: number;
	entryPrice: number;
	exitPrice: number;
	realizedPnl: number;
	openedAt: number;
	closedAt: number;
}

export interface PositionHistoryResponse {
	history: PositionHistory[];
	pagination: {
		page: number;
		limit: number;
		total: number;
		totalPages: number;
		hasNext: boolean;
		hasPrev: boolean;
	};
}
