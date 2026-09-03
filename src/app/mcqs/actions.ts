"use server";

import { cookies } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
	createQuestionSchema,
	firstMcqZodMessage,
	questionAttemptSchema,
	questionIdSchema,
	updateQuestionSchema,
} from "@/lib/mcq-schemas";
import { SESSION_COOKIE_NAME } from "@/lib/session-cookie";
import {
	McqForbiddenError,
	McqNotFoundError,
	McqValidationError,
	checkQuestionAttempt,
	createQuestion,
	deleteQuestion,
	getQuestion,
	listQuestions,
	updateQuestion,
	type Question,
	type QuestionAttemptResult,
} from "@/lib/services/mcq-service";
import { getSession } from "@/lib/services/session-service";

export type McqActionCode =
	| "unauthorized"
	| "validation"
	| "not_found"
	| "forbidden"
	| "server";

export type McqActionResult<T> =
	| { ok: true; data: T }
	| { ok: false; code: McqActionCode; error: string };

function ok<T>(data: T): McqActionResult<T> {
	return { ok: true, data };
}

function fail(code: McqActionCode, error: string): McqActionResult<never> {
	return { ok: false, code, error };
}

function mapError(error: unknown): McqActionResult<never> {
	if (error instanceof McqValidationError) {
		return fail("validation", error.message);
	}

	if (error instanceof McqNotFoundError) {
		return fail("not_found", error.message);
	}

	if (error instanceof McqForbiddenError) {
		return fail("forbidden", error.message);
	}

	return fail("server", "Something went wrong");
}

async function requireActor(): Promise<
	McqActionResult<{ db: D1Database; ownerId: string }>
> {
	const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
	const { env } = await getCloudflareContext({ async: true });
	const session = await getSession(env.DB, sessionId);

	if (!session) {
		return fail("unauthorized", "You must be signed in to access questions");
	}

	return ok({ db: env.DB, ownerId: session.userId });
}

export async function listQuestionsAction(): Promise<McqActionResult<Question[]>> {
	const actor = await requireActor();
	if (!actor.ok) {
		return actor;
	}

	try {
		return ok(await listQuestions(actor.data.db));
	} catch (error) {
		return mapError(error);
	}
}

export async function getQuestionAction(
	id: unknown,
): Promise<McqActionResult<Question>> {
	const actor = await requireActor();
	if (!actor.ok) {
		return actor;
	}

	const parsedId = questionIdSchema.safeParse(id);
	if (!parsedId.success) {
		return fail("validation", firstMcqZodMessage(parsedId.error));
	}

	try {
		const question = await getQuestion(actor.data.db, parsedId.data);
		if (!question) {
			return fail("not_found", "Question not found");
		}

		return ok(question);
	} catch (error) {
		return mapError(error);
	}
}

export async function createQuestionAction(
	input: unknown,
): Promise<McqActionResult<Question>> {
	const actor = await requireActor();
	if (!actor.ok) {
		return actor;
	}

	const parsed = createQuestionSchema.safeParse(input);
	if (!parsed.success) {
		return fail("validation", firstMcqZodMessage(parsed.error));
	}

	try {
		return ok(
			await createQuestion(actor.data.db, actor.data.ownerId, parsed.data),
		);
	} catch (error) {
		return mapError(error);
	}
}

export async function updateQuestionAction(
	id: unknown,
	input: unknown,
): Promise<McqActionResult<Question>> {
	const actor = await requireActor();
	if (!actor.ok) {
		return actor;
	}

	const parsedId = questionIdSchema.safeParse(id);
	if (!parsedId.success) {
		return fail("validation", firstMcqZodMessage(parsedId.error));
	}

	const parsed = updateQuestionSchema.safeParse(input);
	if (!parsed.success) {
		return fail("validation", firstMcqZodMessage(parsed.error));
	}

	try {
		return ok(
			await updateQuestion(
				actor.data.db,
				parsedId.data,
				actor.data.ownerId,
				parsed.data,
			),
		);
	} catch (error) {
		return mapError(error);
	}
}

export async function deleteQuestionAction(
	id: unknown,
): Promise<McqActionResult<{ deleted: true }>> {
	const actor = await requireActor();
	if (!actor.ok) {
		return actor;
	}

	const parsedId = questionIdSchema.safeParse(id);
	if (!parsedId.success) {
		return fail("validation", firstMcqZodMessage(parsedId.error));
	}

	try {
		await deleteQuestion(actor.data.db, parsedId.data, actor.data.ownerId);
		return ok({ deleted: true });
	} catch (error) {
		return mapError(error);
	}
}

export async function checkQuestionAttemptAction(
	input: unknown,
): Promise<McqActionResult<QuestionAttemptResult>> {
	const actor = await requireActor();
	if (!actor.ok) {
		return actor;
	}

	const parsed = questionAttemptSchema.safeParse(input);
	if (!parsed.success) {
		return fail("validation", firstMcqZodMessage(parsed.error));
	}

	try {
		return ok(await checkQuestionAttempt(actor.data.db, parsed.data));
	} catch (error) {
		return mapError(error);
	}
}
