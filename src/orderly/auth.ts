import { getPublicKeyAsync, signAsync } from '@noble/ed25519';
import bs58 from 'bs58';

import { getLogger, createContext } from '../logger';
import { EnvBindings } from '../types';

/**
 * Orderly Network Ed25519 Authentication
 *
 * Orderly uses Ed25519 signatures for API authentication.
 * Each request must include:
 * - orderly-account-id: Your Orderly account ID
 * - orderly-key: Your public key (prefixed with 'ed25519:' and base58 encoded)
 * - orderly-timestamp: Current timestamp in milliseconds
 * - orderly-signature: Ed25519 signature (base64url encoded)
 */

// Message format for signing: timestamp + method + path + body (if present)
export function createSignMessage(
	timestamp: string,
	method: string,
	path: string,
	body?: object
): string {
	const message =
		body && Object.keys(body).length > 0
			? `${timestamp}${method}${path}${JSON.stringify(body)}`
			: `${timestamp}${method}${path}`;
	return message;
}

// Get base URL based on network
export function getOrderlyBaseUrl(network: 'testnet' | 'mainnet'): string {
	return network === 'testnet'
		? 'https://testnet-api-evm.orderly.org'
		: 'https://api-evm.orderly.org';
}

// Helper: Convert base64url string
function encodeBase64Url(bytes: Uint8Array): string {
	// Convert to regular base64
	const base64 = btoa(String.fromCharCode(...bytes));
	// Convert to base64url (replace + with -, / with _, remove =)
	return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Parse private key from base58 format (Orderly standard)
function parsePrivateKey(privateKey: string): Uint8Array {
	let cleanKey = privateKey.trim();

	// Some keys may have prefixes like "ed25519:" or contain underscores
	// Remove common prefixes and extract the actual key
	if (cleanKey.includes(':')) {
		cleanKey = cleanKey.split(':').pop() || cleanKey;
	}

	// Remove underscores if present (they might be separators)
	cleanKey = cleanKey.replace(/_/g, '');

	try {
		// Decode base58
		const decoded = bs58.decode(cleanKey);

		// Orderly private keys are 32 bytes (seed)
		// @noble/ed25519 can derive the public key from the seed
		if (decoded.length === 32) {
			return decoded;
		} else if (decoded.length === 64) {
			// If full 64-byte key provided, use first 32 bytes (seed)
			return decoded.slice(0, 32);
		} else {
			throw new Error(
				`Invalid key length after base58 decode: ${decoded.length} bytes (expected 32 or 64)`
			);
		}
	} catch (error) {
		if (error instanceof Error && error.message.includes('Invalid key length')) {
			throw error;
		}
		// Try hex format as fallback
	}

	// Try hex format
	const hexPattern = /^0x?[0-9a-fA-F]+$/;
	if (hexPattern.test(cleanKey)) {
		const hexKey = cleanKey.replace('0x', '');
		if (hexKey.length === 64) {
			// 32 bytes in hex
			const bytes = new Uint8Array(32);
			for (let i = 0; i < 64; i += 2) {
				bytes[i / 2] = parseInt(hexKey.substring(i, i + 2), 16);
			}
			return bytes;
		} else if (hexKey.length === 128) {
			// 64 bytes in hex, use first 32
			const bytes = new Uint8Array(32);
			for (let i = 0; i < 64; i += 2) {
				bytes[i / 2] = parseInt(hexKey.substring(i, i + 2), 16);
			}
			return bytes;
		}
	}

	throw new Error(
		`Invalid private key format. Length: ${cleanKey.length} chars. ` +
			'Expected base58 encoded 32-byte seed (typical Orderly format) or 64 hex characters.'
	);
}

// Get public key from private key (async - uses @noble/ed25519)
async function getPublicKey(privateKey: Uint8Array): Promise<string> {
	const publicKeyBytes = await getPublicKeyAsync(privateKey);
	return bs58.encode(publicKeyBytes);
}

// Sign a message using Ed25519 via @noble/ed25519
async function signMessage(message: string, privateKey: Uint8Array): Promise<string> {
	const encoder = new TextEncoder();
	const messageData = encoder.encode(message);

	const signature = await signAsync(messageData, privateKey);
	return encodeBase64Url(signature);
}

// Create authentication headers for Orderly API
export async function createAuthHeaders(
	env: EnvBindings,
	method: string,
	path: string,
	body?: object
): Promise<Record<string, string>> {
	const timestamp = Date.now().toString();
	const message = createSignMessage(timestamp, method, path, body);

	// Parse private key
	const privateKeyBytes = parsePrivateKey(env.ORDERLY_PRIVATE_KEY);

	// Get public key and signature
	const publicKey = await getPublicKey(privateKeyBytes);
	const signature = await signMessage(message, privateKeyBytes);

	return {
		'Content-Type': 'application/json',
		'orderly-account-id': env.ORDERLY_ACCOUNT_ID,
		'orderly-key': `ed25519:${publicKey}`,
		'orderly-timestamp': timestamp,
		'orderly-signature': signature
	};
}

// Make an authenticated request to Orderly API
export async function makeOrderlyRequest<T>(
	env: EnvBindings,
	method: string,
	path: string,
	body?: object
): Promise<T> {
	const baseUrl = getOrderlyBaseUrl(env.ORDERLY_NETWORK);
	const headers = await createAuthHeaders(env, method, path, body);

	const url = `${baseUrl}${path}`;
	const options: {
		method: string;
		headers: Record<string, string>;
		body?: string;
	} = {
		method,
		headers
	};

	if (body && method !== 'GET') {
		options.body = JSON.stringify(body);
	}

	const response = await fetch(url, options);

	const responseText = await response.text();
	let responseData: { success?: boolean; [key: string]: unknown };

	try {
		responseData = JSON.parse(responseText) as { success?: boolean; [key: string]: unknown };
	} catch {
		throw new Error(`Orderly API returned non-JSON: ${responseText}`);
	}

	const logger = getLogger(env);
	const ctx = createContext(
		typeof body === 'object' && body !== null && 'symbol' in body
			? (body as { symbol: string }).symbol
			: 'unknown',
		`orderly_${method.toLowerCase()}_${path.replace(/\//g, '_')}`
	);

	if (!response.ok) {
		const errorMessage = `Orderly API error: ${response.status} ${JSON.stringify(responseData)}`;
		logger.error('Orderly request failed', new Error(errorMessage), ctx, {
			method,
			path,
			requestBody: body,
			response: responseData,
			status: response.status
		});
		throw new Error(errorMessage);
	}

	// Check if response has success=false
	if (responseData.success === false) {
		const errorMessage = `Orderly API error: ${JSON.stringify(responseData)}`;
		logger.error('Orderly request returned success=false', new Error(errorMessage), ctx, {
			method,
			path,
			requestBody: body,
			response: responseData
		});
		throw new Error(errorMessage);
	}

	return responseData as T;
}
