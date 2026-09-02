"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
	const router = useRouter();

	async function handleLogout() {
		await fetch("/api/logout", { method: "POST" });
		router.push("/login");
	}

	return (
		<Button type="button" variant="outline" onClick={handleLogout}>
			Log out
		</Button>
	);
}
