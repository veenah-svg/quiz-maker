import { NextResponse } from "next/server";

export const SESSION_COOKIE_NAME = "qm_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export function readSessionIdFromCookieHeader(
	header: string | null,
): string | undefined {
	if (!header) {
		return undefined;
	}

	for (const part of header.split(";")) {
		const separator = part.indexOf("=");
		if (separator === -1) {
			continue;
		}

		const name = part.slice(0, separator).trim();
		if (name !== SESSION_COOKIE_NAME) {
			continue;
		}

		const value = part.slice(separator + 1).trim();
		return value || undefined;
	}

	return undefined;
}

export function applySessionCookie(response: NextResponse, sessionId: string) {
	response.cookies.set({
		name: SESSION_COOKIE_NAME,
		value: sessionId,
		httpOnly: true,
		sameSite: "lax",
		path: "/",
		maxAge: SESSION_MAX_AGE_SECONDS,
		secure: process.env.NODE_ENV === "production",
	});
	return response;
}

export function expireSessionCookie(response: NextResponse) {
	response.cookies.set({
		name: SESSION_COOKIE_NAME,
		value: "",
		httpOnly: true,
		sameSite: "lax",
		path: "/",
		maxAge: 0,
	});
	return response;
}
