import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EditQuestionPage from "./page";

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/app/mcqs/actions", () => ({
	createQuestionAction: vi.fn(),
	updateQuestionAction: vi.fn(),
	getQuestionAction: vi.fn(async () => ({
		ok: true,
		data: {
			id: "q1",
			stem: "What is the capital of France?",
			ownerId: "teacher-1",
			createdAt: "2026-09-03T12:00:00.000Z",
			updatedAt: "2026-09-03T12:00:00.000Z",
			choices: [
				{ id: "c1", label: "Paris", isCorrect: true, position: 0 },
				{ id: "c2", label: "London", isCorrect: false, position: 1 },
			],
		},
	})),
}));

describe("Edit question page", () => {
	it("renders the edit heading and loads the form", async () => {
		render(await EditQuestionPage({ params: Promise.resolve({ id: "q1" }) }));

		expect(
			screen.getByRole("heading", { name: /edit question/i }),
		).toBeInTheDocument();
		expect(
			await screen.findByRole("textbox", { name: /^question$/i }),
		).toHaveValue("What is the capital of France?");
	});
});
