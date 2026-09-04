import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { McqAttempt } from "./mcq-attempt";

const { push, getQuestionAction, checkQuestionAttemptAction } = vi.hoisted(
	() => ({
		push: vi.fn(),
		getQuestionAction: vi.fn(),
		checkQuestionAttemptAction: vi.fn(),
	}),
);

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push }),
}));

vi.mock("@/app/mcqs/actions", () => ({
	getQuestionAction,
	checkQuestionAttemptAction,
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

describe("McqAttempt", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getQuestionAction.mockResolvedValue({ ok: true, data: question });
		checkQuestionAttemptAction.mockResolvedValue({
			ok: true,
			data: { questionId: "q1", choiceId: "c1", isCorrect: true },
		});
	});

	it("shows a loading state until the question loads", async () => {
		const pending = deferred<{ ok: true; data: typeof question }>();
		getQuestionAction.mockReturnValue(pending.promise);

		render(<McqAttempt questionId="q1" />);

		expect(screen.getByText(/loading question/i)).toBeInTheDocument();

		pending.resolve({ ok: true, data: question });

		expect(await screen.findByText(question.stem)).toBeInTheDocument();
	});

	it("shows the stem and choices without revealing the correct answer", async () => {
		render(<McqAttempt questionId="q1" />);

		expect(await screen.findByText(question.stem)).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "Paris" })).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "London" })).toBeInTheDocument();
		expect(screen.queryByText(/^correct$/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/incorrect/i)).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: /back/i })).toHaveAttribute(
			"href",
			"/mcqs",
		);
	});

	it("does not check an answer until a choice is selected", async () => {
		const user = userEvent.setup();
		render(<McqAttempt questionId="q1" />);

		await screen.findByText(question.stem);
		await user.click(screen.getByRole("button", { name: /check answer/i }));

		expect(checkQuestionAttemptAction).not.toHaveBeenCalled();
		expect(screen.getByText(/choose an answer/i)).toBeInTheDocument();
	});

	it("records the attempt on the server and shows its feedback, ignoring loaded isCorrect", async () => {
		const user = userEvent.setup();
		checkQuestionAttemptAction.mockResolvedValue({
			ok: true,
			data: { questionId: "q1", choiceId: "c1", isCorrect: false },
		});
		render(<McqAttempt questionId="q1" />);

		await user.click(await screen.findByRole("radio", { name: "Paris" }));
		await user.click(screen.getByRole("button", { name: /check answer/i }));

		await waitFor(() => {
			expect(checkQuestionAttemptAction).toHaveBeenCalledWith({
				questionId: "q1",
				choiceId: "c1",
			});
		});
		expect(checkQuestionAttemptAction.mock.calls[0][0]).not.toHaveProperty(
			"isCorrect",
		);
		expect(await screen.findByText(/incorrect/i)).toBeInTheDocument();
		expect(screen.queryByText(/^correct$/i)).not.toBeInTheDocument();
	});

	it("shows correct feedback from the server result", async () => {
		const user = userEvent.setup();
		render(<McqAttempt questionId="q1" />);

		await user.click(await screen.findByRole("radio", { name: "Paris" }));
		await user.click(screen.getByRole("button", { name: /check answer/i }));

		expect(await screen.findByText(/^correct$/i)).toBeInTheDocument();
	});

	it("lets the teacher try again after feedback", async () => {
		const user = userEvent.setup();
		render(<McqAttempt questionId="q1" />);

		await user.click(await screen.findByRole("radio", { name: "Paris" }));
		await user.click(screen.getByRole("button", { name: /check answer/i }));
		expect(await screen.findByText(/^correct$/i)).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: /try again/i }));

		expect(screen.queryByText(/^correct$/i)).not.toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "Paris" })).not.toBeChecked();
		expect(
			screen.getByRole("button", { name: /check answer/i }),
		).toBeInTheDocument();

		checkQuestionAttemptAction.mockClear();
		checkQuestionAttemptAction.mockResolvedValue({
			ok: true,
			data: { questionId: "q1", choiceId: "c2", isCorrect: false },
		});
		await user.click(screen.getByRole("radio", { name: "London" }));
		await user.click(screen.getByRole("button", { name: /check answer/i }));

		await waitFor(() => {
			expect(checkQuestionAttemptAction).toHaveBeenCalledWith({
				questionId: "q1",
				choiceId: "c2",
			});
		});
		expect(await screen.findByText(/incorrect/i)).toBeInTheDocument();
	});

	it("shows a server error and stays on the question", async () => {
		const user = userEvent.setup();
		checkQuestionAttemptAction.mockResolvedValue({
			ok: false,
			code: "server",
			error: "Something went wrong",
		});
		render(<McqAttempt questionId="q1" />);

		await user.click(await screen.findByRole("radio", { name: "Paris" }));
		await user.click(screen.getByRole("button", { name: /check answer/i }));

		expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
		expect(push).not.toHaveBeenCalled();
		expect(screen.getByText(question.stem)).toBeInTheDocument();
	});

	it("shows an error when the question cannot be loaded", async () => {
		getQuestionAction.mockResolvedValue({
			ok: false,
			code: "not_found",
			error: "Question not found",
		});

		render(<McqAttempt questionId="q1" />);

		expect(await screen.findByText("Question not found")).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /check answer/i }),
		).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: /back/i })).toHaveAttribute(
			"href",
			"/mcqs",
		);
	});

	it("redirects to login when loading is unauthorized", async () => {
		getQuestionAction.mockResolvedValue({
			ok: false,
			code: "unauthorized",
			error: "You must be signed in to access questions",
		});

		render(<McqAttempt questionId="q1" />);

		await waitFor(() => {
			expect(push).toHaveBeenCalledWith("/login");
		});
	});

	it("redirects to login when checking an answer is unauthorized", async () => {
		const user = userEvent.setup();
		checkQuestionAttemptAction.mockResolvedValue({
			ok: false,
			code: "unauthorized",
			error: "You must be signed in to access questions",
		});
		render(<McqAttempt questionId="q1" />);

		await user.click(await screen.findByRole("radio", { name: "Paris" }));
		await user.click(screen.getByRole("button", { name: /check answer/i }));

		await waitFor(() => {
			expect(push).toHaveBeenCalledWith("/login");
		});
	});
});
