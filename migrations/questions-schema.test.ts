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

function tableBody(sql: string, table: string): string {
	const match = sql.match(
		new RegExp(`CREATE TABLE ${table}\\s*\\(([\\s\\S]*?)\\)\\s*;`, "i"),
	);
	expect(match, `expected a CREATE TABLE ${table} statement`).not.toBeNull();
	return match?.[1] ?? "";
}

describe("questions and choices migration schema", () => {
	it("creates questions and choices tables", () => {
		const sql = loadMigrationSql();
		expect(sql).toMatch(/CREATE TABLE questions\s*\(/i);
		expect(sql).toMatch(/CREATE TABLE choices\s*\(/i);
	});

	it("defines question columns including owner_id for ownership", () => {
		const body = tableBody(loadMigrationSql(), "questions");

		expect(body).toMatch(/\bid\b/);
		expect(body).toMatch(/\bstem\b/);
		expect(body).toMatch(/\bowner_id\b/);
		expect(body).toMatch(/\bcreated_at\b/);
		expect(body).toMatch(/\bupdated_at\b/);
	});

	it("uses a TEXT primary key for questions.id", () => {
		const body = tableBody(loadMigrationSql(), "questions");
		expect(body).toMatch(/\bid\s+TEXT\s+PRIMARY KEY\b/i);
	});

	it("requires stem and owner_id", () => {
		const body = tableBody(loadMigrationSql(), "questions");
		expect(body).toMatch(/\bstem\s+TEXT\s+NOT NULL\b/i);
		expect(body).toMatch(/\bowner_id\s+TEXT\s+NOT NULL\b/i);
	});

	it("ties questions.owner_id to users with cascade on user delete", () => {
		const body = tableBody(loadMigrationSql(), "questions");
		expect(body).toMatch(
			/FOREIGN KEY\s*\(\s*owner_id\s*\)\s*REFERENCES users\s*\(\s*id\s*\)\s*ON DELETE CASCADE/i,
		);
	});

	it("defines choice columns for label, boolean correctness, and ordering", () => {
		const body = tableBody(loadMigrationSql(), "choices");

		expect(body).toMatch(/\bid\b/);
		expect(body).toMatch(/\bquestion_id\b/);
		expect(body).toMatch(/\blabel\b/);
		expect(body).toMatch(/\bis_correct\b/);
		expect(body).toMatch(/\bposition\b/);
	});

	it("stores is_correct as INTEGER so SQLite can map booleans", () => {
		const body = tableBody(loadMigrationSql(), "choices");
		expect(body).toMatch(/\bis_correct\s+INTEGER\s+NOT NULL\b/i);
	});

	it("requires position for choice ordering", () => {
		const body = tableBody(loadMigrationSql(), "choices");
		expect(body).toMatch(/\bposition\s+INTEGER\s+NOT NULL\b/i);
	});

	it("cascades choice deletes when a question is removed", () => {
		const body = tableBody(loadMigrationSql(), "choices");
		expect(body).toMatch(
			/FOREIGN KEY\s*\(\s*question_id\s*\)\s*REFERENCES questions\s*\(\s*id\s*\)\s*ON DELETE CASCADE/i,
		);
	});

	it("indexes owner_id, question_id, and choice position", () => {
		const sql = loadMigrationSql();
		expect(sql).toMatch(/CREATE INDEX \w+\s+ON questions\s*\(\s*owner_id\s*\)/i);
		expect(sql).toMatch(/CREATE INDEX \w+\s+ON choices\s*\(\s*question_id\s*\)/i);
		expect(sql).toMatch(
			/CREATE UNIQUE INDEX \w+\s+ON choices\s*\(\s*question_id\s*,\s*position\s*\)/i,
		);
	});
});
