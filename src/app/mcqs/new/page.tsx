import { McqQuestionForm } from "@/components/mcq-question-form";

export default function NewQuestionPage() {
	return (
		<div className="flex min-h-svh w-full justify-center p-6 md:p-10">
			<main className="flex w-full max-w-lg flex-col gap-6">
				<div className="flex flex-col gap-2">
					<h1 className="text-2xl font-semibold tracking-tight">Create question</h1>
					<p className="text-sm text-muted-foreground">
						Add a prompt and two to six choices for the shared bank.
					</p>
				</div>
				<McqQuestionForm mode="create" />
			</main>
		</div>
	);
}
