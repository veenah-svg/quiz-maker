import { beforeEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/services/session-service";
import McqsLayout from "./layout";

vi.mock("next/headers", () => ({
	cookies: vi.fn(),
}));

vi.mock("next/navigation", () => ({
	redirect: vi.fn(),
}));

vi.mock("@opennextjs/cloudflare", () => ({
	getCloudflareContext: vi.fn(async () => ({
		env: { DB: {} },
	})),
}));

vi.mock("@/lib/services/session-service", () => ({
	getSession: vi.fn(),
}));

describe("MCQ layout session gate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(cookies).mockResolvedValue({
			get: () => undefined,
		} as Awaited<ReturnType<typeof cookies>>);
		vi.mocked(getSession).mockResolvedValue(null);
	});

	it("redirects a new browser with no session to login", async () => {
		await McqsLayout({ children: "secret" });

		expect(redirect).toHaveBeenCalledWith("/login");
	});

	it("renders the question bank when this browser has a valid session", async () => {
		vi.mocked(cookies).mockResolvedValue({
			get: () => ({ value: "sess-browser-a" }),
		} as Awaited<ReturnType<typeof cookies>>);
		vi.mocked(getSession).mockResolvedValue({
			id: "sess-browser-a",
			userId: "user-1",
			expiresAt: "2099-01-01T00:00:00.000Z",
		});

		await expect(McqsLayout({ children: "secret" })).resolves.toBe("secret");
		expect(redirect).not.toHaveBeenCalled();
		expect(getSession).toHaveBeenCalledWith({}, "sess-browser-a");
	});
});
