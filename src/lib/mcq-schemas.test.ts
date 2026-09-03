import { describe, expect, it } from "vitest";
import {
	createQuestionSchema,
	questionAttemptSchema,
	questionIdSchema,
	updateQuestionSchema,
} from "@/lib/mcq-schemas";

const validChoices = [
	{ label: "Paris", isCorrect: true },
	{ label: "London", isCorrect: false },
	{ label: "Berlin", isCorrect: false },
];

describe("MCQ Zod schemas", () => {
	it("accepts a stem with two to six choices and exactly one correct", () => {
		const parsed = createQuestionSchema.safeParse({
			stem: "What is the capital of France?",
			choices: validChoices,
		});

		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.stem).toBe("What is the capital of France?");
			expect(parsed.data.choices).toHaveLength(3);
		}
	});

	it("trims the stem and choice labels", () => {
		const parsed = createQuestionSchema.safeParse({
			stem: "  Capital?  ",
			choices: [
				{ label: "  Paris  ", isCorrect: true },
				{ label: " London", isCorrect: false },
			],
		});

		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.stem).toBe("Capital?");
			expect(parsed.data.choices[0]?.label).toBe("Paris");
			expect(parsed.data.choices[1]?.label).toBe("London");
		}
	});

	it("rejects an empty stem", () => {
		const parsed = createQuestionSchema.safeParse({
			stem: "   ",
			choices: validChoices,
		});

		expect(parsed.success).toBe(false);
	});

	it("rejects fewer than two choices", () => {
		const parsed = createQuestionSchema.safeParse({
			stem: "Capital?",
			choices: [{ label: "Paris", isCorrect: true }],
		});

		expect(parsed.success).toBe(false);
	});

	it("rejects more than six choices", () => {
		const parsed = createQuestionSchema.safeParse({
			stem: "Capital?",
			choices: [
				{ label: "A", isCorrect: true },
				{ label: "B", isCorrect: false },
				{ label: "C", isCorrect: false },
				{ label: "D", isCorrect: false },
				{ label: "E", isCorrect: false },
				{ label: "F", isCorrect: false },
				{ label: "G", isCorrect: false },
			],
		});

		expect(parsed.success).toBe(false);
	});

	it("rejects zero or more than one correct choice", () => {
		const noneCorrect = createQuestionSchema.safeParse({
			stem: "Capital?",
			choices: [
				{ label: "Paris", isCorrect: false },
				{ label: "London", isCorrect: false },
			],
		});
		const twoCorrect = createQuestionSchema.safeParse({
			stem: "Capital?",
			choices: [
				{ label: "Paris", isCorrect: true },
				{ label: "London", isCorrect: true },
			],
		});

		expect(noneCorrect.success).toBe(false);
		expect(twoCorrect.success).toBe(false);
	});

	it("rejects a missing or empty choice label", () => {
		const parsed = createQuestionSchema.safeParse({
			stem: "Capital?",
			choices: [
				{ label: "  ", isCorrect: true },
				{ label: "London", isCorrect: false },
			],
		});

		expect(parsed.success).toBe(false);
	});

	it("uses the same rules for update as for create", () => {
		expect(updateQuestionSchema.safeParse({ stem: "", choices: [] }).success).toBe(
			false,
		);
		expect(
			updateQuestionSchema.safeParse({
				stem: "Capital?",
				choices: validChoices,
			}).success,
		).toBe(true);
	});
});

describe("questionAttemptSchema", () => {
	it("accepts trimmed question and choice ids", () => {
		const parsed = questionAttemptSchema.safeParse({
			questionId: "  q1  ",
			choiceId: "  c1  ",
		});

		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data).toEqual({ questionId: "q1", choiceId: "c1" });
		}
	});

	it("rejects missing or empty ids", () => {
		expect(questionAttemptSchema.safeParse({}).success).toBe(false);
		expect(
			questionAttemptSchema.safeParse({ questionId: "q1", choiceId: "  " }).success,
		).toBe(false);
		expect(
			questionAttemptSchema.safeParse({ questionId: "  ", choiceId: "c1" }).success,
		).toBe(false);
	});

	it("does not keep a client-supplied isCorrect flag", () => {
		const parsed = questionAttemptSchema.safeParse({
			questionId: "q1",
			choiceId: "c1",
			isCorrect: true,
		});

		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data).not.toHaveProperty("isCorrect");
		}
	});
});

describe("questionIdSchema", () => {
	it("trims a required question id", () => {
		const parsed = questionIdSchema.safeParse("  q1  ");

		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data).toBe("q1");
		}
	});

	it("rejects an empty question id", () => {
		expect(questionIdSchema.safeParse("").success).toBe(false);
		expect(questionIdSchema.safeParse("   ").success).toBe(false);
	});
});
