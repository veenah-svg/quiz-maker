import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LogoutButton } from "./logout-button";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push }),
}));

describe("LogoutButton", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({ ok: true }),
			}),
		);
	});

	it("POSTs /api/logout then navigates to /login", async () => {
		const user = userEvent.setup();
		render(<LogoutButton />);

		await user.click(screen.getByRole("button", { name: /log out/i }));

		expect(fetch).toHaveBeenCalledWith(
			"/api/logout",
			expect.objectContaining({ method: "POST", credentials: "include" }),
		);
		expect(push).toHaveBeenCalledWith("/login");
	});
});
