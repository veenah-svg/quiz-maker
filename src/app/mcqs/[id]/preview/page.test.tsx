import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PreviewQuestionPage from "./page";

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/app/mcqs/actions", () => ({
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
	checkQuestionAttemptAction: vi.fn(),
}));

describe("Preview question page", () => {
	it("renders the preview heading and attempt form", async () => {
		render(await PreviewQuestionPage({ params: Promise.resolve({ id: "q1" }) }));

		expect(
			screen.getByRole("heading", { name: /preview question/i }),
		).toBeInTheDocument();
		expect(
			await screen.findByText("What is the capital of France?"),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /check answer/i }),
		).toBeInTheDocument();
		expect(screen.getByRole("link", { name: /back/i })).toHaveAttribute(
			"href",
			"/mcqs",
		);
	});
});
