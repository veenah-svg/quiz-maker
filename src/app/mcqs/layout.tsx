import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { SESSION_COOKIE_NAME } from "@/lib/session-cookie";
import { getSession } from "@/lib/services/session-service";

export default async function McqsLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
	const { env } = await getCloudflareContext({ async: true });
	const session = await getSession(env.DB, sessionId);

	if (!session) {
		redirect("/login");
	}

	return children;
}
