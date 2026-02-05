When working on the TA swing trading bot project, use these commands to monitor and debug:

## Log Monitoring

Always check logs after deployments or when debugging issues:

```bash
# Quick health check (latest 50 logs)
yarn logs

# Check more logs
yarn logs -- --limit 100

# Check production
yarn logs:prod

# Full command with all options
node scripts/monitor-logs.js --env testnet --limit 20
```

## Deployment Workflow

After making changes:

1. **Lint and format:**

```bash
npm run lint
npm run format
```

2. **Deploy to testnet:**

```bash
yarn deploy --env testnet
```

3. **Check logs for errors:**

```bash
yarn logs:testnet
```

4. **If testnet is healthy, deploy to production:**

```bash
yarn deploy --env production
yarn logs:prod
```

## Common Issues

### Database errors

If you see `no such table: datapoints`, the D1 database needs initialization:

```bash
yarn wrangler d1 execute ta-trader-testnet --remote --file migrations/0000_init.sql
```

### TAAPI rate limits

If you see `429 - rate limit exceeded`, the TAAPI subscription may need refresh or upgrade.

### KV/Binding errors

Ensure wrangler.toml has correct binding names:

- `LOGS` (not `ta_trader_logs_testnet`)
- `DB` (not `ta_trader_testnet`)

## API Endpoints

Useful endpoints for debugging:

```bash
# Check stored logs
 curl https://ta-trader-api-testnet.shrm.workers.dev/api/logs?limit=10

# Check balance
 curl https://ta-trader-api-testnet.shrm.workers.dev/api/balance

# Check positions
 curl https://ta-trader-api-testnet.shrm.workers.dev/api/positions

# Check portfolio
 curl https://ta-trader-api-testnet.shrm.workers.dev/api/portfolio
```

## Cron Schedules

The bot runs two schedules:

- **Every 5 minutes:** Full trading cycle (fetch indicators + analyze + open/close positions)
- **Every minute:** Position monitoring only (check stop loss/take profit, close only)

## Log Levels

When analyzing logs:

- **ERROR:** Something failed - needs attention
- **WARN:** Potential issue - monitor
- **INFO:** Normal operations
- **DEBUG:** Detailed info for troubleshooting

Always prioritize fixing ERRORs before WARNs.
