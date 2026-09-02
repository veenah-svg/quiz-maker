import { describe, expect, it } from "vitest";
import { hashPassword } from "@/lib/password";

const KNOWN_PLAINTEXT = "quiz-maker-secret";
const KNOWN_SHA256_HEX =
	"c39081716b8b80c7eb8c2bf06584098c6ba939f449d95b22fb45a6a776d613a9";

describe("hashPassword", () => {
	it("returns a 64-character lowercase hex string", async () => {
		const digest = await hashPassword("any-password");
		expect(digest).toMatch(/^[0-9a-f]{64}$/);
	});

	it("returns the same hash for the same plaintext", async () => {
		const first = await hashPassword("repeat-me");
		const second = await hashPassword("repeat-me");
		expect(first).toBe(second);
	});

	it("returns different hashes for different plaintexts", async () => {
		const first = await hashPassword("alpha");
		const second = await hashPassword("bravo");
		expect(first).not.toBe(second);
	});

	it("does not return or contain the plaintext", async () => {
		const plaintext = "visible-secret";
		const digest = await hashPassword(plaintext);
		expect(digest).not.toBe(plaintext);
		expect(digest).not.toContain(plaintext);
	});

	it("matches a known SHA-256 hex digest", async () => {
		await expect(hashPassword(KNOWN_PLAINTEXT)).resolves.toBe(KNOWN_SHA256_HEX);
	});
});
