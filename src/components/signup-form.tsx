"use client";

import { useState, type ComponentProps, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { hashPassword } from "@/lib/password";
import { Button } from "@/components/ui/button";
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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignupForm({ ...props }: ComponentProps<typeof Card>) {
	const router = useRouter();
	const [firstName, setFirstName] = useState("");
	const [lastName, setLastName] = useState("");
	const [username, setUsername] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError("");

		if (
			!firstName.trim() ||
			!lastName.trim() ||
			!username.trim() ||
			!email.trim() ||
			!password ||
			!confirmPassword
		) {
			setError("All fields are required");
			return;
		}

		if (!EMAIL_PATTERN.test(email.trim())) {
			setError("Enter a valid email address");
			return;
		}

		if (password.length < 8) {
			setError("Password must be at least 8 characters long");
			return;
		}

		if (password !== confirmPassword) {
			setError("Passwords do not match");
			return;
		}

		setPending(true);
		try {
			const passwordHash = await hashPassword(password);
			const response = await fetch("/api/register", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					firstName: firstName.trim(),
					lastName: lastName.trim(),
					username: username.trim(),
					email: email.trim(),
					passwordHash,
				}),
			});
			const payload = (await response.json().catch(() => ({}))) as {
				error?: string;
			};

			if (!response.ok) {
				setError(payload.error ?? "Unable to create account");
				return;
			}

			router.push("/mcqs");
		} catch {
			setError("Unable to create account");
		} finally {
			setPending(false);
		}
	}

	return (
		<Card {...props}>
			<CardHeader>
				<CardTitle>Create an account</CardTitle>
				<CardDescription>
					Enter your information below to create your account
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={handleSubmit}>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor="first-name">First name</FieldLabel>
							<Input
								id="first-name"
								type="text"
								autoComplete="given-name"
								placeholder="Ada"
								value={firstName}
								onChange={(event) => setFirstName(event.target.value)}
								required
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="last-name">Last name</FieldLabel>
							<Input
								id="last-name"
								type="text"
								autoComplete="family-name"
								placeholder="Lovelace"
								value={lastName}
								onChange={(event) => setLastName(event.target.value)}
								required
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="username">Username</FieldLabel>
							<Input
								id="username"
								type="text"
								autoComplete="username"
								value={username}
								onChange={(event) => setUsername(event.target.value)}
								required
							/>
							<FieldDescription>
								Username and email may be the same.
							</FieldDescription>
						</Field>
						<Field>
							<FieldLabel htmlFor="email">Email</FieldLabel>
							<Input
								id="email"
								type="email"
								autoComplete="email"
								placeholder="m@example.com"
								value={email}
								onChange={(event) => setEmail(event.target.value)}
								required
							/>
							<FieldDescription>
								We&apos;ll use this to contact you. We will not share your email
								with anyone else.
							</FieldDescription>
						</Field>
						<Field>
							<FieldLabel htmlFor="password">Password</FieldLabel>
							<Input
								id="password"
								type="password"
								autoComplete="new-password"
								value={password}
								onChange={(event) => setPassword(event.target.value)}
								required
							/>
							<FieldDescription>
								Must be at least 8 characters long.
							</FieldDescription>
						</Field>
						<Field>
							<FieldLabel htmlFor="confirm-password">Confirm Password</FieldLabel>
							<Input
								id="confirm-password"
								type="password"
								autoComplete="new-password"
								value={confirmPassword}
								onChange={(event) => setConfirmPassword(event.target.value)}
								required
							/>
							<FieldDescription>Please confirm your password.</FieldDescription>
						</Field>
						{error ? <FieldError errors={[{ message: error }]} /> : null}
						<FieldGroup>
							<Field>
								<Button type="submit" disabled={pending}>
									Create Account
								</Button>
								<FieldDescription className="px-6 text-center">
									Already have an account? <Link href="/login">Sign in</Link>
								</FieldDescription>
							</Field>
						</FieldGroup>
					</FieldGroup>
				</form>
			</CardContent>
		</Card>
	);
}
