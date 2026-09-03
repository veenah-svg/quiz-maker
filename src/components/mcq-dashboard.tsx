"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	deleteQuestionAction,
	listQuestionsAction,
} from "@/app/mcqs/actions";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type ListResult = Awaited<ReturnType<typeof listQuestionsAction>>;
type Question = Extract<ListResult, { ok: true }>["data"][number];

export function McqDashboard() {
	const router = useRouter();
	const routerRef = useRef(router);

	useEffect(() => {
		routerRef.current = router;
	}, [router]);
	const [questions, setQuestions] = useState<Question[]>([]);
	const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
	const [error, setError] = useState<string | null>(null);
	const [preview, setPreview] = useState<Question | null>(null);
	const [pendingDelete, setPendingDelete] = useState<Question | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [deleting, setDeleting] = useState(false);

	useEffect(() => {
		let cancelled = false;

		async function load() {
			const result = await listQuestionsAction();
			if (cancelled) {
				return;
			}

			if (!result.ok) {
				if (result.code === "unauthorized") {
					routerRef.current.push("/login");
					return;
				}

				setStatus("error");
				setError(result.error);
				return;
			}

			setQuestions(result.data);
			setStatus("ready");
			setError(null);
		}

		void load();

		return () => {
			cancelled = true;
		};
	}, []);

	async function confirmDelete() {
		const target = pendingDelete;
		if (!target) {
			return;
		}

		setDeleting(true);
		setDeleteError(null);
		const result = await deleteQuestionAction(target.id);
		setDeleting(false);

		if (!result.ok) {
			if (result.code === "unauthorized") {
				routerRef.current.push("/login");
				return;
			}

			setDeleteError(result.error);
			return;
		}

		setQuestions((current) =>
			current.filter((question) => question.id !== target.id),
		);
		setPendingDelete(null);
	}

	return (
		<Card>
			<CardHeader className="border-b">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="flex flex-col gap-1">
						<CardTitle>Questions</CardTitle>
						<CardDescription>
							Shared bank. Any teacher can read; only the owner can edit or
							delete.
						</CardDescription>
					</div>
					<Link href="/mcqs/new" className={cn(buttonVariants())}>
						Create question
					</Link>
				</div>
			</CardHeader>
			<CardContent>
				{status === "loading" ? (
					<p className="text-sm text-muted-foreground">Loading questions…</p>
				) : null}

				{status === "error" && error ? (
					<p className="text-sm text-destructive" role="alert">
						{error}
					</p>
				) : null}

				{status === "ready" && questions.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						No questions yet. Create the first one to start the bank.
					</p>
				) : null}

				{status === "ready" && questions.length > 0 ? (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Question</TableHead>
								<TableHead>Choices</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{questions.map((question) => (
								<TableRow key={question.id}>
									<TableCell className="max-w-md whitespace-normal font-medium">
										{question.stem}
									</TableCell>
									<TableCell>{question.choices.length}</TableCell>
									<TableCell className="text-right">
										<div className="flex justify-end gap-1">
											<Link
												href={`/mcqs/${question.id}/edit`}
												className={cn(
													buttonVariants({ variant: "ghost", size: "sm" }),
												)}
											>
												Edit
											</Link>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												onClick={() => setPreview(question)}
											>
												Preview
											</Button>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												onClick={() => {
													setDeleteError(null);
													setPendingDelete(question);
												}}
											>
												Delete
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				) : null}
			</CardContent>

			<Dialog
				open={preview !== null}
				onOpenChange={(open) => {
					if (!open) {
						setPreview(null);
					}
				}}
			>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>Preview question</DialogTitle>
						<DialogDescription>
							Choices are shown in stored order. The correct choice is marked.
						</DialogDescription>
					</DialogHeader>
					{preview ? (
						<div className="flex flex-col gap-3">
							<p className="font-medium">{preview.stem}</p>
							<ol className="flex list-decimal flex-col gap-2 pl-5">
								{preview.choices.map((choice) => (
									<li key={choice.id} className="flex items-center gap-2">
										<span>{choice.label}</span>
										{choice.isCorrect ? <Badge>Correct</Badge> : null}
									</li>
								))}
							</ol>
						</div>
					) : null}
				</DialogContent>
			</Dialog>

			<Dialog
				open={pendingDelete !== null}
				onOpenChange={(open) => {
					if (!open) {
						setPendingDelete(null);
						setDeleteError(null);
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete question</DialogTitle>
						<DialogDescription>
							This cannot be undone. The question and its choices will be
							removed.
						</DialogDescription>
					</DialogHeader>
					{deleteError ? (
						<p className="text-sm text-destructive" role="alert">
							{deleteError}
						</p>
					) : null}
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => {
								setPendingDelete(null);
								setDeleteError(null);
							}}
						>
							Cancel
						</Button>
						<Button
							type="button"
							variant="destructive"
							disabled={deleting}
							onClick={() => {
								void confirmDelete();
							}}
						>
							Confirm delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Card>
	);
}
