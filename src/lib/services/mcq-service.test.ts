import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	McqForbiddenError,
	McqNotFoundError,
	McqValidationError,
	createQuestion,
	deleteQuestion,
	getQuestion,
	listQuestions,
	updateQuestion,
} from "@/lib/services/mcq-service";

type QuestionRow = {
	id: string;
	stem: string;
	owner_id: string;
	created_at: string;
	updated_at: string;
};

type ChoiceRow = {
	id: string;
	question_id: string;
	label: string;
	is_correct: number;
	position: number;
};

type PreparedCall = {
	sql: string;
	bound: unknown[];
};

function createFakeDb(options?: {
	questions?: QuestionRow[];
	choices?: ChoiceRow[];
	error?: Error;
}): { db: D1Database; calls: PreparedCall[] } {
	const calls: PreparedCall[] = [];
	const questions = options?.questions ?? [];
	const choices = options?.choices ?? [];
	const error = options?.error;

	const db = {
		prepare(sql: string) {
			const call: PreparedCall = { sql, bound: [] };
			calls.push(call);

			const statement = {
				bind(...values: unknown[]) {
					call.bound = values;
					return statement;
				},
				async all() {
					if (error) {
						throw error;
					}

					if (/insert into questions/i.test(sql) || /update questions/i.test(sql)) {
						return { results: questions };
					}

					if (/select[\s\S]*from questions/i.test(sql)) {
						return { results: questions };
					}

					if (/from choices/i.test(sql) || /insert into choices/i.test(sql)) {
						return { results: choices };
					}

					return { results: [] };
				},
				async run() {
					if (error) {
						throw error;
					}
					return { success: true };
				},
			};

			return statement;
		},
	} as unknown as D1Database;

	return { db, calls };
}

const now = "2026-09-03T12:00:00.000Z";

const questionRow: QuestionRow = {
	id: "q1",
	stem: "What is the capital of France?",
	owner_id: "teacher-1",
	created_at: now,
	updated_at: now,
};

const choiceRows: ChoiceRow[] = [
	{
		id: "c2",
		question_id: "q1",
		label: "London",
		is_correct: 0,
		position: 1,
	},
	{
		id: "c1",
		question_id: "q1",
		label: "Paris",
		is_correct: 1,
		position: 0,
	},
];

