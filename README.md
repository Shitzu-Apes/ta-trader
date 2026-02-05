# Technical Trader

An automated trading bot that uses technical analysis to execute trades on Orderly Network perpetual futures.

## Overview

The bot combines several components to make trading decisions:

- **Cloudflare D1** (SQLite) for storing historical market data
- **Technical indicators** from TAAPI (Binance data)
- **Orderly Network** for executing perpetual futures trades and position management
- **Cloudflare Workers** for serverless deployment
- **Cloudflare KV** for structured logging and debugging

## How it Works

1. **Data Collection (Every 5 minutes)**
   - Fetches technical indicators from TAAPI (VWAP, ATR, Bollinger Bands, RSI, OBV)
   - Stores data in Cloudflare D1 using Orderly symbol format
   - Currently supports: PERP_NEAR_USDC, PERP_SOL_USDC, PERP_BTC_USDC, PERP_ETH_USDC

2. **Trading Strategy**
   The bot uses a comprehensive technical analysis approach:

   **Technical Analysis Signal:**
   - Calculates a composite score based on multiple indicators:
     - VWAP crossovers and divergence
     - Bollinger Bands breakouts
     - RSI oversold/overbought levels
     - OBV momentum and divergence
   - Uses dynamic scoring based on market conditions
   - Implements full position sizing (uses entire available balance per trade)

   **Position Management:**
   - Uses clear entry and exit thresholds based on TA score
   - Implements stop loss (-2%) and take profit (+3%) thresholds
   - Signal reversal detection to close positions when trend changes
   - Full position sizing (uses entire available balance per trade)

3. **Orderly Integration**
   - No chain interactions required (account must be prefunded)
   - Uses Orderly REST API with Ed25519 authentication
   - Fetches positions via `/v1/positions`
   - Ignores settled positions (checks `position_qty > 0`)
   - Uses Orderly symbol format throughout (e.g., `PERP_NEAR_USDC`, `PERP_BTC_USDC`)
   - Automatically converts to TAAPI format when fetching indicator data

## Setup

### Prerequisites

- Node.js 18+
- Yarn package manager
- Cloudflare account
- Orderly Network account (prefunded)
- TAAPI API key

### 1. Clone and Install

```bash
git clone <repo-url>
cd ta-trader
yarn install
```

### 2. Configure Environment Variables

Create a `.dev.vars` file for local development:

```bash
# Required
TAAPI_SECRET=your_taapi_api_key
ORDERLY_NETWORK=testnet  # or 'mainnet'
ORDERLY_ACCOUNT_ID=your_orderly_account_id
ORDERLY_PRIVATE_KEY=your_ed25519_private_key
```

For production, use `wrangler secret` with the `--env` flag:

```bash
# Set secrets for production (encrypted)
wrangler secret put TAAPI_SECRET --env production
wrangler secret put ORDERLY_PRIVATE_KEY --env production
```

Public vars are configured in `wrangler.toml` under `[env.production]`:

```toml
vars = { ORDERLY_NETWORK = "mainnet", ORDERLY_ACCOUNT_ID = "your_mainnet_account_id" }
```

### 3. Set Up Orderly Account

