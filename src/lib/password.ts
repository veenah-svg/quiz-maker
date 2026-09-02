export async function hashPassword(plaintext: string): Promise<string> {
	const data = new TextEncoder().encode(plaintext.trim());
	const digest = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export function passwordHashesMatch(stored: string, received: string): boolean {
	if (stored.length !== received.length) {
		return false;
	}

	let mismatch = 0;
	for (let i = 0; i < stored.length; i += 1) {
		mismatch |= stored.charCodeAt(i) ^ received.charCodeAt(i);
	}
	return mismatch === 0;
}
