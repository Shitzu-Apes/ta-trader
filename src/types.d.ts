import { D1Database, Fetcher, KVNamespace } from '@cloudflare/workers-types/experimental';

export interface EnvBindings {
	TAAPI_SECRET: string;
	DB: D1Database;
	LOGS: KVNamespace; // For storing structured logs
	PROXY_URL?: string;
	PROXY_USERNAME?: string;
	PROXY_PASSWORD?: string;
	BINANCE_API_URL: string;

	// Orderly Network Configuration
	ORDERLY_ACCOUNT_ID: string;
	ORDERLY_PRIVATE_KEY: string;
	ORDERLY_NETWORK: 'testnet' | 'mainnet';

	// Static assets binding for SPA
	ASSETS: Fetcher;
}
