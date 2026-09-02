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

function usersTableBody(sql: string): string {
	const match = sql.match(/CREATE TABLE users\s*\(([\s\S]*?)\)\s*;/i);
	expect(match, "expected a CREATE TABLE users statement").not.toBeNull();
	return match?.[1] ?? "";
}

describe("users migration schema", () => {
	it("creates a users table", () => {
		const sql = loadMigrationSql();
		expect(sql).toMatch(/CREATE TABLE users\s*\(/i);
	});

	it("defines the required columns", () => {
		const body = usersTableBody(loadMigrationSql());

		expect(body).toMatch(/\bid\b/);
		expect(body).toMatch(/\bfirst_name\b/);
		expect(body).toMatch(/\blast_name\b/);
		expect(body).toMatch(/\busername\b/);
		expect(body).toMatch(/\bemail\b/);
		expect(body).toMatch(/\bpassword_hash\b/);
		expect(body).toMatch(/\bcreated_at\b/);
		expect(body).toMatch(/\bupdated_at\b/);
	});

	it("uses a TEXT primary key for id", () => {
		const body = usersTableBody(loadMigrationSql());
		expect(body).toMatch(/\bid\s+TEXT\s+PRIMARY KEY\b/i);
	});

	it("requires unique username and email", () => {
		const body = usersTableBody(loadMigrationSql());
		expect(body).toMatch(/\busername\s+TEXT\s+NOT NULL\s+UNIQUE\b/i);
		expect(body).toMatch(/\bemail\s+TEXT\s+NOT NULL\s+UNIQUE\b/i);
	});

	it("requires password_hash", () => {
		const body = usersTableBody(loadMigrationSql());
		expect(body).toMatch(/\bpassword_hash\s+TEXT\s+NOT NULL\b/i);
	});

	it("indexes username and email", () => {
		const sql = loadMigrationSql();
		expect(sql).toMatch(/CREATE INDEX \w+\s+ON users\s*\(\s*username\s*\)/i);
		expect(sql).toMatch(/CREATE INDEX \w+\s+ON users\s*\(\s*email\s*\)/i);
	});
});
