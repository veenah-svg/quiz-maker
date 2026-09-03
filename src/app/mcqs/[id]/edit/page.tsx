import { McqQuestionForm } from "@/components/mcq-question-form";

export default async function EditQuestionPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;

	return (
		<div className="flex min-h-svh w-full justify-center p-6 md:p-10">
			<main className="flex w-full max-w-lg flex-col gap-6">
				<div className="flex flex-col gap-2">
					<h1 className="text-2xl font-semibold tracking-tight">Edit question</h1>
					<p className="text-sm text-muted-foreground">
						Update the prompt and choices. Only the owner can save.
					</p>
				</div>
				<McqQuestionForm mode="edit" questionId={id} />
			</main>
		</div>
	);
}
