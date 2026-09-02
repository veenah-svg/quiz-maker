import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteSession } from "@/lib/services/session-service";
import {
	createUser,
	deleteUser,
	getUserByEmail,
	getUserByUsername,
	updateUser,
} from "@/lib/services/user-service";
import { SESSION_COOKIE_NAME } from "@/lib/session-cookie";
import { POST } from "./route";

vi.mock("@opennextjs/cloudflare", () => ({
	getCloudflareContext: vi.fn(async () => ({
		env: { DB: {} },
	})),
}));

vi.mock("@/lib/services/session-service", () => ({
	createSession: vi.fn(),
	getSession: vi.fn(),
	deleteSession: vi.fn(),
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

describe("POST /api/logout", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(deleteSession).mockResolvedValue(undefined);
	});

	it("returns 200 with ok true and expires this browser's cookie", async () => {
		const response = await POST(
			new Request("http://localhost/api/logout", { method: "POST" }),
		);
		const payload = await response.json();

		expect(response.status).toBe(200);
		expect(payload).toEqual({ ok: true });
		expect(response.cookies.get(SESSION_COOKIE_NAME)?.maxAge).toBe(0);
	});

	it("deletes only the session cookie from this browser", async () => {
		await POST(
			new Request("http://localhost/api/logout", {
				method: "POST",
				headers: {
					Cookie: `${SESSION_COOKIE_NAME}=sess-browser-a; theme=dark`,
				},
			}),
		);

		expect(deleteSession).toHaveBeenCalledTimes(1);
		expect(deleteSession).toHaveBeenCalledWith({}, "sess-browser-a");
	});

	it("does not delete a session when this browser has no cookie", async () => {
		await POST(new Request("http://localhost/api/logout", { method: "POST" }));

		expect(deleteSession).not.toHaveBeenCalled();
	});

	it("does not call the user service", async () => {
		await POST(
			new Request("http://localhost/api/logout", {
				method: "POST",
				headers: { Cookie: `${SESSION_COOKIE_NAME}=sess-browser-a` },
			}),
		);

		expect(createUser).not.toHaveBeenCalled();
		expect(getUserByUsername).not.toHaveBeenCalled();
		expect(getUserByEmail).not.toHaveBeenCalled();
		expect(updateUser).not.toHaveBeenCalled();
		expect(deleteUser).not.toHaveBeenCalled();
	});
});
