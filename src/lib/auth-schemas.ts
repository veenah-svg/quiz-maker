import { z } from "zod";

const passwordHash = z
	.string()
	.regex(
		/^[0-9a-f]{64}$/,
		"passwordHash must be a 64-character hex SHA-256 digest",
	);

export const registerBodySchema = z.object({
	firstName: z.string().trim().min(1, "firstName is required"),
	lastName: z.string().trim().min(1, "lastName is required"),
	username: z.string().trim().min(1, "username is required"),
	email: z.email("email must be a valid email address"),
	passwordHash,
});

export const loginBodySchema = z.object({
	username: z.string().trim().min(1, "username is required"),
	passwordHash,
});

export function firstZodMessage(error: z.ZodError): string {
	return error.issues[0]?.message ?? "Invalid request";
}