1. **Create Orderly Account** (if not already done):
   - Go to [Orderly Network](https://orderly.network)
   - Connect your wallet
   - Register for an account
   - Note your `account_id`

2. **Generate API Keys**:
   - Generate an Ed25519 keypair
   - Add the public key to your Orderly account
   - Save the private key securely

3. **Fund Your Account**:
   - Deposit USDC to your Orderly account
   - For testnet: Use the faucet at `https://testnet-api.orderly.org/v1/faucet/usdc`
   - For mainnet: Deposit via the Orderly UI

### 4. Set Up Cloudflare Resources

You need separate resources for testnet and production:

```bash
# Create testnet resources
wrangler d1 create ta-trader-testnet
wrangler kv namespace create ta-trader-logs-testnet

# Create production resources
wrangler d1 create ta-trader-production
wrangler kv namespace create ta-trader-logs-production

# Update wrangler.toml with all the IDs from above
```

### 5. Configure Environment Variables

**For testnet:**

1. Edit `wrangler.toml` and update the testnet vars with your account ID:

```toml
[env.testnet]
name = "ta-trader-api-testnet"
vars = { ORDERLY_NETWORK = "testnet", ORDERLY_ACCOUNT_ID = "your_testnet_account_id" }
```

2. Set secrets:

```bash
wrangler secret put TAAPI_SECRET --env testnet
wrangler secret put ORDERLY_PRIVATE_KEY --env testnet
```

**For production:**

1. Edit `wrangler.toml` and update the production vars with your account ID:

```toml
[env.production]
name = "ta-trader-api"
vars = { ORDERLY_NETWORK = "mainnet", ORDERLY_ACCOUNT_ID = "your_mainnet_account_id" }
```

2. Set secrets:

```bash
wrangler secret put TAAPI_SECRET --env production
wrangler secret put ORDERLY_PRIVATE_KEY --env production
```

### 6. Deploy

```bash
# Deploy to testnet
yarn deploy --env testnet

# Deploy to production
yarn deploy --env production
```

### 7. Verify Deployment

```bash
# Testnet
 curl https://ta-trader-api-testnet.your-subdomain.workers.dev/api/balance
 curl https://ta-trader-api-testnet.your-subdomain.workers.dev/api/portfolio

# Production
 curl https://ta-trader-api.your-subdomain.workers.dev/api/balance
 curl https://ta-trader-api.your-subdomain.workers.dev/api/portfolio
```

## Configuration

The main trading configuration is in `src/config.ts`:

```typescript
// Orderly symbols are used throughout the app
// Automatically converted to TAAPI format when fetching data
export const SUPPORTED_SYMBOLS = [
	'PERP_NEAR_USDC',
	'PERP_SOL_USDC',
	'PERP_BTC_USDC',
	'PERP_ETH_USDC'
] as const;

// Internal mapping (Orderly -> TAAPI) - handled automatically
const ORDERLY_TO_TAAPI_MAP: Record<string, string> = {
	PERP_NEAR_USDC: 'NEAR/USDT',
	PERP_SOL_USDC: 'SOL/USDT',
	PERP_BTC_USDC: 'BTC/USDT',
	PERP_ETH_USDC: 'ETH/USDT'
};
```

## API Endpoints

- `GET /api/history/:symbol` - Get historical market data for all indicators (use Orderly symbols: `PERP_NEAR_USDC`, `PERP_BTC_USDC`, etc.)
- `GET /api/history/:symbol/:indicator` - Get historical data for specific indicator (candle, vwap, atr, bbands, rsi, obv)
- `GET /api/latest/:symbol` - Get latest market data for all indicators
- `GET /api/position/:symbol` - Get current position for a symbol
- `GET /api/positions` - Get all active positions
- `GET /api/portfolio` - Get overall portfolio status (balance + positions)
- `GET /api/balance` - Get USDC balance
- `POST /api/reset` - Close all positions

## Development

### Local Development

```bash
# Start local dev server
yarn dev

# The bot will run on http://localhost:8787
# Cron triggers won't run automatically - use the API to test
```

### Testing

```bash
# Run linting
yarn lint

# Format code
yarn format
```

### Debugging

Check Cloudflare Workers logs:

```bash
# Tail logs for specific environment
wrangler tail --env testnet
wrangler tail --env production
```

### Managing Environment Variables

Each environment (testnet/production) has its own separate secrets and variables:

**Public vars** (non-sensitive) are configured in `wrangler.toml`:

```toml
# Testnet
[env.testnet]
vars = { ORDERLY_NETWORK = "testnet", ORDERLY_ACCOUNT_ID = "your_testnet_account_id" }

# Production
[env.production]
vars = { ORDERLY_NETWORK = "mainnet", ORDERLY_ACCOUNT_ID = "your_mainnet_account_id" }
```

**Set secrets** (sensitive):

```bash
# Testnet
wrangler secret put TAAPI_SECRET --env testnet
wrangler secret put ORDERLY_PRIVATE_KEY --env testnet

# Production
wrangler secret put TAAPI_SECRET --env production
wrangler secret put ORDERLY_PRIVATE_KEY --env production
```

**List secrets:**

```bash
# List all secrets for an environment
wrangler secret list --env testnet
wrangler secret list --env production
```

**Delete secrets:**

```bash
wrangler secret delete TAAPI_SECRET --env testnet
```

## Logging & Monitoring

The bot uses a comprehensive structured logging system to track all operations for debugging and improvement:

### Log Structure

All logs include:

- **Timestamp** - ISO 8601 format
- **Log Level** - DEBUG, INFO, WARN, ERROR
- **Request ID** - Correlation ID for tracing
- **Symbol** - Trading pair (e.g., NEAR/USDT)
- **Operation** - What the bot is doing
- **Context** - Additional structured data

### Log Storage

Logs are stored in two places:

1. **Cloudflare Workers Console** - Real-time streaming via `wrangler tail`
2. **KV Storage** - Persistent logs with 24-hour retention for analysis

### Logged Events

The bot logs detailed information about:

- **Data Collection** - TAAPI fetch status, indicator storage, missing data
- **Technical Analysis** - Individual indicator scores (VWAP, BBands, RSI, OBV), composite TA scores
- **Trading Decisions** - Entry/exit signals, threshold comparisons, position sizing
- **Position Management** - Open/close operations, stop loss/take profit triggers, PnL updates
- **API Interactions** - Orderly API requests/responses, authentication, errors
- **Errors** - Full stack traces, error codes, recovery attempts

### Viewing Logs

**Real-time streaming:**

```bash
# Tail logs for specific environment
wrangler tail --env testnet
wrangler tail --env production
```

**Query stored logs from KV:**

```bash
# List all log entries
wrangler kv key list --binding=LOGS --env production

# Get specific log entry
wrangler kv key get "logs:{request-id}:{timestamp}" --binding=LOGS --env production
```

**Via Cloudflare Dashboard:**

- Workers & Pages → Your Worker → Logs tab (real-time)
- Workers & Pages → KV → LOGS namespace (stored logs)

## Architecture

```
┌─────────────────────────────────────┐
│         Cloudflare Workers          │
│  ┌─────────────┐  ┌──────────────┐  │
│  │   Trading   │  │   Logging    │  │
│  │   Engine    │  │   System     │  │
│  └──────┬──────┘  └──────┬───────┘  │
└─────────┼────────────────┼──────────┘
          │                │
    ┌─────┴─────┐    ┌─────┴─────┐
    │           │    │           │
┌───▼───┐  ┌────▼──┐ │  ┌───────▼──┐
│  D1   │  │Orderly│ │  │    KV    │
│(Data) │  │Network│ │  │  (Logs)  │
└───┬───┘  └───────┘ │  └──────────┘
    │                │
┌───▼────────────────┴──────────┐
│        TAAPI (Binance)        │
│    Technical Indicators       │
└───────────────────────────────┘
```

## Important Notes

- **No chain interactions**: The bot only uses Orderly's REST API. Your account must be prefunded.
- **Position settlement**: Orderly may return settled positions. The bot checks `position_qty > 0` to filter these out.
- **Positions**: All positions are stored and managed by Orderly. The bot fetches them via API.
- **Testnet first**: Always test on testnet before deploying to mainnet.

## Troubleshooting

### "Invalid signature" errors

- Check that your `ORDERLY_PRIVATE_KEY` is correct
- Ensure the key is in the right format (64 or 128 hex chars)

### "Account not found" errors

- Verify `ORDERLY_ACCOUNT_ID` is correct
- Ensure the account is registered with Orderly

### No trades executing

- Check that you have USDC balance: `GET /api/balance`
- Verify TAAPI is returning data: `GET /api/latest/NEAR/USDT`
- Check logs for signal calculations: `wrangler tail --env production`
- Review stored logs in KV for detailed error context

### Positions not showing

- Orderly returns settled positions with zero size - these are filtered out
- Check Orderly dashboard to see actual positions

## Contributing

Feel free to submit issues and pull requests for:

- New trading strategies
- Additional technical indicators
- Market support
- Performance improvements
- Documentation updates

## License

MIT
