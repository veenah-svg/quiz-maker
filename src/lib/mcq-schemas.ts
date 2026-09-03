import { z } from "zod";

const choiceInputSchema = z.object({
	label: z.string().trim().min(1, "choice label is required"),
	isCorrect: z.boolean(),
});

const questionFields = z.object({
	stem: z.string().trim().min(1, "stem is required"),
	choices: z
		.array(choiceInputSchema)
		.min(2, "at least two choices are required")
		.max(6, "at most six choices are allowed"),
});

function exactlyOneCorrect(value: { choices: { isCorrect: boolean }[] }) {
	return value.choices.filter((choice) => choice.isCorrect).length === 1;
}

export const createQuestionSchema = questionFields.refine(exactlyOneCorrect, {
	message: "exactly one choice must be correct",
});

export const updateQuestionSchema = createQuestionSchema;

export type QuestionInput = z.infer<typeof createQuestionSchema>;

export function firstMcqZodMessage(error: z.ZodError): string {
	return error.issues[0]?.message ?? "Invalid request";
}
