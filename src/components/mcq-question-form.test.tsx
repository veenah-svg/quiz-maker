import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { McqQuestionForm } from "./mcq-question-form";

const { push, createQuestionAction, updateQuestionAction, getQuestionAction } =
	vi.hoisted(() => ({
		push: vi.fn(),
		createQuestionAction: vi.fn(),
		updateQuestionAction: vi.fn(),
		getQuestionAction: vi.fn(),
	}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push }),
}));

vi.mock("@/app/mcqs/actions", () => ({
	createQuestionAction,
	updateQuestionAction,
	getQuestionAction,
}));

const savedQuestion = {
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

async function fillCreateForm(user: ReturnType<typeof userEvent.setup>) {
	await user.type(screen.getByRole("textbox", { name: /^question$/i }), savedQuestion.stem);
	await user.type(screen.getByRole("textbox", { name: /choice 1/i }), "Paris");
	await user.type(screen.getByRole("textbox", { name: /choice 2/i }), "London");
}

describe("McqQuestionForm create", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createQuestionAction.mockResolvedValue({ ok: true, data: savedQuestion });
	});

	it("renders the question field, two choices, save, and cancel", () => {
		render(<McqQuestionForm mode="create" />);

		expect(screen.getByRole("textbox", { name: /^question$/i })).toBeInTheDocument();
		expect(screen.getByText(/the prompt teachers will see/i)).toBeInTheDocument();
		expect(screen.getByRole("textbox", { name: /choice 1/i })).toBeInTheDocument();
		expect(screen.getByRole("textbox", { name: /choice 2/i })).toBeInTheDocument();
		expect(screen.getAllByRole("radio")).toHaveLength(2);
		expect(screen.getByRole("button", { name: /save question/i })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: /cancel/i })).toHaveAttribute(
			"href",
			"/mcqs",
		);
	});

	it("does not call the action when the question is empty", async () => {
		const user = userEvent.setup();
		render(<McqQuestionForm mode="create" />);

		await user.type(screen.getByRole("textbox", { name: /choice 1/i }), "Paris");
		await user.type(screen.getByRole("textbox", { name: /choice 2/i }), "London");
		await user.click(screen.getByRole("button", { name: /save question/i }));

		expect(createQuestionAction).not.toHaveBeenCalled();
		expect(
			screen.getByText(/question is required/i),
		).toBeInTheDocument();
	});

	it("lets the teacher add up to six choices and remove down to two", async () => {
		const user = userEvent.setup();
		render(<McqQuestionForm mode="create" />);

		expect(screen.getByRole("button", { name: /remove choice 1/i })).toBeDisabled();

		await user.click(screen.getByRole("button", { name: /add choice/i }));
		expect(screen.getByRole("textbox", { name: /choice 3/i })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /remove choice 3/i })).toBeEnabled();

		await user.click(screen.getByRole("button", { name: /remove choice 3/i }));
		expect(screen.queryByRole("textbox", { name: /choice 3/i })).not.toBeInTheDocument();

		for (let index = 0; index < 4; index += 1) {
			await user.click(screen.getByRole("button", { name: /add choice/i }));
		}

		expect(screen.getByRole("textbox", { name: /choice 6/i })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /add choice/i })).toBeDisabled();
	});

	it("saves through the create action and returns to the bank", async () => {
		const user = userEvent.setup();
		render(<McqQuestionForm mode="create" />);

		await fillCreateForm(user);
		await user.click(screen.getByRole("radio", { name: /mark choice 2 as correct/i }));
		await user.click(screen.getByRole("button", { name: /save question/i }));

		await waitFor(() => {
			expect(createQuestionAction).toHaveBeenCalledWith({
				stem: savedQuestion.stem,
				choices: [
					{ label: "Paris", isCorrect: false },
					{ label: "London", isCorrect: true },
				],
			});
		});
		expect(push).toHaveBeenCalledWith("/mcqs");
	});

	it("does not save when cancel is used", async () => {
		render(<McqQuestionForm mode="create" />);

		expect(screen.getByRole("link", { name: /cancel/i })).toHaveAttribute(
			"href",
			"/mcqs",
		);
		expect(createQuestionAction).not.toHaveBeenCalled();
	});

	it("shows a server error and stays on the form", async () => {
		const user = userEvent.setup();
		createQuestionAction.mockResolvedValue({
			ok: false,
			code: "server",
			error: "Something went wrong",
		});
		render(<McqQuestionForm mode="create" />);

		await fillCreateForm(user);
		await user.click(screen.getByRole("button", { name: /save question/i }));

		expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
		expect(push).not.toHaveBeenCalled();
	});

	it("redirects to login when saving is unauthorized", async () => {
		const user = userEvent.setup();
		createQuestionAction.mockResolvedValue({
			ok: false,
			code: "unauthorized",
			error: "You must be signed in to access questions",
		});
		render(<McqQuestionForm mode="create" />);

		await fillCreateForm(user);
		await user.click(screen.getByRole("button", { name: /save question/i }));

		await waitFor(() => {
			expect(push).toHaveBeenCalledWith("/login");
		});
	});
});

describe("McqQuestionForm edit", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getQuestionAction.mockResolvedValue({ ok: true, data: savedQuestion });
		updateQuestionAction.mockResolvedValue({ ok: true, data: savedQuestion });
	});

	it("shows a loading state until the question loads", async () => {
		const pending = deferred<{ ok: true; data: typeof savedQuestion }>();
		getQuestionAction.mockReturnValue(pending.promise);

		render(<McqQuestionForm mode="edit" questionId="q1" />);

		expect(screen.getByText(/loading question/i)).toBeInTheDocument();

		pending.resolve({ ok: true, data: savedQuestion });

		expect(await screen.findByRole("textbox", { name: /^question$/i })).toHaveValue(
			savedQuestion.stem,
		);
	});

	it("prefills the form and saves through the update action", async () => {
		const user = userEvent.setup();
		render(<McqQuestionForm mode="edit" questionId="q1" />);

		const questionField = await screen.findByRole("textbox", { name: /^question$/i });
		expect(questionField).toHaveValue(savedQuestion.stem);
		expect(screen.getByRole("textbox", { name: /choice 1/i })).toHaveValue("Paris");
		expect(screen.getByRole("textbox", { name: /choice 2/i })).toHaveValue("London");

		await user.clear(questionField);
		await user.type(questionField, "Updated stem?");
		await user.click(screen.getByRole("button", { name: /save question/i }));

		await waitFor(() => {
			expect(updateQuestionAction).toHaveBeenCalledWith("q1", {
				stem: "Updated stem?",
				choices: [
					{ label: "Paris", isCorrect: true },
					{ label: "London", isCorrect: false },
				],
			});
		});
		expect(createQuestionAction).not.toHaveBeenCalled();
		expect(push).toHaveBeenCalledWith("/mcqs");
	});

	it("shows an error when the question cannot be loaded", async () => {
		getQuestionAction.mockResolvedValue({
			ok: false,
			code: "forbidden",
			error: "You do not own this question",
		});

		render(<McqQuestionForm mode="edit" questionId="q1" />);

		expect(
			await screen.findByText("You do not own this question"),
		).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /save question/i })).not.toBeInTheDocument();
	});

	it("redirects to login when loading the question is unauthorized", async () => {
		getQuestionAction.mockResolvedValue({
			ok: false,
			code: "unauthorized",
			error: "You must be signed in to access questions",
		});

		render(<McqQuestionForm mode="edit" questionId="q1" />);

		await waitFor(() => {
			expect(push).toHaveBeenCalledWith("/login");
		});
	});
});
