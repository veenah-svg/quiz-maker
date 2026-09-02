export class UserConflictError extends Error {
	readonly field: "username" | "email";

	constructor(field: "username" | "email") {
		super(`${field} already taken`);
		this.name = "UserConflictError";
		this.field = field;
	}
}

export type PublicUser = {
	id: string;
	firstName: string;
	lastName: string;
	username: string;
	email: string;
};

export type UserRecord = PublicUser & {
	passwordHash: string;
};

export type CreateUserInput = {
	firstName: string;
	lastName: string;
	username: string;
	email: string;
	passwordHash: string;
};

export type UpdateUserInput = {
	firstName?: string;
	lastName?: string;
	username?: string;
	email?: string;
	passwordHash?: string;
};

type UserRow = {
	id: string;
	first_name: string;
	last_name: string;
	username: string;
	email: string;
	password_hash: string;
};

const USER_COLUMNS =
	"id, first_name, last_name, username, email, password_hash";

function mapRecord(row: UserRow): UserRecord {
	return {
		id: row.id,
		firstName: row.first_name,
		lastName: row.last_name,
		username: row.username,
		email: row.email,
		passwordHash: row.password_hash,
	};
}

function toPublic(record: UserRecord): PublicUser {
	return {
		id: record.id,
		firstName: record.firstName,
		lastName: record.lastName,
		username: record.username,
		email: record.email,
	};
}

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

function rethrowConflict(error: unknown): never {
	const message = error instanceof Error ? error.message : String(error);

	if (/UNIQUE constraint failed: users\.username/i.test(message)) {
		throw new UserConflictError("username");
	}

	if (/UNIQUE constraint failed: users\.email/i.test(message)) {
		throw new UserConflictError("email");
	}

	throw error;
}

async function queryOne(
	db: D1Database,
	sql: string,
	params: unknown[],
): Promise<UserRow | null> {
	const { results } = await db.prepare(sql).bind(...params).all<UserRow>();
	return results[0] ?? null;
}

export async function createUser(
	db: D1Database,
	input: CreateUserInput,
): Promise<PublicUser> {
	try {
		const row = await queryOne(
			db,
			`INSERT INTO users (first_name, last_name, username, email, password_hash)
       VALUES (?1, ?2, ?3, ?4, ?5)
       RETURNING ${USER_COLUMNS}`,
			[
				input.firstName.trim(),
				input.lastName.trim(),
				input.username.trim(),
				normalizeEmail(input.email),
				input.passwordHash,
			],
		);

		if (!row) {
			throw new Error("Failed to create user");
		}

		return toPublic(mapRecord(row));
	} catch (error) {
		rethrowConflict(error);
	}
}

export async function getUserByUsername(
	db: D1Database,
	username: string,
): Promise<UserRecord | null> {
	const row = await queryOne(
		db,
		`SELECT ${USER_COLUMNS} FROM users WHERE username = ?1`,
		[username.trim()],
	);
	return row ? mapRecord(row) : null;
}

export async function getUserByEmail(
	db: D1Database,
	email: string,
): Promise<UserRecord | null> {
	const row = await queryOne(
		db,
		`SELECT ${USER_COLUMNS} FROM users WHERE email = ?1`,
		[normalizeEmail(email)],
	);
	return row ? mapRecord(row) : null;
}

export async function updateUser(
	db: D1Database,
	id: string,
	input: UpdateUserInput,
): Promise<PublicUser> {
	const assignments: string[] = [];
	const params: unknown[] = [];

	const setField = (column: string, value: string) => {
		params.push(value);
		assignments.push(`${column} = ?${params.length}`);
	};

	if (input.firstName !== undefined) {
		setField("first_name", input.firstName.trim());
	}
	if (input.lastName !== undefined) {
		setField("last_name", input.lastName.trim());
	}
	if (input.username !== undefined) {
		setField("username", input.username.trim());
	}
	if (input.email !== undefined) {
		setField("email", normalizeEmail(input.email));
	}
	if (input.passwordHash !== undefined) {
		setField("password_hash", input.passwordHash);
	}

	assignments.push("updated_at = CURRENT_TIMESTAMP");
	params.push(id);
	const idPlaceholder = `?${params.length}`;

	try {
		const row = await queryOne(
			db,
			`UPDATE users SET ${assignments.join(", ")} WHERE id = ${idPlaceholder}
       RETURNING ${USER_COLUMNS}`,
			params,
		);

		if (!row) {
			throw new Error("User not found");
		}

		return toPublic(mapRecord(row));
	} catch (error) {
		rethrowConflict(error);
	}
}

export async function deleteUser(db: D1Database, id: string): Promise<void> {
	await db.prepare("DELETE FROM users WHERE id = ?1").bind(id).run();
}
