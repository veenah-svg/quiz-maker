import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createUser,
	deleteUser,
	getUserByEmail,
	getUserByUsername,
	updateUser,
} from "@/lib/services/user-service";
import { POST } from "./route";

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

describe("POST /api/logout", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 200 with ok true", async () => {
		const response = await POST(
			new Request("http://localhost/api/logout", { method: "POST" }),
		);
		const payload = await response.json();

		expect(response.status).toBe(200);
		expect(payload).toEqual({ ok: true });
	});

	it("does not call the user service", async () => {
		await POST(new Request("http://localhost/api/logout", { method: "POST" }));

		expect(createUser).not.toHaveBeenCalled();
		expect(getUserByUsername).not.toHaveBeenCalled();
		expect(getUserByEmail).not.toHaveBeenCalled();
		expect(updateUser).not.toHaveBeenCalled();
		expect(deleteUser).not.toHaveBeenCalled();
	});
});
