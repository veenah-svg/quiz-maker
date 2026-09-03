"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	createQuestionAction,
	getQuestionAction,
	updateQuestionAction,
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
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type DraftChoice = {
	key: string;
	label: string;
	isCorrect: boolean;
};

function newChoice(isCorrect: boolean): DraftChoice {
	return {
		key: crypto.randomUUID(),
		label: "",
		isCorrect,
	};
}

function defaultChoices(): DraftChoice[] {
	return [newChoice(true), newChoice(false)];
}

export function McqQuestionForm({
	mode,
	questionId,
}: {
	mode: "create" | "edit";
	questionId?: string;
}) {
	const router = useRouter();
	const routerRef = useRef(router);
	const formId = useId();

	useEffect(() => {
		routerRef.current = router;
	}, [router]);

	const [stem, setStem] = useState("");
	const [choices, setChoices] = useState<DraftChoice[]>(defaultChoices);
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);
	const [loadStatus, setLoadStatus] = useState<"idle" | "loading" | "error">(
		mode === "edit" ? "loading" : "idle",
	);

	useEffect(() => {
		if (mode !== "edit" || !questionId) {
			return;
		}

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

			setStem(result.data.stem);
			setChoices(
				result.data.choices.map((choice) => ({
					key: choice.id,
					label: choice.label,
					isCorrect: choice.isCorrect,
				})),
			);
			setLoadStatus("idle");
		}

		void load();

		return () => {
			cancelled = true;
		};
	}, [mode, questionId]);

	function setCorrect(key: string) {
		setChoices((current) =>
			current.map((choice) => ({
				...choice,
				isCorrect: choice.key === key,
			})),
		);
	}

	function addChoice() {
		if (choices.length >= 6) {
			return;
		}

		setChoices((current) => [...current, newChoice(false)]);
	}

	function removeChoice(key: string) {
		if (choices.length <= 2) {
			return;
		}

		setChoices((current) => {
			const next = current.filter((choice) => choice.key !== key);
			if (next.some((choice) => choice.isCorrect)) {
				return next;
			}

			return next.map((choice, index) => ({
				...choice,
				isCorrect: index === 0,
			}));
		});
	}

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError("");

		const trimmedStem = stem.trim();
		if (!trimmedStem) {
			setError("Question is required");
			return;
		}

		const payloadChoices = choices.map((choice) => ({
			label: choice.label.trim(),
			isCorrect: choice.isCorrect,
		}));

		if (payloadChoices.some((choice) => !choice.label)) {
			setError("Every choice needs a label");
			return;
		}

		if (payloadChoices.filter((choice) => choice.isCorrect).length !== 1) {
			setError("Exactly one choice must be correct");
			return;
		}

		setPending(true);
		try {
			const result =
				mode === "edit" && questionId
					? await updateQuestionAction(questionId, {
							stem: trimmedStem,
							choices: payloadChoices,
						})
					: await createQuestionAction({
							stem: trimmedStem,
							choices: payloadChoices,
						});

			if (!result.ok) {
				if (result.code === "unauthorized") {
					routerRef.current.push("/login");
					return;
				}

				setError(result.error);
				return;
			}

			routerRef.current.push("/mcqs");
		} finally {
			setPending(false);
		}
	}

	if (loadStatus === "loading") {
		return <p className="text-sm text-muted-foreground">Loading question…</p>;
	}

	if (loadStatus === "error") {
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
				<CardTitle>
					{mode === "edit" ? "Edit question" : "New question"}
				</CardTitle>
				<CardDescription>
					Two to six choices. Mark exactly one as correct.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={handleSubmit}>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor={`${formId}-stem`}>Question</FieldLabel>
							<Input
								id={`${formId}-stem`}
								value={stem}
								onChange={(event) => setStem(event.target.value)}
							/>
							<FieldDescription>
								The prompt teachers will see.
							</FieldDescription>
						</Field>

						{choices.map((choice, index) => {
							const number = index + 1;
							const labelId = `${formId}-choice-${index}`;
							const radioId = `${formId}-correct-${index}`;

							return (
								<Field key={choice.key} orientation="responsive">
									<FieldLabel htmlFor={labelId}>Choice {number}</FieldLabel>
									<Input
										id={labelId}
										value={choice.label}
										onChange={(event) => {
											const label = event.target.value;
											setChoices((current) =>
												current.map((item) =>
													item.key === choice.key ? { ...item, label } : item,
												),
											);
										}}
									/>
									<div className="flex items-center gap-3">
										<label
											htmlFor={radioId}
											className="flex items-center gap-2 text-sm"
										>
											<input
												id={radioId}
												type="radio"
												name={`${formId}-correct`}
												checked={choice.isCorrect}
												onChange={() => setCorrect(choice.key)}
												aria-label={`Mark choice ${number} as correct`}
											/>
											Correct
										</label>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											disabled={choices.length <= 2}
											onClick={() => removeChoice(choice.key)}
										>
											Remove choice {number}
										</Button>
									</div>
								</Field>
							);
						})}

						<Field>
							<Button
								type="button"
								variant="outline"
								disabled={choices.length >= 6}
								onClick={addChoice}
							>
								Add choice
							</Button>
						</Field>

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
								Cancel
							</Link>
							<Button type="submit" disabled={pending}>
								{pending ? "Saving…" : "Save question"}
							</Button>
						</Field>
					</FieldGroup>
				</form>
			</CardContent>
		</Card>
	);
}
