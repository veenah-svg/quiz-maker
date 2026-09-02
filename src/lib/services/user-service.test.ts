import { describe, expect, it } from "vitest";
import {
	UserConflictError,
	createUser,
	deleteUser,
	getUserByEmail,
	getUserByUsername,
	updateUser,
	type CreateUserInput,
} from "@/lib/services/user-service";

type UserRow = {
	id: string;
	first_name: string;
	last_name: string;
	username: string;
	email: string;
	password_hash: string;
};

type PreparedCall = {
	sql: string;
	bound: unknown[];
};

function createFakeDb(options?: {
	results?: UserRow[];
	error?: Error;
}): { db: D1Database; calls: PreparedCall[] } {
	const calls: PreparedCall[] = [];
	const results = options?.results ?? [];
	const error = options?.error;

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
					if (error) {
						throw error;
					}
					return { results };
				},
				async run() {
					if (error) {
						throw error;
					}
					return { success: true };
				},
			};

			return statement;
		},
	} as unknown as D1Database;

	return { db, calls };
}

const adaInput: CreateUserInput = {
	firstName: "Ada",
	lastName: "Lovelace",
	username: "alovelace",
	email: "ada@school.edu",
	passwordHash: "a".repeat(64),
};

const adaRow: UserRow = {
	id: "user-1",
	first_name: "Ada",
	last_name: "Lovelace",
	username: "alovelace",
	email: "ada@school.edu",
	password_hash: "a".repeat(64),
};

describe("user service", () => {
	describe("createUser", () => {
		it("inserts a user and returns public fields without passwordHash", async () => {
			const { db, calls } = createFakeDb({ results: [adaRow] });

			const user = await createUser(db, adaInput);

			expect(user).toEqual({
				id: "user-1",
				firstName: "Ada",
				lastName: "Lovelace",
				username: "alovelace",
				email: "ada@school.edu",
			});
			expect(user).not.toHaveProperty("passwordHash");
			expect(JSON.stringify(user)).not.toContain(adaInput.passwordHash);

			const insert = calls.find((call) => /insert into users/i.test(call.sql));
			expect(insert).toBeDefined();
			expect(insert?.sql).toMatch(/\?1/);
			expect(insert?.sql).toMatch(/\?2/);
			expect(insert?.bound).toContain("Ada");
			expect(insert?.bound).toContain(adaInput.passwordHash);
		});

		it("allows username to equal email for the same user", async () => {
			const email = "teacher@school.edu";
			const row: UserRow = {
				...adaRow,
				id: "user-2",
				username: email,
				email,
			};
			const { db } = createFakeDb({ results: [row] });

			const user = await createUser(db, {
				...adaInput,
				username: email,
				email,
			});

			expect(user.username).toBe(email);
			expect(user.email).toBe(email);
		});

		it("maps a unique username constraint failure to UserConflictError", async () => {
			const { db } = createFakeDb({
				error: new Error("UNIQUE constraint failed: users.username"),
			});

			await expect(createUser(db, adaInput)).rejects.toBeInstanceOf(
				UserConflictError,
			);
			await expect(createUser(db, adaInput)).rejects.toMatchObject({
				field: "username",
			});
		});

		it("maps a unique email constraint failure to UserConflictError", async () => {
			const { db } = createFakeDb({
				error: new Error("UNIQUE constraint failed: users.email"),
			});

			await expect(createUser(db, adaInput)).rejects.toMatchObject({
				field: "email",
			});
		});

		it("stores email in lowercase", async () => {
			const { db, calls } = createFakeDb({
				results: [{ ...adaRow, email: "ada@school.edu" }],
			});

			await createUser(db, { ...adaInput, email: "Ada@School.EDU" });

			const insert = calls.find((call) => /insert into users/i.test(call.sql));
			expect(insert?.bound).toContain("ada@school.edu");
			expect(insert?.bound).not.toContain("Ada@School.EDU");
		});
	});

	describe("getUserByUsername", () => {
		it("returns the user including passwordHash when a row exists", async () => {
			const { db } = createFakeDb({ results: [adaRow] });

			await expect(getUserByUsername(db, "alovelace")).resolves.toEqual({
				id: "user-1",
				firstName: "Ada",
				lastName: "Lovelace",
				username: "alovelace",
				email: "ada@school.edu",
				passwordHash: adaInput.passwordHash,
			});
		});

		it("returns null when no row exists", async () => {
			const { db } = createFakeDb({ results: [] });

			await expect(getUserByUsername(db, "missing")).resolves.toBeNull();
		});
	});

	describe("getUserByEmail", () => {
		it("returns the user when a row exists", async () => {
			const { db } = createFakeDb({ results: [adaRow] });

			const user = await getUserByEmail(db, "Ada@School.EDU");
			expect(user?.email).toBe("ada@school.edu");
			expect(user?.passwordHash).toBe(adaInput.passwordHash);
		});

		it("returns null when no row exists", async () => {
			const { db } = createFakeDb({ results: [] });

			await expect(getUserByEmail(db, "gone@school.edu")).resolves.toBeNull();
		});
	});

	describe("updateUser", () => {
		it("updates provided fields and sets updated_at", async () => {
			const updatedRow: UserRow = {
				...adaRow,
				first_name: "Augusta",
			};
			const { db, calls } = createFakeDb({ results: [updatedRow] });

			const user = await updateUser(db, "user-1", { firstName: "Augusta" });

			expect(user.firstName).toBe("Augusta");
			const update = calls.find((call) => /update users/i.test(call.sql));
			expect(update).toBeDefined();
			expect(update?.sql).toMatch(/updated_at/i);
			expect(update?.sql).toMatch(/\?1/);
			expect(update?.bound).toContain("Augusta");
			expect(update?.bound).toContain("user-1");
		});
	});

	describe("deleteUser", () => {
		it("deletes the user by id", async () => {
			const { db, calls } = createFakeDb();

			await deleteUser(db, "user-1");

			const deletion = calls.find((call) => /delete from users/i.test(call.sql));
			expect(deletion).toBeDefined();
			expect(deletion?.sql).toMatch(/\?1/);
			expect(deletion?.bound).toEqual(["user-1"]);
		});
	});

	describe("SQL safety", () => {
		it("does not concatenate user input into SQL", async () => {
			const { db, calls } = createFakeDb({ results: [adaRow] });

			await createUser(db, adaInput);

			for (const call of calls) {
				expect(call.sql).not.toContain("alovelace");
				expect(call.sql).not.toContain("ada@school.edu");
				expect(call.sql).not.toMatch(/'\s*\?/);
				expect(call.sql).toMatch(/\?\d/);
			}
		});
	});
});
