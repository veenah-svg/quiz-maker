import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { firstZodMessage, registerBodySchema } from "@/lib/auth-schemas";
import { jsonError, readJsonBody } from "@/lib/http";
import { UserConflictError, createUser } from "@/lib/services/user-service";

export async function POST(request: Request) {
	const body = await readJsonBody(request);
	if (body === null) {
		return jsonError(400, "Invalid JSON body");
	}

	const parsed = registerBodySchema.safeParse(body);
	if (!parsed.success) {
		return jsonError(400, firstZodMessage(parsed.error));
	}

	try {
		const { env } = await getCloudflareContext({ async: true });
		const user = await createUser(env.DB, parsed.data);
		return NextResponse.json(user, { status: 201 });
	} catch (error) {
		if (error instanceof UserConflictError) {
			return jsonError(409, error.message);
		}

		return jsonError(500, "Something went wrong");
	}
}
