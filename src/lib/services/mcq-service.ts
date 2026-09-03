import {
	createQuestionSchema,
	firstMcqZodMessage,
	updateQuestionSchema,
	type QuestionInput,
} from "@/lib/mcq-schemas";

export class McqValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "McqValidationError";
	}
}

export class McqNotFoundError extends Error {
	constructor(message = "Question not found") {
		super(message);
		this.name = "McqNotFoundError";
	}
}

export class McqForbiddenError extends Error {
	constructor(message = "You do not own this question") {
		super(message);
		this.name = "McqForbiddenError";
	}
}

export type Choice = {
	id: string;
	label: string;
	isCorrect: boolean;
	position: number;
};

export type Question = {
	id: string;
	stem: string;
	ownerId: string;
	createdAt: string;
	updatedAt: string;
	choices: Choice[];
};

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

const QUESTION_COLUMNS =
	"id, stem, owner_id, created_at, updated_at";
const CHOICE_COLUMNS =
	"id, question_id, label, is_correct, position";

function newId(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

function toSqliteBool(value: boolean): 0 | 1 {
	return value ? 1 : 0;
}

function fromSqliteBool(value: number): boolean {
	return Number(value) === 1;
}

function mapChoice(row: ChoiceRow): Choice {
	return {
		id: row.id,
		label: row.label,
		isCorrect: fromSqliteBool(row.is_correct),
		position: row.position,
	};
}

function mapQuestion(row: QuestionRow, choiceRows: ChoiceRow[]): Question {
	const ordered = [...choiceRows]
		.filter((choice) => choice.question_id === row.id)
		.sort((left, right) => left.position - right.position)
		.map(mapChoice);

	return {
		id: row.id,
		stem: row.stem,
		ownerId: row.owner_id,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		choices: ordered,
	};
}

function parseQuestionInput(
	schema: typeof createQuestionSchema,
	input: unknown,
): QuestionInput {
	const parsed = schema.safeParse(input);
	if (!parsed.success) {
		throw new McqValidationError(firstMcqZodMessage(parsed.error));
	}
	return parsed.data;
}

async function queryAll<T>(
	db: D1Database,
	sql: string,
	params: unknown[] = [],
): Promise<T[]> {
	const statement = db.prepare(sql);
	const { results } = params.length
		? await statement.bind(...params).all<T>()
		: await statement.all<T>();
	return results;
}

async function queryOne<T>(
	db: D1Database,
	sql: string,
	params: unknown[],
): Promise<T | null> {
	const rows = await queryAll<T>(db, sql, params);
	return rows[0] ?? null;
}

async function loadChoices(
	db: D1Database,
	questionIds: string[],
): Promise<ChoiceRow[]> {
	if (questionIds.length === 0) {
		return [];
	}

	const placeholders = questionIds
		.map((_, index) => `?${index + 1}`)
		.join(", ");

	return queryAll<ChoiceRow>(
		db,
		`SELECT ${CHOICE_COLUMNS} FROM choices
     WHERE question_id IN (${placeholders})
     ORDER BY position ASC`,
		questionIds,
	);
}

async function insertChoices(
	db: D1Database,
	questionId: string,
	choices: QuestionInput["choices"],
): Promise<void> {
	for (const [position, choice] of choices.entries()) {
		await queryOne(
			db,
			`INSERT INTO choices (id, question_id, label, is_correct, position)
       VALUES (?1, ?2, ?3, ?4, ?5)
       RETURNING ${CHOICE_COLUMNS}`,
			[
				newId(),
				questionId,
				choice.label,
				toSqliteBool(choice.isCorrect),
				position,
			],
		);
	}
}

async function requireOwnedQuestion(
	db: D1Database,
	id: string,
	ownerId: string,
): Promise<QuestionRow> {
	const row = await queryOne<QuestionRow>(
		db,
		`SELECT ${QUESTION_COLUMNS} FROM questions WHERE id = ?1`,
		[id],
	);

	if (!row) {
		throw new McqNotFoundError();
	}

	if (row.owner_id !== ownerId) {
		throw new McqForbiddenError();
	}

	return row;
}

export async function createQuestion(
	db: D1Database,
	ownerId: string,
	input: unknown,
): Promise<Question> {
	const parsed = parseQuestionInput(createQuestionSchema, input);
	const id = newId();

	const row = await queryOne<QuestionRow>(
		db,
		`INSERT INTO questions (id, stem, owner_id)
     VALUES (?1, ?2, ?3)
     RETURNING ${QUESTION_COLUMNS}`,
		[id, parsed.stem, ownerId],
	);

	if (!row) {
		throw new Error("Failed to create question");
	}

	await insertChoices(db, row.id, parsed.choices);
	const choiceRows = await loadChoices(db, [row.id]);
	return mapQuestion(row, choiceRows);
}

export async function getQuestion(
	db: D1Database,
	id: string,
): Promise<Question | null> {
	const row = await queryOne<QuestionRow>(
		db,
		`SELECT ${QUESTION_COLUMNS} FROM questions WHERE id = ?1`,
		[id],
	);

	if (!row) {
		return null;
	}

	const choiceRows = await loadChoices(db, [row.id]);
	return mapQuestion(row, choiceRows);
}

export async function listQuestions(db: D1Database): Promise<Question[]> {
	const rows = await queryAll<QuestionRow>(
		db,
		`SELECT ${QUESTION_COLUMNS} FROM questions ORDER BY created_at DESC`,
	);

	const choiceRows = await loadChoices(
		db,
		rows.map((row) => row.id),
	);

	return rows.map((row) => mapQuestion(row, choiceRows));
}

export async function updateQuestion(
	db: D1Database,
	id: string,
	ownerId: string,
	input: unknown,
): Promise<Question> {
	const parsed = parseQuestionInput(updateQuestionSchema, input);
	await requireOwnedQuestion(db, id, ownerId);

	const row = await queryOne<QuestionRow>(
		db,
		`UPDATE questions
     SET stem = ?1, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?2 AND owner_id = ?3
     RETURNING ${QUESTION_COLUMNS}`,
		[parsed.stem, id, ownerId],
	);

	if (!row) {
		throw new McqNotFoundError();
	}

	await db
		.prepare("DELETE FROM choices WHERE question_id = ?1")
		.bind(id)
		.run();
	await insertChoices(db, id, parsed.choices);

	const choiceRows = await loadChoices(db, [id]);
	return mapQuestion(row, choiceRows);
}

export async function deleteQuestion(
	db: D1Database,
	id: string,
	ownerId: string,
): Promise<void> {
	await requireOwnedQuestion(db, id, ownerId);

	await db
		.prepare("DELETE FROM questions WHERE id = ?1 AND owner_id = ?2")
		.bind(id, ownerId)
		.run();
}
