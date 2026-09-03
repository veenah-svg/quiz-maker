import { LogoutButton } from "@/components/logout-button";
import { McqDashboard } from "@/components/mcq-dashboard";

export default function McqsPage() {
	return (
		<div className="flex min-h-svh w-full justify-center p-6 md:p-10">
			<main className="flex w-full max-w-4xl flex-col gap-6">
				<div className="flex items-start justify-between gap-4">
					<div className="flex flex-col gap-2">
						<h1 className="text-2xl font-semibold tracking-tight">Question bank</h1>
						<p className="text-sm text-muted-foreground">
							Shared multiple-choice questions for teachers.
						</p>
					</div>
					<LogoutButton />
				</div>
				<McqDashboard />
			</main>
		</div>
	);
}
