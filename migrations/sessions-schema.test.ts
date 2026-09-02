import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = dirname(fileURLToPath(import.meta.url));

function loadMigrationSql(): string {
	if (!existsSync(migrationsDir)) {
		return "";
	}

	const files = readdirSync(migrationsDir)
		.filter((name) => name.endsWith(".sql"))
		.sort();

	return files
		.map((name) => readFileSync(join(migrationsDir, name), "utf8"))
		.join("\n");
}

function sessionsTableBody(sql: string): string {
	const match = sql.match(/CREATE TABLE sessions\s*\(([\s\S]*?)\)\s*;/i);
	expect(match, "expected a CREATE TABLE sessions statement").not.toBeNull();
	return match?.[1] ?? "";
}

describe("sessions migration schema", () => {
	it("creates a sessions table", () => {
		const sql = loadMigrationSql();
		expect(sql).toMatch(/CREATE TABLE sessions\s*\(/i);
	});

	it("defines id, user_id, expires_at, and created_at", () => {
		const body = sessionsTableBody(loadMigrationSql());

		expect(body).toMatch(/\bid\b/);
		expect(body).toMatch(/\buser_id\b/);
		expect(body).toMatch(/\bexpires_at\b/);
		expect(body).toMatch(/\bcreated_at\b/);
	});

	it("uses a TEXT primary key for id", () => {
		const body = sessionsTableBody(loadMigrationSql());
		expect(body).toMatch(/\bid\s+TEXT\s+PRIMARY KEY\b/i);
	});

	it("requires user_id and expires_at", () => {
		const body = sessionsTableBody(loadMigrationSql());
		expect(body).toMatch(/\buser_id\s+TEXT\s+NOT NULL\b/i);
		expect(body).toMatch(/\bexpires_at\s+TEXT\s+NOT NULL\b/i);
	});

	it("indexes user_id so one teacher can have several browser sessions", () => {
		const sql = loadMigrationSql();
		expect(sql).toMatch(/CREATE INDEX \w+\s+ON sessions\s*\(\s*user_id\s*\)/i);
	});
});
