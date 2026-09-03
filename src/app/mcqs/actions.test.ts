import { beforeEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";
import {
	McqForbiddenError,
	checkQuestionAttempt,
	createQuestion,
	deleteQuestion,
	getQuestion,
	listQuestions,
	updateQuestion,
} from "@/lib/services/mcq-service";
import { getSession } from "@/lib/services/session-service";
import {
	McqUnauthorizedError,
	checkQuestionAttemptAction,
	createQuestionAction,
	deleteQuestionAction,
	getQuestionAction,
	listQuestionsAction,
	updateQuestionAction,
} from "./actions";

const mockDb = {} as D1Database;

vi.mock("@opennextjs/cloudflare", () => ({
	getCloudflareContext: vi.fn(async () => ({
		env: { DB: mockDb },
	})),
}));

vi.mock("next/headers", () => ({
	cookies: vi.fn(),
}));

vi.mock("@/lib/services/session-service", () => ({
	getSession: vi.fn(),
}));

vi.mock("@/lib/services/mcq-service", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/lib/services/mcq-service")>();
	return {
		...actual,
		createQuestion: vi.fn(),
		getQuestion: vi.fn(),
		listQuestions: vi.fn(),
		updateQuestion: vi.fn(),
		deleteQuestion: vi.fn(),
		checkQuestionAttempt: vi.fn(),
	};
});

const validInput = {
	stem: "What is the capital of France?",
	choices: [
		{ label: "Paris", isCorrect: true },
		{ label: "London", isCorrect: false },
	],
};

const question = {
	id: "q1",
	stem: validInput.stem,
	ownerId: "teacher-1",
	createdAt: "2026-09-03T12:00:00.000Z",
	updatedAt: "2026-09-03T12:00:00.000Z",
	choices: [
		{ id: "c1", label: "Paris", isCorrect: true, position: 0 },
		{ id: "c2", label: "London", isCorrect: false, position: 1 },
	],
};

function signedIn(userId = "teacher-1") {
	vi.mocked(cookies).mockResolvedValue({
		get: () => ({ value: "sess-browser-a" }),
	} as Awaited<ReturnType<typeof cookies>>);
	vi.mocked(getSession).mockResolvedValue({
		id: "sess-browser-a",
		userId,
		expiresAt: "2099-01-01T00:00:00.000Z",
	});
}

describe("MCQ server actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(cookies).mockResolvedValue({
			get: () => undefined,
		} as Awaited<ReturnType<typeof cookies>>);
		vi.mocked(getSession).mockResolvedValue(null);
	});

	it("rejects mutations and reads when this browser has no session", async () => {
		await expect(listQuestionsAction()).rejects.toBeInstanceOf(
			McqUnauthorizedError,
		);
		await expect(getQuestionAction("q1")).rejects.toBeInstanceOf(
			McqUnauthorizedError,
		);
		await expect(createQuestionAction(validInput)).rejects.toBeInstanceOf(
			McqUnauthorizedError,
		);
		await expect(updateQuestionAction("q1", validInput)).rejects.toBeInstanceOf(
			McqUnauthorizedError,
		);
		await expect(deleteQuestionAction("q1")).rejects.toBeInstanceOf(
			McqUnauthorizedError,
		);
		await expect(
			checkQuestionAttemptAction({ questionId: "q1", choiceId: "c1" }),
		).rejects.toBeInstanceOf(McqUnauthorizedError);

		expect(listQuestions).not.toHaveBeenCalled();
		expect(createQuestion).not.toHaveBeenCalled();
		expect(checkQuestionAttempt).not.toHaveBeenCalled();
	});

	it("creates a question with the session user as owner, not a body ownerId", async () => {
		signedIn("teacher-1");
		vi.mocked(createQuestion).mockResolvedValue(question);

		const created = await createQuestionAction({
			...validInput,
			ownerId: "attacker",
		});

		expect(created).toEqual(question);
		expect(createQuestion).toHaveBeenCalledWith(mockDb, "teacher-1", {
			...validInput,
			ownerId: "attacker",
		});
		expect(createQuestion).not.toHaveBeenCalledWith(
			mockDb,
			"attacker",
			expect.anything(),
		);
	});

	it("lists and gets questions through the service after a valid session", async () => {
		signedIn();
		vi.mocked(listQuestions).mockResolvedValue([question]);
		vi.mocked(getQuestion).mockResolvedValue(question);

		await expect(listQuestionsAction()).resolves.toEqual([question]);
		await expect(getQuestionAction("q1")).resolves.toEqual(question);

		expect(listQuestions).toHaveBeenCalledWith(mockDb);
		expect(getQuestion).toHaveBeenCalledWith(mockDb, "q1");
		expect(getSession).toHaveBeenCalledWith(mockDb, "sess-browser-a");
	});

	it("updates and deletes with the session owner id", async () => {
		signedIn("teacher-1");
		vi.mocked(updateQuestion).mockResolvedValue({
			...question,
			stem: "Updated stem?",
		});
		vi.mocked(deleteQuestion).mockResolvedValue(undefined);

		await updateQuestionAction("q1", validInput);
		await deleteQuestionAction("q1");

		expect(updateQuestion).toHaveBeenCalledWith(
			mockDb,
			"q1",
			"teacher-1",
			validInput,
		);
		expect(deleteQuestion).toHaveBeenCalledWith(mockDb, "q1", "teacher-1");
	});

	it("propagates ownership errors from the service", async () => {
		signedIn("teacher-2");
		vi.mocked(updateQuestion).mockRejectedValue(new McqForbiddenError());

		await expect(updateQuestionAction("q1", validInput)).rejects.toBeInstanceOf(
			McqForbiddenError,
		);
	});

	it("grades an attempt on the server via the service", async () => {
		signedIn();
		vi.mocked(checkQuestionAttempt).mockResolvedValue({
			questionId: "q1",
			choiceId: "c1",
			isCorrect: true,
		});

		const result = await checkQuestionAttemptAction({
			questionId: "q1",
			choiceId: "c1",
			isCorrect: false,
		});

		expect(result).toEqual({
			questionId: "q1",
			choiceId: "c1",
			isCorrect: true,
		});
		expect(checkQuestionAttempt).toHaveBeenCalledWith(mockDb, {
			questionId: "q1",
			choiceId: "c1",
			isCorrect: false,
		});
	});
});
