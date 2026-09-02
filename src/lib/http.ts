import { NextResponse } from "next/server";

export function jsonError(status: number, error: string) {
	return NextResponse.json({ error }, { status });
}

export async function readJsonBody(request: Request): Promise<unknown | null> {
	try {
		return await request.json();
	} catch {
		return null;
	}
}
