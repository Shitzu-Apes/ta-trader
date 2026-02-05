import { tool } from '@opencode-ai/plugin';

export const LogMonitorPlugin = async (_ctx) => {
	const BASE_URL = 'https://ta-trader-api-testnet.shrm.workers.dev';
	const PROD_URL = 'https://ta-trader-api.shrm.workers.dev';

	return {
		tool: {
			check_logs: tool({
				description:
					'Check TA Trader logs for errors and health status. Fetches logs from the deployed worker API and analyzes them.',
				args: {
					env: tool.schema
						.enum(['testnet', 'production'])
						.default('testnet')
						.describe('Environment to check (testnet or production)'),
					limit: tool.schema
						.number()
						.default(50)
						.describe('Number of log entries to fetch (max 1000)')
				},
				async execute(args) {
					const url = args.env === 'production' ? PROD_URL : BASE_URL;

					try {
						const response = await fetch(`${url}/api/logs?limit=${args.limit}`);
						if (!response.ok) {
							return `Failed to fetch logs: HTTP ${response.status}`;
						}

						const data = await response.json();

						// Analyze logs
						let errors = 0;
						let warnings = 0;
						let info = 0;
						let debug = 0;
						const errorMessages = [];

						for (const log of data.logs || []) {
							for (const entry of log.data || []) {
								if (entry.level === 'ERROR') {
									errors++;
									if (errorMessages.length < 10) {
										errorMessages.push({
											time: entry.timestamp,
											msg: entry.message,
											operation: entry.context?.operation || 'unknown',
											error: entry.error?.message || 'No details'
										});
									}
								} else if (entry.level === 'WARN') {
									warnings++;
								} else if (entry.level === 'INFO') {
									info++;
								} else if (entry.level === 'DEBUG') {
									debug++;
								}
							}
						}

						let result = `📊 LOG ANALYSIS FOR ${args.env.toUpperCase()}\n`;
						result += '='.repeat(60) + '\n';
						result += `Total logs checked: ${data.count}\n`;
						result += `Errors: ${errors} ${errors > 0 ? '❌' : '✅'}\n`;
						result += `Warnings: ${warnings} ${warnings > 0 ? '⚠️' : '✅'}\n`;
						result += `Info: ${info}\n`;
						result += `Debug: ${debug}\n\n`;

						if (errors > 0) {
							result += '❌ ERRORS FOUND:\n';
							result += '-'.repeat(60) + '\n';
							errorMessages.forEach((err, i) => {
								result += `\n${i + 1}. [${err.time}] ${err.msg}\n`;
								result += `   Operation: ${err.operation}\n`;
								result += `   Error: ${err.error}\n`;
							});
							if (errors > 10) {
								result += `\n... and ${errors - 10} more errors\n`;
							}

							// Suggest fixes based on common errors
							result += '\n🔧 SUGGESTED FIXES:\n';
							result += '-'.repeat(60) + '\n';

							const hasTableError = errorMessages.some(
								(e) => e.error.includes('no such table') || e.msg.includes('datapoints')
							);
							const hasRateLimit = errorMessages.some(
								(e) => e.error.includes('429') || e.error.includes('rate limit')
							);
							const hasApiError = errorMessages.some(
								(e) => e.error.includes('TAAPI') || e.msg.includes('fetch')
							);

							if (hasTableError) {
								result += '• Database table missing. Run:\n';
								result += `  yarn wrangler d1 execute ta-trader-${args.env} --remote --file migrations/0000_init.sql\n\n`;
							}
							if (hasRateLimit) {
								result += '• TAAPI rate limit exceeded. Check your TAAPI subscription\n\n';
							}
							if (hasApiError) {
								result += '• API errors detected. Check:\n';
								result +=
									'  - TAAPI_SECRET is set: yarn wrangler secret list --env ' + args.env + '\n';
								result += '  - Database is accessible\n\n';
							}
						} else {
							result += '✅ System is healthy - no errors found!\n';
						}

						return result;
					} catch (error) {
						return `Error checking logs: ${error.message}`;
					}
				}
			}),

			check_health: tool({
				description:
					'Quick health check - just reports if system is healthy or has errors. Use this for quick status checks.',
				args: {
					env: tool.schema
						.enum(['testnet', 'production'])
						.default('testnet')
						.describe('Environment to check')
				},
				async execute(args) {
					const url = args.env === 'production' ? PROD_URL : BASE_URL;

					try {
						const response = await fetch(`${url}/api/logs?limit=20`);
						if (!response.ok) {
							return `❌ Failed to fetch logs: HTTP ${response.status}`;
						}

						const data = await response.json();
						let errors = 0;
						let warnings = 0;

						for (const log of data.logs || []) {
							for (const entry of log.data || []) {
								if (entry.level === 'ERROR') errors++;
								if (entry.level === 'WARN') warnings++;
							}
						}

						let result = `🏥 HEALTH CHECK: ${args.env.toUpperCase()}\n`;
						result += '='.repeat(40) + '\n';

						if (errors === 0 && warnings === 0) {
							result += '✅ HEALTHY - No errors or warnings\n';
						} else if (errors === 0) {
							result += `⚠️ WARNING - ${warnings} warning(s) but no errors\n`;
						} else {
							result += `❌ UNHEALTHY - ${errors} error(s), ${warnings} warning(s)\n`;
							result += 'Run check_logs for detailed analysis\n';
						}

						return result;
					} catch (error) {
						return `❌ Health check failed: ${error.message}`;
					}
				}
			}),

			monitor_both: tool({
				description:
					'Monitor both testnet and production environments. Checks both and reports status for each.',
				args: {
					limit: tool.schema
						.number()
						.default(100)
						.describe('Number of log entries to fetch per environment')
				},
				async execute(args) {
					let result = '🔍 MONITORING BOTH ENVIRONMENTS\n';
					result += '='.repeat(60) + '\n\n';

					// Check testnet
					result += 'TESTNET:\n';
					try {
						const response = await fetch(`${BASE_URL}/api/logs?limit=${args.limit}`);
						const data = await response.json();
						let testnetErrors = 0;
						let testnetWarnings = 0;

						for (const log of data.logs || []) {
							for (const entry of log.data || []) {
								if (entry.level === 'ERROR') testnetErrors++;
								if (entry.level === 'WARN') testnetWarnings++;
							}
						}

						if (testnetErrors === 0 && testnetWarnings === 0) {
							result += '  ✅ Healthy\n';
						} else if (testnetErrors === 0) {
							result += `  ⚠️ ${testnetWarnings} warning(s)\n`;
						} else {
							result += `  ❌ ${testnetErrors} error(s), ${testnetWarnings} warning(s)\n`;
						}
					} catch (error) {
						result += `  ❌ Failed to check: ${error.message}\n`;
					}

					// Check production
					result += '\nPRODUCTION:\n';
					try {
						const response = await fetch(`${PROD_URL}/api/logs?limit=${args.limit}`);
						const data = await response.json();
						let prodErrors = 0;
						let prodWarnings = 0;

						for (const log of data.logs || []) {
							for (const entry of log.data || []) {
								if (entry.level === 'ERROR') prodErrors++;
								if (entry.level === 'WARN') prodWarnings++;
							}
						}

						if (prodErrors === 0 && prodWarnings === 0) {
							result += '  ✅ Healthy\n';
						} else if (prodErrors === 0) {
							result += `  ⚠️ ${prodWarnings} warning(s)\n`;
						} else {
							result += `  ❌ ${prodErrors} error(s), ${prodWarnings} warning(s)\n`;
						}
					} catch (error) {
						result += `  ❌ Failed to check: ${error.message}\n`;
					}

					return result;
				}
			})
		}
	};
};
