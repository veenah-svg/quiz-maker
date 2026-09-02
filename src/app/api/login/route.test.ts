import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUserByUsername } from "@/lib/services/user-service";
import { POST } from "./route";

vi.mock("@opennextjs/cloudflare", () => ({
	getCloudflareContext: vi.fn(async () => ({
		env: { DB: {} },
	})),
}));

vi.mock("@/lib/services/user-service", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/services/user-service")>();
	return {
		...actual,
		createUser: vi.fn(),
		getUserByUsername: vi.fn(),
		getUserByEmail: vi.fn(),
		updateUser: vi.fn(),
		deleteUser: vi.fn(),
	};
});

const passwordHash = "ab".repeat(32);

const userRecord = {
	id: "user-1",
	firstName: "Ada",
	lastName: "Lovelace",
	username: "alovelace",
	email: "ada@school.edu",
	passwordHash,
};

function post(body: unknown) {
	return POST(
		new Request("http://localhost/api/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
}

describe("POST /api/login", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getUserByUsername).mockResolvedValue(userRecord);
	});

	it("returns 200 public user without passwordHash when credentials match", async () => {
		const response = await post({ username: "alovelace", passwordHash });
		const payload = await response.json();

		expect(response.status).toBe(200);
		expect(payload).toEqual({
			id: "user-1",
			firstName: "Ada",
			lastName: "Lovelace",
			username: "alovelace",
			email: "ada@school.edu",
		});
		expect(payload).not.toHaveProperty("passwordHash");
	});

	it("returns 401 with a generic message when the username is unknown", async () => {
		vi.mocked(getUserByUsername).mockResolvedValue(null);

		const response = await post({ username: "missing", passwordHash });
		const payload = await response.json();

		expect(response.status).toBe(401);
		expect(payload).toEqual({ error: "Invalid username or password" });
	});

	it("returns 401 with the same message when the hash does not match", async () => {
		const response = await post({
			username: "alovelace",
			passwordHash: "cd".repeat(32),
		});
		const payload = await response.json();

		expect(response.status).toBe(401);
		expect(payload).toEqual({ error: "Invalid username or password" });
	});

	it("returns 400 when the body is invalid", async () => {
		const response = await post({ username: "alovelace" });
		const payload = await response.json();

		expect(response.status).toBe(400);
		expect(payload).toHaveProperty("error");
		expect(getUserByUsername).not.toHaveBeenCalled();
	});

	it("returns 500 when the service throws unexpectedly", async () => {
		vi.mocked(getUserByUsername).mockRejectedValue(new Error("db down"));

		const response = await post({ username: "alovelace", passwordHash });
		const payload = await response.json();

		expect(response.status).toBe(500);
		expect(payload).toEqual({ error: expect.any(String) });
	});
});
