import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { firstZodMessage, loginBodySchema } from "@/lib/auth-schemas";
import { jsonError, readJsonBody } from "@/lib/http";
import { passwordHashesMatch } from "@/lib/password";
import { getUserByUsername } from "@/lib/services/user-service";

const INVALID_CREDENTIALS = "Invalid username or password";

export async function POST(request: Request) {
	const body = await readJsonBody(request);
	if (body === null) {
		return jsonError(400, "Invalid JSON body");
	}

	const parsed = loginBodySchema.safeParse(body);
	if (!parsed.success) {
		return jsonError(400, firstZodMessage(parsed.error));
	}

	try {
		const { env } = await getCloudflareContext({ async: true });
		const user = await getUserByUsername(env.DB, parsed.data.username);

		if (!user || !passwordHashesMatch(user.passwordHash, parsed.data.passwordHash)) {
			return jsonError(401, INVALID_CREDENTIALS);
		}

		return NextResponse.json({
			id: user.id,
			firstName: user.firstName,
			lastName: user.lastName,
			username: user.username,
			email: user.email,
		});
	} catch {
		return jsonError(500, "Something went wrong");
	}
}
