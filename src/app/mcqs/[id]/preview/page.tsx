import { McqAttempt } from "@/components/mcq-attempt";

export default async function PreviewQuestionPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;

	return (
		<div className="flex min-h-svh w-full justify-center p-6 md:p-10">
			<main className="flex w-full max-w-lg flex-col gap-6">
				<div className="flex flex-col gap-2">
					<h1 className="text-2xl font-semibold tracking-tight">
						Preview question
					</h1>
					<p className="text-sm text-muted-foreground">
						Answer as a student would. Correctness is scored on the server.
					</p>
				</div>
				<McqAttempt questionId={id} />
			</main>
		</div>
	);
}
