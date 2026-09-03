import { describe, expect, it } from "vitest";
import { createQuestionSchema, updateQuestionSchema } from "@/lib/mcq-schemas";

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
