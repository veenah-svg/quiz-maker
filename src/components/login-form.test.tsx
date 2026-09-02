import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@/lib/password";
import { LoginForm } from "./login-form";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push }),
}));

const PASSWORD = "quiz-maker-secret";

describe("LoginForm", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({ id: "user-1" }),
			}),
		);
	});

	it("uses a username field instead of the stock email login", () => {
		render(<LoginForm />);

		expect(screen.getByLabelText(/^username$/i)).toBeInTheDocument();
		expect(screen.queryByLabelText(/^email$/i)).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /google/i })).not.toBeInTheDocument();
		expect(screen.queryByRole("link", { name: /forgot/i })).not.toBeInTheDocument();
	});

	it("POSTs username and passwordHash without plaintext password", async () => {
		const user = userEvent.setup();
		render(<LoginForm />);

		await user.type(screen.getByLabelText(/^username$/i), "alovelace");
		await user.type(screen.getByLabelText(/^password$/i), PASSWORD);
		await user.click(screen.getByRole("button", { name: /^login$/i }));

		expect(fetch).toHaveBeenCalledWith(
			"/api/login",
			expect.objectContaining({
				method: "POST",
				headers: { "Content-Type": "application/json" },
			}),
		);

		const body = JSON.parse(
			String(vi.mocked(fetch).mock.calls[0]?.[1]?.body),
		) as Record<string, string>;

		expect(body).toEqual({
			username: "alovelace",
			passwordHash: await hashPassword(PASSWORD),
		});
		expect(body).not.toHaveProperty("password");
	});

	it("navigates to /mcqs after a 200 response", async () => {
		const user = userEvent.setup();
		render(<LoginForm />);

		await user.type(screen.getByLabelText(/^username$/i), "alovelace");
		await user.type(screen.getByLabelText(/^password$/i), PASSWORD);
		await user.click(screen.getByRole("button", { name: /^login$/i }));

		expect(push).toHaveBeenCalledWith("/mcqs");
	});

	it("shows Invalid username or password and does not navigate on 401", async () => {
		vi.mocked(fetch).mockResolvedValue({
			ok: false,
			status: 401,
			json: async () => ({ error: "Invalid username or password" }),
		} as Response);

		const user = userEvent.setup();
		render(<LoginForm />);

		await user.type(screen.getByLabelText(/^username$/i), "alovelace");
		await user.type(screen.getByLabelText(/^password$/i), PASSWORD);
		await user.click(screen.getByRole("button", { name: /^login$/i }));

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Invalid username or password",
		);
		expect(push).not.toHaveBeenCalled();
	});
});
