import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import McqsPage from "./page";

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/app/mcqs/actions", () => ({
	listQuestionsAction: vi.fn(async () => ({ ok: true, data: [] })),
	deleteQuestionAction: vi.fn(),
}));

describe("MCQ dashboard page", () => {
	it("keeps the question-bank heading and logout without a create form", async () => {
		render(<McqsPage />);

		expect(
			screen.getByRole("heading", { name: /question bank/i }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /log out/i })).toBeInTheDocument();
		expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
		expect(
			await screen.findByRole("link", { name: /create question/i }),
		).toHaveAttribute("href", "/mcqs/new");
	});
});
