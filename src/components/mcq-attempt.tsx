"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	checkQuestionAttemptAction,
	getQuestionAction,
} from "@/app/mcqs/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@/components/ui/field";
import { cn } from "@/lib/utils";

type PromptChoice = {
	id: string;
	label: string;
};

type Prompt = {
	stem: string;
	choices: PromptChoice[];
};

type RecordedAttempt = {
	choiceId: string;
	isCorrect: boolean;
};

export function McqAttempt({ questionId }: { questionId: string }) {
	const router = useRouter();
	const routerRef = useRef(router);
	const formId = useId();

	useEffect(() => {
		routerRef.current = router;
	}, [router]);

	const [prompt, setPrompt] = useState<Prompt | null>(null);
	const [selectedChoiceId, setSelectedChoiceId] = useState("");
	const [attempt, setAttempt] = useState<RecordedAttempt | null>(null);
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);
	const [loadStatus, setLoadStatus] = useState<"loading" | "idle" | "error">(
		"loading",
	);

	useEffect(() => {
		let cancelled = false;

		async function load() {
			const result = await getQuestionAction(questionId);
			if (cancelled) {
				return;
			}

			if (!result.ok) {
				if (result.code === "unauthorized") {
					routerRef.current.push("/login");
					return;
				}

				setError(result.error);
				setLoadStatus("error");
				return;
			}

			setPrompt({
				stem: result.data.stem,
				choices: result.data.choices.map((choice) => ({
					id: choice.id,
					label: choice.label,
				})),
			});
			setLoadStatus("idle");
		}

		void load();

		return () => {
			cancelled = true;
		};
	}, [questionId]);

	function tryAgain() {
		setSelectedChoiceId("");
		setAttempt(null);
		setError("");
	}

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError("");

		if (!selectedChoiceId) {
			setError("Choose an answer");
			return;
		}

		setPending(true);
		try {
			const result = await checkQuestionAttemptAction({
				questionId,
				choiceId: selectedChoiceId,
			});

			if (!result.ok) {
				if (result.code === "unauthorized") {
					routerRef.current.push("/login");
					return;
				}

				setError(result.error);
				return;
			}

			setAttempt({
				choiceId: result.data.choiceId,
				isCorrect: result.data.isCorrect,
			});
		} finally {
			setPending(false);
		}
	}

	if (loadStatus === "loading") {
		return <p className="text-sm text-muted-foreground">Loading question…</p>;
	}

	if (loadStatus === "error" || !prompt) {
		return (
			<div className="flex flex-col gap-4">
				<p className="text-sm text-destructive" role="alert">
					{error}
				</p>
				<Link href="/mcqs" className={cn(buttonVariants({ variant: "outline" }))}>
					Back to question bank
				</Link>
			</div>
		);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Try this question</CardTitle>
				<CardDescription>
					Pick one choice. The server decides whether it is correct.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={handleSubmit}>
					<FieldGroup>
						<p className="font-medium">{prompt.stem}</p>

						<Field>
							{prompt.choices.map((choice) => {
								const radioId = `${formId}-${choice.id}`;

								return (
									<FieldLabel
										key={choice.id}
										htmlFor={radioId}
										className="flex items-center gap-2 font-normal"
									>
										<input
											id={radioId}
											type="radio"
											name={`${formId}-choice`}
											value={choice.id}
											checked={selectedChoiceId === choice.id}
											disabled={attempt !== null}
											onChange={() => setSelectedChoiceId(choice.id)}
										/>
										{choice.label}
									</FieldLabel>
								);
							})}
						</Field>

						{attempt ? (
							<p role="status" className="text-sm font-medium">
								{attempt.isCorrect ? "Correct" : "Incorrect"}
							</p>
						) : null}

						{error ? (
							<Field>
								<FieldError errors={[{ message: error }]} />
							</Field>
						) : null}

						<Field orientation="horizontal">
							<Link
								href="/mcqs"
								className={cn(buttonVariants({ variant: "outline" }))}
							>
								Back to question bank
							</Link>
							{attempt ? (
								<Button type="button" onClick={tryAgain}>
									Try again
								</Button>
							) : (
								<Button type="submit" disabled={pending}>
									{pending ? "Checking…" : "Check answer"}
								</Button>
							)}
						</Field>
					</FieldGroup>
				</form>
			</CardContent>
		</Card>
	);
}
