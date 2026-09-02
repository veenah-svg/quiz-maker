import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("home landing", () => {
	it("links to register and login", () => {
		render(<Home />);

		const register = screen.getByRole("link", { name: /register/i });
		const login = screen.getByRole("link", { name: /log in/i });

		expect(register).toHaveAttribute("href", "/register");
		expect(login).toHaveAttribute("href", "/login");
	});
});
