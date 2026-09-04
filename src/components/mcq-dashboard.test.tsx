import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { McqDashboard } from "./mcq-dashboard";

const { push, listQuestionsAction, deleteQuestionAction } = vi.hoisted(() => ({
	push: vi.fn(),
	listQuestionsAction: vi.fn(),
	deleteQuestionAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push }),
}));

vi.mock("@/app/mcqs/actions", () => ({
	listQuestionsAction,
	deleteQuestionAction,
}));

const question = {
	id: "q1",
	stem: "What is the capital of France?",
	ownerId: "teacher-1",
	createdAt: "2026-09-03T12:00:00.000Z",
	updatedAt: "2026-09-03T12:00:00.000Z",
	choices: [
		{ id: "c1", label: "Paris", isCorrect: true, position: 0 },
		{ id: "c2", label: "London", isCorrect: false, position: 1 },
	],
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

describe("McqDashboard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		listQuestionsAction.mockResolvedValue({ ok: true, data: [] });
		deleteQuestionAction.mockResolvedValue({ ok: true, data: { deleted: true } });
	});

	it("shows a loading state until the question list returns", async () => {
		const pending = deferred<{ ok: true; data: typeof question[] }>();
		listQuestionsAction.mockReturnValue(pending.promise);

		render(<McqDashboard />);

		expect(screen.getByText(/loading questions/i)).toBeInTheDocument();

		pending.resolve({ ok: true, data: [] });

		expect(await screen.findByText(/no questions yet/i)).toBeInTheDocument();
	});

	it("shows an empty state and a create-question link", async () => {
		render(<McqDashboard />);

		expect(await screen.findByText(/no questions yet/i)).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: /create question/i }),
		).toHaveAttribute("href", "/mcqs/new");
		expect(screen.queryByRole("table")).not.toBeInTheDocument();
	});

	it("shows an error when listing fails", async () => {
		listQuestionsAction.mockResolvedValue({
			ok: false,
			code: "server",
			error: "Something went wrong",
		});

		render(<McqDashboard />);

		expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
		expect(screen.queryByRole("table")).not.toBeInTheDocument();
	});

	it("redirects to login when the list action is unauthorized", async () => {
		listQuestionsAction.mockResolvedValue({
			ok: false,
			code: "unauthorized",
			error: "You must be signed in to access questions",
		});

		render(<McqDashboard />);

		await waitFor(() => {
			expect(push).toHaveBeenCalledWith("/login");
		});
	});

	it("renders a table with edit, preview, and delete actions", async () => {
		listQuestionsAction.mockResolvedValue({ ok: true, data: [question] });

		render(<McqDashboard />);

		expect(
			await screen.findByRole("cell", { name: question.stem }),
		).toBeInTheDocument();
		expect(screen.getByRole("columnheader", { name: /question/i })).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: `Edit: ${question.stem}` }),
		).toHaveAttribute("href", "/mcqs/q1/edit");
		expect(
			screen.getByRole("link", { name: `Preview: ${question.stem}` }),
		).toHaveAttribute("href", "/mcqs/q1/preview");
		expect(
			screen.getByRole("button", { name: `Delete: ${question.stem}` }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: /create question/i }),
		).toHaveAttribute("href", "/mcqs/new");
	});

	it("links preview to the attempt page without calling delete", async () => {
		listQuestionsAction.mockResolvedValue({ ok: true, data: [question] });

		render(<McqDashboard />);

		expect(
			await screen.findByRole("link", { name: `Preview: ${question.stem}` }),
		).toHaveAttribute("href", "/mcqs/q1/preview");
		expect(deleteQuestionAction).not.toHaveBeenCalled();
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("asks for confirmation before deleting and can be cancelled", async () => {
		const user = userEvent.setup();
		listQuestionsAction.mockResolvedValue({ ok: true, data: [question] });

		render(<McqDashboard />);
		await user.click(
			await screen.findByRole("button", { name: `Delete: ${question.stem}` }),
		);

		expect(
			await screen.findByRole("heading", { name: /delete question/i }),
		).toBeInTheDocument();
		expect(
			within(screen.getByRole("dialog")).getByText(question.stem, {
				exact: false,
			}),
		).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: /cancel/i }));

		expect(deleteQuestionAction).not.toHaveBeenCalled();
		expect(screen.getByText(question.stem)).toBeInTheDocument();
	});

	it("deletes a question after confirmation and removes the row", async () => {
		const user = userEvent.setup();
		listQuestionsAction.mockResolvedValue({ ok: true, data: [question] });

		render(<McqDashboard />);
		await user.click(
			await screen.findByRole("button", { name: `Delete: ${question.stem}` }),
		);
		await user.click(
			await screen.findByRole("button", { name: /confirm delete/i }),
		);

		await waitFor(() => {
			expect(deleteQuestionAction).toHaveBeenCalledWith("q1");
		});
		await waitFor(() => {
			expect(screen.queryByText(question.stem)).not.toBeInTheDocument();
		});
	});

	it("keeps the row and shows an error when delete is forbidden", async () => {
		const user = userEvent.setup();
		listQuestionsAction.mockResolvedValue({ ok: true, data: [question] });
		deleteQuestionAction.mockResolvedValue({
			ok: false,
			code: "forbidden",
			error: "You do not own this question",
		});

		render(<McqDashboard />);
		await user.click(
			await screen.findByRole("button", { name: `Delete: ${question.stem}` }),
		);
		await user.click(
			await screen.findByRole("button", { name: /confirm delete/i }),
		);

		expect(
			await screen.findByText("You do not own this question"),
		).toBeInTheDocument();
		expect(screen.getByText(question.stem)).toBeInTheDocument();
	});
});
