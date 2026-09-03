"use server";

import { cookies } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { SESSION_COOKIE_NAME } from "@/lib/session-cookie";
import {
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

export class McqUnauthorizedError extends Error {
	constructor(message = "You must be signed in to access questions") {
		super(message);
		this.name = "McqUnauthorizedError";
	}
}

async function requireActor(): Promise<{ db: D1Database; ownerId: string }> {
	const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
	const { env } = await getCloudflareContext({ async: true });
	const session = await getSession(env.DB, sessionId);

	if (!session) {
		throw new McqUnauthorizedError();
	}

	return { db: env.DB, ownerId: session.userId };
}

export async function listQuestionsAction(): Promise<Question[]> {
	const { db } = await requireActor();
	return listQuestions(db);
}

export async function getQuestionAction(id: string): Promise<Question | null> {
	const { db } = await requireActor();
	return getQuestion(db, id);
}

export async function createQuestionAction(input: unknown): Promise<Question> {
	const { db, ownerId } = await requireActor();
	return createQuestion(db, ownerId, input);
}

export async function updateQuestionAction(
	id: string,
	input: unknown,
): Promise<Question> {
	const { db, ownerId } = await requireActor();
	return updateQuestion(db, id, ownerId, input);
}

export async function deleteQuestionAction(id: string): Promise<void> {
	const { db, ownerId } = await requireActor();
	return deleteQuestion(db, id, ownerId);
}

export async function checkQuestionAttemptAction(
	input: unknown,
): Promise<QuestionAttemptResult> {
	const { db } = await requireActor();
	return checkQuestionAttempt(db, input);
}
