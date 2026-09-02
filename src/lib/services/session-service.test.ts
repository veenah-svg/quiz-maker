import { describe, expect, it, vi } from "vitest";
import { createSession, deleteSession, getSession } from "./session-service";

type SessionRow = {
	id: string;
	user_id: string;
	expires_at: string;
};

type PreparedCall = {
	sql: string;
	bound: unknown[];
};

function createFakeDb(options?: {
	results?: SessionRow[];
}): { db: D1Database; calls: PreparedCall[] } {
	const calls: PreparedCall[] = [];
	const results = options?.results ?? [];

	const db = {
		prepare(sql: string) {
			const call: PreparedCall = { sql, bound: [] };
			calls.push(call);

			const statement = {
				bind(...values: unknown[]) {
					call.bound = values;
					return statement;
				},
				async all() {
					return { results };
				},
				async run() {
					return { success: true };
				},
			};

			return statement;
		},
	} as unknown as D1Database;

	return { db, calls };
}

const future = new Date(Date.now() + 60_000).toISOString();

describe("session service", () => {
	it("creates a distinct session row per login so two browsers can stay independent", async () => {
		const firstId = "aa".repeat(32);
		const secondId = "bb".repeat(32);
		const randomMock = vi.spyOn(crypto, "getRandomValues");
		randomMock
			.mockImplementationOnce((array) => {
				(array as Uint8Array).fill(0xaa);
				return array;
			})
			.mockImplementationOnce((array) => {
				(array as Uint8Array).fill(0xbb);
				return array;
			});

		const firstDb = createFakeDb({
			results: [{ id: firstId, user_id: "user-1", expires_at: future }],
		});
		const secondDb = createFakeDb({
			results: [{ id: secondId, user_id: "user-1", expires_at: future }],
		});

		const first = await createSession(firstDb.db, "user-1");
		const second = await createSession(secondDb.db, "user-1");

		expect(first.id).not.toBe(second.id);
		expect(first.userId).toBe("user-1");
		expect(second.userId).toBe("user-1");

		const insert = firstDb.calls.find((call) => /insert into sessions/i.test(call.sql));
		expect(insert?.sql).toMatch(/\?1/);
		expect(insert?.bound[1]).toBe("user-1");

		randomMock.mockRestore();
	});

	it("looks up a session by id and ignores expired rows", async () => {
		const { db, calls } = createFakeDb({
			results: [{ id: "sess-1", user_id: "user-1", expires_at: future }],
		});

		const session = await getSession(db, "sess-1");

		expect(session).toEqual({
			id: "sess-1",
			userId: "user-1",
			expiresAt: future,
		});
		expect(calls[0]?.sql).toMatch(/expires_at > \?2/i);
		expect(calls[0]?.bound[0]).toBe("sess-1");
	});

	it("returns null when this browser has no session id", async () => {
		const { db, calls } = createFakeDb();
		await expect(getSession(db, undefined)).resolves.toBeNull();
		expect(calls).toHaveLength(0);
	});

	it("deletes only the session id from this browser, not every session for the user", async () => {
		const { db, calls } = createFakeDb();

		await deleteSession(db, "sess-browser-a");

		expect(calls).toHaveLength(1);
		expect(calls[0]?.sql).toMatch(/delete from sessions where id = \?1/i);
		expect(calls[0]?.sql).not.toMatch(/user_id/i);
		expect(calls[0]?.bound).toEqual(["sess-browser-a"]);
	});
});
