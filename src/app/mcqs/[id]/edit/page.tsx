import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function EditQuestionPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;

	return (
		<div className="flex min-h-svh w-full justify-center p-6 md:p-10">
			<main className="flex w-full max-w-lg flex-col gap-4">
				<h1 className="text-2xl font-semibold tracking-tight">Edit question</h1>
				<p className="text-sm text-muted-foreground">
					Editing {id} ships in a later phase.
				</p>
				<Link href="/mcqs" className={cn(buttonVariants({ variant: "outline" }))}>
					Back to question bank
				</Link>
			</main>
		</div>
	);
}
