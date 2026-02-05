import { EnvBindings } from '../types';

/**
 * Orderly Network Ed25519 Authentication
 *
 * Orderly uses Ed25519 signatures for API authentication.
 * Each request must include:
 * - orderly-account-id: Your Orderly account ID
 * - orderly-key: Your public key (derived from private key)
 * - orderly-timestamp: Current timestamp in milliseconds
 * - orderly-signature: Ed25519 signature of the message
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
	return network === 'testnet' ? 'https://testnet-api.orderly.org' : 'https://api.orderly.org';
}

// Get public key from private key (Ed25519)
// In a real implementation, this would use the Ed25519 library
// For now, we'll derive it from the private key
export function getPublicKeyFromPrivate(privateKey: string): string {
	// This is a placeholder - in production, use proper Ed25519 derivation
	// The public key is the last 64 characters of the private key (without 0x prefix)
	const cleanKey = privateKey.replace('0x', '');
	if (cleanKey.length === 128) {
		return cleanKey.slice(64);
	}
	// If it's already just the public key (64 chars), return it
	if (cleanKey.length === 64) {
		return cleanKey;
	}
	throw new Error('Invalid private key format');
}

// Sign a message using Ed25519
// This is a placeholder - in production, use proper Ed25519 signing
export async function signMessage(message: string, privateKey: string): Promise<string> {
	// For Cloudflare Workers, we need to use the Web Crypto API
	// Ed25519 is supported in modern browsers and Cloudflare Workers

	const encoder = new TextEncoder();
	const messageData = encoder.encode(message);

	// Import the private key
	const keyData = hexToUint8Array(privateKey.replace('0x', ''));

	// For Ed25519, we need the raw private key (first 32 bytes) or the full 64 bytes
	// The Web Crypto API supports Ed25519 in extractable format
	const privateKeyBytes = keyData.slice(0, 32);

	try {
		const cryptoKey = await crypto.subtle.importKey(
			'raw',
			privateKeyBytes,
			{ name: 'Ed25519' },
			false,
			['sign']
		);

		const signature = await crypto.subtle.sign('Ed25519', cryptoKey, messageData);
		return uint8ArrayToHex(new Uint8Array(signature));
	} catch (error) {
		// Fallback: if Web Crypto doesn't support Ed25519, use a library
		// For now, throw an error
		throw new Error(`Ed25519 signing not supported: ${error}`);
	}
}

// Helper: Convert hex string to Uint8Array
function hexToUint8Array(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
	}
	return bytes;
}

// Helper: Convert Uint8Array to hex string
function uint8ArrayToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
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
	const signature = await signMessage(message, env.ORDERLY_PRIVATE_KEY);
	const publicKey = getPublicKeyFromPrivate(env.ORDERLY_PRIVATE_KEY);

	return {
		'Content-Type': 'application/json',
		'orderly-account-id': env.ORDERLY_ACCOUNT_ID,
		'orderly-key': publicKey,
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

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Orderly API error: ${response.status} ${errorText}`);
	}

	return response.json() as Promise<T>;
}
