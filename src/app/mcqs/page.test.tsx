import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import McqsPage from "./page";

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn() }),
}));

describe("MCQ stub page", () => {
	it("shows a question-bank heading and no question form", () => {
		render(<McqsPage />);

		expect(
			screen.getByRole("heading", { name: /question bank/i }),
		).toBeInTheDocument();
		expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: /log out/i })).toBeInTheDocument();
	});
});
