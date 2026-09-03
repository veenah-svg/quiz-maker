import { beforeEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";
import {
	McqForbiddenError,
	McqNotFoundError,
	checkQuestionAttempt,
	createQuestion,
	deleteQuestion,
	getQuestion,
	listQuestions,
	updateQuestion,
} from "@/lib/services/mcq-service";
import { getSession } from "@/lib/services/session-service";
import {
	checkQuestionAttemptAction,
	createQuestionAction,
	deleteQuestionAction,
	getQuestionAction,
	listQuestionsAction,
	updateQuestionAction,
} from "./actions";

const prepare = vi.fn();
const mockDb = { prepare } as unknown as D1Database;

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

	it("returns unauthorized and does not call the service when this browser has no session", async () => {
		const listed = await listQuestionsAction();
		const created = await createQuestionAction(validInput);

		expect(listed).toEqual({
			ok: false,
			code: "unauthorized",
			error: expect.any(String),
		});
		expect(created).toEqual({
			ok: false,
			code: "unauthorized",
			error: expect.any(String),
		});
		expect(listQuestions).not.toHaveBeenCalled();
		expect(createQuestion).not.toHaveBeenCalled();
		expect(prepare).not.toHaveBeenCalled();
	});

	it("validates create payloads with Zod before calling the service", async () => {
		signedIn();

		const result = await createQuestionAction({
			stem: "",
			choices: [{ label: "Paris", isCorrect: true }],
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("validation");
			expect(result.error).toEqual(expect.any(String));
		}
		expect(createQuestion).not.toHaveBeenCalled();
	});

	it("validates question ids with Zod before get, update, or delete", async () => {
		signedIn();

		await expect(getQuestionAction("   ")).resolves.toMatchObject({
			ok: false,
			code: "validation",
		});
		await expect(updateQuestionAction("", validInput)).resolves.toMatchObject({
			ok: false,
			code: "validation",
		});
		await expect(deleteQuestionAction("")).resolves.toMatchObject({
			ok: false,
			code: "validation",
		});

		expect(getQuestion).not.toHaveBeenCalled();
		expect(updateQuestion).not.toHaveBeenCalled();
		expect(deleteQuestion).not.toHaveBeenCalled();
	});

	it("creates through the service using the session user, not a body ownerId", async () => {
		signedIn("teacher-1");
		vi.mocked(createQuestion).mockResolvedValue(question);

		const result = await createQuestionAction({
			...validInput,
			ownerId: "attacker",
		});

		expect(result).toEqual({ ok: true, data: question });
		expect(createQuestion).toHaveBeenCalledWith(
			mockDb,
			"teacher-1",
			expect.objectContaining({
				stem: validInput.stem,
				choices: validInput.choices,
			}),
		);
		expect(createQuestion).not.toHaveBeenCalledWith(
			mockDb,
			"attacker",
			expect.anything(),
		);
		expect(prepare).not.toHaveBeenCalled();
	});

	it("lists and gets questions as success results after a valid session", async () => {
		signedIn();
		vi.mocked(listQuestions).mockResolvedValue([question]);
		vi.mocked(getQuestion).mockResolvedValue(question);

		await expect(listQuestionsAction()).resolves.toEqual({
			ok: true,
			data: [question],
		});
		await expect(getQuestionAction("q1")).resolves.toEqual({
			ok: true,
			data: question,
		});
		expect(getSession).toHaveBeenCalledWith(mockDb, "sess-browser-a");
		expect(prepare).not.toHaveBeenCalled();
	});

	it("returns not_found when getQuestion yields null", async () => {
		signedIn();
		vi.mocked(getQuestion).mockResolvedValue(null);

		await expect(getQuestionAction("missing")).resolves.toEqual({
			ok: false,
			code: "not_found",
			error: "Question not found",
		});
	});

	it("maps ownership failures to a forbidden result", async () => {
		signedIn("teacher-2");
		vi.mocked(updateQuestion).mockRejectedValue(new McqForbiddenError());

		const result = await updateQuestionAction("q1", validInput);

		expect(result).toEqual({
			ok: false,
			code: "forbidden",
			error: "You do not own this question",
		});
		expect(prepare).not.toHaveBeenCalled();
	});

	it("maps missing rows to a not_found result", async () => {
		signedIn();
		vi.mocked(deleteQuestion).mockRejectedValue(new McqNotFoundError());

		await expect(deleteQuestionAction("missing")).resolves.toEqual({
			ok: false,
			code: "not_found",
			error: "Question not found",
		});
	});

	it("returns a generic server error for unexpected throws", async () => {
		signedIn();
		vi.mocked(listQuestions).mockRejectedValue(new Error("d1 down"));

		await expect(listQuestionsAction()).resolves.toEqual({
			ok: false,
			code: "server",
			error: "Something went wrong",
		});
	});

	it("grades an attempt from the service result, ignoring client isCorrect", async () => {
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
			ok: true,
			data: { questionId: "q1", choiceId: "c1", isCorrect: true },
		});
		expect(checkQuestionAttempt).toHaveBeenCalledWith(mockDb, {
			questionId: "q1",
			choiceId: "c1",
		});
		expect(prepare).not.toHaveBeenCalled();
	});

	it("rejects invalid attempt payloads without calling the service", async () => {
		signedIn();

		const result = await checkQuestionAttemptAction({
			questionId: "q1",
			choiceId: "",
		});

		expect(result).toMatchObject({ ok: false, code: "validation" });
		expect(checkQuestionAttempt).not.toHaveBeenCalled();
	});
});
