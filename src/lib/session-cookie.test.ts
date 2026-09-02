import { NextResponse } from "next/server";
import { describe, expect, it } from "vitest";
import {
	SESSION_COOKIE_NAME,
	applySessionCookie,
	expireSessionCookie,
	readSessionIdFromCookieHeader,
} from "./session-cookie";

describe("session cookie helpers", () => {
	it("reads this browser's session id from the Cookie header", () => {
		expect(
			readSessionIdFromCookieHeader(
				`${SESSION_COOKIE_NAME}=sess-browser-a; theme=dark`,
			),
		).toBe("sess-browser-a");
	});

	it("returns undefined when this browser has no session cookie", () => {
		expect(readSessionIdFromCookieHeader(null)).toBeUndefined();
		expect(readSessionIdFromCookieHeader("theme=dark")).toBeUndefined();
	});

	it("sets an HttpOnly session cookie on login/register responses", () => {
		const response = applySessionCookie(NextResponse.json({ ok: true }), "sess-1");
		const cookie = response.cookies.get(SESSION_COOKIE_NAME);

		expect(cookie?.value).toBe("sess-1");
		expect(cookie?.httpOnly).toBe(true);
		expect(cookie?.path).toBe("/");
		expect(cookie?.sameSite).toBe("lax");
	});

	it("expires the session cookie on logout without sharing another browser's id", () => {
		const response = expireSessionCookie(NextResponse.json({ ok: true }));
		const cookie = response.cookies.get(SESSION_COOKIE_NAME);

		expect(cookie?.value).toBe("");
		expect(cookie?.maxAge).toBe(0);
		expect(cookie?.httpOnly).toBe(true);
	});
});