const validInput = {
	stem: "What is the capital of France?",
	choices: [
		{ label: "Paris", isCorrect: true },
		{ label: "London", isCorrect: false },
	],
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("mcq service", () => {
	describe("createQuestion", () => {
		it("inserts a question owned by the actor and returns mapped booleans", async () => {
			const { db, calls } = createFakeDb({
				questions: [questionRow],
				choices: [
					{
						id: "c1",
						question_id: "q1",
						label: "Paris",
						is_correct: 1,
						position: 0,
					},
					{
						id: "c2",
						question_id: "q1",
						label: "London",
						is_correct: 0,
						position: 1,
					},
				],
			});

			const question = await createQuestion(db, "teacher-1", validInput);

			expect(question.ownerId).toBe("teacher-1");
			expect(question.stem).toBe(validInput.stem);
			expect(question.choices[0]?.isCorrect).toBe(true);
			expect(question.choices[1]?.isCorrect).toBe(false);
			expect(question.choices.map((choice) => choice.position)).toEqual([0, 1]);

			const insertQuestion = calls.find((call) =>
				/insert into questions/i.test(call.sql),
			);
			expect(insertQuestion?.sql).toMatch(/\?1/);
			expect(insertQuestion?.sql).toMatch(/\?2/);
			expect(insertQuestion?.bound).toContain("teacher-1");
			expect(insertQuestion?.bound).toContain(validInput.stem);

			const insertChoice = calls.find((call) => /insert into choices/i.test(call.sql));
			expect(insertChoice?.sql).toMatch(/\?1/);
			expect(insertChoice?.bound).toContain(1);
			expect(insertChoice?.bound).toContain(0);
			expect(insertChoice?.bound).not.toContain(true);
			expect(insertChoice?.bound).not.toContain(false);
		});

		it("assigns choice positions from the submitted order", async () => {
			const { db, calls } = createFakeDb({
				questions: [questionRow],
				choices: choiceRows,
			});

			await createQuestion(db, "teacher-1", validInput);

			const choiceInserts = calls.filter((call) =>
				/insert into choices/i.test(call.sql),
			);
			expect(choiceInserts.length).toBe(2);
			expect(choiceInserts[0]?.bound).toContain(0);
			expect(choiceInserts[1]?.bound).toContain(1);
		});

		it("rejects invalid payloads with McqValidationError", async () => {
			const { db, calls } = createFakeDb();

			await expect(
				createQuestion(db, "teacher-1", {
					stem: "",
					choices: [{ label: "Paris", isCorrect: true }],
				}),
			).rejects.toBeInstanceOf(McqValidationError);

			expect(calls).toHaveLength(0);
		});
	});

	describe("getQuestion and listQuestions", () => {
		it("returns choices ordered by position even if rows arrive shuffled", async () => {
			const { db, calls } = createFakeDb({
				questions: [questionRow],
				choices: choiceRows,
			});

			const question = await getQuestion(db, "q1");

			expect(question?.choices.map((choice) => choice.label)).toEqual([
				"Paris",
				"London",
			]);
			expect(question?.choices[0]?.isCorrect).toBe(true);

			const choiceSelect = calls.find((call) => /from choices/i.test(call.sql));
			expect(choiceSelect?.sql).toMatch(/order by position/i);
			expect(choiceSelect?.sql).toMatch(/\?1/);
		});

		it("returns null when the question does not exist", async () => {
			const { db } = createFakeDb({ questions: [], choices: [] });

			await expect(getQuestion(db, "missing")).resolves.toBeNull();
		});

		it("lists questions with ordered choices", async () => {
			const { db, calls } = createFakeDb({
				questions: [questionRow],
				choices: choiceRows,
			});

			const listed = await listQuestions(db);

			expect(listed).toHaveLength(1);
			expect(listed[0]?.choices.map((choice) => choice.position)).toEqual([0, 1]);

			const choiceSelect = calls.find((call) => /from choices/i.test(call.sql));
			expect(choiceSelect?.sql).toMatch(/order by position/i);
		});
	});

	describe("ownership and errors", () => {
		it("forbids updating a question owned by another teacher", async () => {
			const { db, calls } = createFakeDb({
				questions: [questionRow],
				choices: choiceRows,
			});

			await expect(
				updateQuestion(db, "q1", "teacher-2", validInput),
			).rejects.toBeInstanceOf(McqForbiddenError);

			expect(calls.some((call) => /update questions/i.test(call.sql))).toBe(false);
			expect(calls.some((call) => /delete from choices/i.test(call.sql))).toBe(
				false,
			);
		});

		it("forbids deleting a question owned by another teacher", async () => {
			const { db, calls } = createFakeDb({ questions: [questionRow] });

			await expect(deleteQuestion(db, "q1", "teacher-2")).rejects.toBeInstanceOf(
				McqForbiddenError,
			);

			expect(calls.some((call) => /delete from questions/i.test(call.sql))).toBe(
				false,
			);
		});

		it("throws McqNotFoundError when updating a missing question", async () => {
			const { db } = createFakeDb({ questions: [] });

			await expect(
				updateQuestion(db, "missing", "teacher-1", validInput),
			).rejects.toBeInstanceOf(McqNotFoundError);
		});

		it("throws McqNotFoundError when deleting a missing question", async () => {
			const { db } = createFakeDb({ questions: [] });

			await expect(deleteQuestion(db, "missing", "teacher-1")).rejects.toBeInstanceOf(
				McqNotFoundError,
			);
		});

		it("updates only when the actor is the owner and refreshes updated_at", async () => {
			const { db, calls } = createFakeDb({
				questions: [{ ...questionRow, stem: "Updated stem?" }],
				choices: [
					{
						id: "c3",
						question_id: "q1",
						label: "Paris",
						is_correct: 1,
						position: 0,
					},
					{
						id: "c4",
						question_id: "q1",
						label: "Rome",
						is_correct: 0,
						position: 1,
					},
				],
			});

			const updated = await updateQuestion(db, "q1", "teacher-1", {
				stem: "Updated stem?",
				choices: [
					{ label: "Paris", isCorrect: true },
					{ label: "Rome", isCorrect: false },
				],
			});

			expect(updated.stem).toBe("Updated stem?");

			const update = calls.find((call) => /update questions/i.test(call.sql));
			expect(update?.sql).toMatch(/updated_at/i);
			expect(update?.sql).toMatch(/\?1/);
			expect(update?.bound).toContain("Updated stem?");
			expect(update?.bound).toContain("q1");
			expect(update?.bound).toContain("teacher-1");
		});

		it("deletes the question by id and owner so choices rely on CASCADE", async () => {
			const { db, calls } = createFakeDb({ questions: [questionRow] });

			await deleteQuestion(db, "q1", "teacher-1");

			const deletion = calls.find((call) => /delete from questions/i.test(call.sql));
			expect(deletion).toBeDefined();
			expect(deletion?.sql).toMatch(/\?1/);
			expect(deletion?.sql).toMatch(/\?2/);
			expect(deletion?.bound).toEqual(["q1", "teacher-1"]);
			expect(calls.some((call) => /delete from choices/i.test(call.sql))).toBe(
				false,
			);
		});
	});

	describe("SQL safety", () => {
		it("uses numbered placeholders and does not concatenate user input", async () => {
			const { db, calls } = createFakeDb({
				questions: [questionRow],
				choices: choiceRows,
			});

			await createQuestion(db, "teacher-1", validInput);
			await getQuestion(db, "q1");

			expect(calls.length).toBeGreaterThan(0);

			for (const call of calls) {
				expect(call.sql).not.toContain("What is the capital of France?");
				expect(call.sql).not.toContain("Paris");
				expect(call.sql).not.toMatch(/'\s*\?/);
				expect(call.sql).toMatch(/\?\d/);
			}
		});
	});
});
