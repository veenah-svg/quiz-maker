import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import {
	expireSessionCookie,
	readSessionIdFromCookieHeader,
} from "@/lib/session-cookie";
import { deleteSession } from "@/lib/services/session-service";

export async function POST(request: Request) {
	const sessionId = readSessionIdFromCookieHeader(request.headers.get("cookie"));

	if (sessionId) {
		try {
			const { env } = await getCloudflareContext({ async: true });
			await deleteSession(env.DB, sessionId);
		} catch {
			// This browser still logs out; other browsers keep their own sessions.
		}
	}

	const response = NextResponse.json({ ok: true });
	expireSessionCookie(response);
	return response;
}
