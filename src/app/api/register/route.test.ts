import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserConflictError, createUser } from "@/lib/services/user-service";
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

const validBody = {
	firstName: "Ada",
	lastName: "Lovelace",
	username: "alovelace",
	email: "ada@school.edu",
	passwordHash,
};

const publicUser = {
	id: "user-1",
	firstName: "Ada",
	lastName: "Lovelace",
	username: "alovelace",
	email: "ada@school.edu",
};

function post(body: unknown) {
	return POST(
		new Request("http://localhost/api/register", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
}

describe("POST /api/register", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(createUser).mockResolvedValue(publicUser);
	});

	it("creates a user and returns 201 without passwordHash", async () => {
		const response = await post(validBody);
		const payload = await response.json();

		expect(response.status).toBe(201);
		expect(payload).toEqual(publicUser);
		expect(payload).not.toHaveProperty("passwordHash");
		expect(createUser).toHaveBeenCalledWith(
			{},
			expect.objectContaining({
				firstName: "Ada",
				lastName: "Lovelace",
				username: "alovelace",
				email: "ada@school.edu",
				passwordHash,
			}),
		);
		expect(createUser).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ password: expect.anything() }),
		);
	});

	it("accepts username equal to email", async () => {
		const email = "teacher@school.edu";
		vi.mocked(createUser).mockResolvedValue({
			...publicUser,
			username: email,
			email,
		});

		const response = await post({ ...validBody, username: email, email });

		expect(response.status).toBe(201);
		expect(createUser).toHaveBeenCalledWith(
			{},
			expect.objectContaining({ username: email, email }),
		);
	});

	it("returns 400 when required fields are missing", async () => {
		const response = await post({ username: "alovelace" });
		const payload = await response.json();

		expect(response.status).toBe(400);
		expect(payload).toEqual({ error: expect.any(String) });
		expect(createUser).not.toHaveBeenCalled();
	});

	it("returns 400 when passwordHash is not 64 hex characters", async () => {
		const response = await post({ ...validBody, passwordHash: "not-a-hash" });
		const payload = await response.json();

		expect(response.status).toBe(400);
		expect(payload).toHaveProperty("error");
		expect(createUser).not.toHaveBeenCalled();
	});

	it("returns 409 when the username or email is already taken", async () => {
		vi.mocked(createUser).mockRejectedValue(new UserConflictError("username"));

		const response = await post(validBody);
		const payload = await response.json();

		expect(response.status).toBe(409);
		expect(payload).toHaveProperty("error");
	});

	it("returns 500 when the service throws unexpectedly", async () => {
		vi.mocked(createUser).mockRejectedValue(new Error("db down"));

		const response = await post(validBody);
		const payload = await response.json();

		expect(response.status).toBe(500);
		expect(payload).toEqual({ error: expect.any(String) });
	});
});
