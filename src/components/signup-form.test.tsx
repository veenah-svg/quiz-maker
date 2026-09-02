import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@/lib/password";
import { SignupForm } from "./signup-form";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push }),
}));

const PASSWORD = "quiz-maker-secret";

async function fillSignup(
	user: ReturnType<typeof userEvent.setup>,
	overrides?: Partial<{
		firstName: string;
		lastName: string;
		username: string;
		email: string;
		password: string;
		confirmPassword: string;
	}>,
) {
	const values = {
		firstName: "Ada",
		lastName: "Lovelace",
		username: "alovelace",
		email: "ada@school.edu",
		password: PASSWORD,
		confirmPassword: PASSWORD,
		...overrides,
	};

	await user.type(screen.getByLabelText(/first name/i), values.firstName);
	await user.type(screen.getByLabelText(/last name/i), values.lastName);
	await user.type(screen.getByLabelText(/^username$/i), values.username);
	await user.type(screen.getByLabelText(/^email$/i), values.email);
	await user.type(screen.getByLabelText(/^password$/i), values.password);
	await user.type(screen.getByLabelText(/confirm password/i), values.confirmPassword);
}

describe("SignupForm", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 201,
				json: async () => ({ id: "user-1" }),
			}),
		);
	});

	it("renders first name, last name, username, email, password, and confirm password", () => {
		render(<SignupForm />);

		expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
		expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();
		expect(screen.getByLabelText(/^username$/i)).toBeInTheDocument();
		expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
		expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
		expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
	});

	it("does not render Google signup", () => {
		render(<SignupForm />);
		expect(screen.queryByRole("button", { name: /google/i })).not.toBeInTheDocument();
	});

	it("does not submit when the password is shorter than 8 characters", async () => {
		const user = userEvent.setup();
		render(<SignupForm />);

		await fillSignup(user, { password: "short", confirmPassword: "short" });
		await user.click(screen.getByRole("button", { name: /create account/i }));

		expect(fetch).not.toHaveBeenCalled();
		expect(push).not.toHaveBeenCalled();
	});

	it("does not submit when the passwords do not match", async () => {
		const user = userEvent.setup();
		render(<SignupForm />);

		await fillSignup(user, { confirmPassword: "different-secret" });
		await user.click(screen.getByRole("button", { name: /create account/i }));

		expect(fetch).not.toHaveBeenCalled();
		expect(push).not.toHaveBeenCalled();
	});

	it("POSTs a passwordHash and never sends plaintext passwords", async () => {
		const user = userEvent.setup();
		render(<SignupForm />);

		await fillSignup(user);
		await user.click(screen.getByRole("button", { name: /create account/i }));

		expect(fetch).toHaveBeenCalledWith(
			"/api/register",
			expect.objectContaining({
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
			}),
		);

		const body = JSON.parse(
			String(vi.mocked(fetch).mock.calls[0]?.[1]?.body),
		) as Record<string, string>;

		expect(body.passwordHash).toBe(await hashPassword(PASSWORD));
		expect(body).not.toHaveProperty("password");
		expect(body).not.toHaveProperty("confirmPassword");
		expect(body.firstName).toBe("Ada");
		expect(body.lastName).toBe("Lovelace");
		expect(body.username).toBe("alovelace");
		expect(body.email).toBe("ada@school.edu");
	});

	it("allows username to equal email", async () => {
		const user = userEvent.setup();
		const email = "teacher@school.edu";
		render(<SignupForm />);

		await fillSignup(user, { username: email, email });
		await user.click(screen.getByRole("button", { name: /create account/i }));

		const body = JSON.parse(
			String(vi.mocked(fetch).mock.calls[0]?.[1]?.body),
		) as Record<string, string>;

		expect(body.username).toBe(email);
		expect(body.email).toBe(email);
	});

	it("navigates to /mcqs after a 201 response", async () => {
		const user = userEvent.setup();
		render(<SignupForm />);

		await fillSignup(user);
		await user.click(screen.getByRole("button", { name: /create account/i }));

		expect(push).toHaveBeenCalledWith("/mcqs");
	});

	it("shows a server error and does not navigate on 409", async () => {
		vi.mocked(fetch).mockResolvedValue({
			ok: false,
			status: 409,
			json: async () => ({ error: "username already taken" }),
		} as Response);

		const user = userEvent.setup();
		render(<SignupForm />);

		await fillSignup(user);
		await user.click(screen.getByRole("button", { name: /create account/i }));

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"username already taken",
		);
		expect(push).not.toHaveBeenCalled();
	});
});
