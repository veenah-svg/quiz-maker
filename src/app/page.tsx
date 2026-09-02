import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Home() {
	return (
		<div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
			<main className="flex w-full max-w-sm flex-col gap-6 text-center">
				<div className="flex flex-col gap-2">
					<h1 className="text-2xl font-semibold tracking-tight">Quiz Maker</h1>
					<p className="text-sm text-muted-foreground">
						A shared test bank for teachers. Register or log in to continue.
					</p>
				</div>
				<div className="flex flex-col gap-3">
					<Link href="/register" className={cn(buttonVariants())}>
						Register
					</Link>
					<Link
						href="/login"
						className={cn(buttonVariants({ variant: "outline" }))}
					>
						Log in
					</Link>
				</div>
			</main>
		</div>
	);
}
