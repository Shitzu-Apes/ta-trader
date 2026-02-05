# TA Trader Log Monitor Agent

This opencode agent monitors your TA Trader bot logs automatically.

## Manual Tools

Use these commands to check logs manually:

### @log-monitor check_health

Quick health check - just shows if system is healthy or has errors.

```
@log-monitor check_health env=testnet
@log-monitor check_health env=production
```

### @log-monitor check_logs

Deep log analysis with error details and suggested fixes.

```
@log-monitor check_logs env=testnet limit=50
@log-monitor check_logs env=production limit=100
```

### @log-monitor monitor_both

Check both testnet and production environments at once.

```
@log-monitor monitor_both limit=100
```

## Automatic Monitoring

The agent also runs automatically on a schedule to monitor your bot:

- **Every 30 minutes:** Checks both environments
- **Reports only when:** Errors are found
- **Suggests fixes:** Based on error patterns

## Error Patterns Detected

The agent recognizes these common errors and suggests fixes:

| Error Pattern                      | Suggested Fix              |
| ---------------------------------- | -------------------------- |
| `no such table: datapoints`        | Run D1 migration           |
| `429 rate limit`                   | Check TAAPI subscription   |
| `Failed to fetch/store indicators` | Check secrets and database |

## Usage Examples

**After deploying to testnet:**

```
@log-monitor check_logs env=testnet
```

**Quick status check:**

```
@log-monitor check_health
```

**Before deploying to production:**

```
@log-monitor monitor_both
```

**Investigating issues:**

```
@log-monitor check_logs env=testnet limit=200
```
