import { SESSION_MAX_AGE_SECONDS } from "@/lib/session-cookie";

export type SessionRecord = {
	id: string;
	userId: string;
	expiresAt: string;
};

type SessionRow = {
	id: string;
	user_id: string;
	expires_at: string;
};

function mapSession(row: SessionRow): SessionRecord {
	return {
		id: row.id,
		userId: row.user_id,
		expiresAt: row.expires_at,
	};
}

function newSessionId(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function queryOne(
	db: D1Database,
	sql: string,
	params: unknown[],
): Promise<SessionRow | null> {
	const { results } = await db.prepare(sql).bind(...params).all<SessionRow>();
	return results[0] ?? null;
}

export async function createSession(
	db: D1Database,
	userId: string,
): Promise<SessionRecord> {
	const id = newSessionId();
	const expiresAt = new Date(
		Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
	).toISOString();

	const row = await queryOne(
		db,
		`INSERT INTO sessions (id, user_id, expires_at)
     VALUES (?1, ?2, ?3)
     RETURNING id, user_id, expires_at`,
		[id, userId, expiresAt],
	);

	if (!row) {
		throw new Error("Failed to create session");
	}

	return mapSession(row);
}

export async function getSession(
	db: D1Database,
	sessionId: string | undefined | null,
): Promise<SessionRecord | null> {
	if (!sessionId) {
		return null;
	}

	const now = new Date().toISOString();
	const row = await queryOne(
		db,
		`SELECT id, user_id, expires_at FROM sessions
     WHERE id = ?1 AND expires_at > ?2`,
		[sessionId, now],
	);

	return row ? mapSession(row) : null;
}

export async function deleteSession(
	db: D1Database,
	sessionId: string,
): Promise<void> {
	await db
		.prepare("DELETE FROM sessions WHERE id = ?1")
		.bind(sessionId)
		.run();
}
