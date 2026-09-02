export async function hashPassword(plaintext: string): Promise<string> {
	const data = new TextEncoder().encode(plaintext.trim());
	const digest = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}
