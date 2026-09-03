import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NewQuestionPage from "./page";

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/app/mcqs/actions", () => ({
	createQuestionAction: vi.fn(),
	updateQuestionAction: vi.fn(),
	getQuestionAction: vi.fn(),
}));

describe("Create question page", () => {
	it("renders the create heading and form", () => {
		render(<NewQuestionPage />);

		expect(
			screen.getByRole("heading", { name: /create question/i }),
		).toBeInTheDocument();
		expect(screen.getByRole("textbox", { name: /^question$/i })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /save question/i })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: /cancel/i })).toHaveAttribute(
			"href",
			"/mcqs",
		);
	});
});
