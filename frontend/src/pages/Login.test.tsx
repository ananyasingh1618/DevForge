import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Login } from "./Login.js";
import { AuthProvider } from "../hooks/useAuth.js";
import { ApiError } from "../services/apiClient.js";
import * as authApi from "../services/authApi.js";

vi.mock("../services/authApi.js");

const mockedAuthApi = vi.mocked(authApi);

function renderLogin() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <Login />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAuthApi.meRequest.mockRejectedValue(new ApiError(401, "UNAUTHENTICATED", "nope"));
});

describe("Login page", () => {
  it("submits credentials and calls the login API", async () => {
    mockedAuthApi.loginRequest.mockResolvedValue({
      user: { id: "1", email: "me@example.com", name: null, createdAt: new Date().toISOString() },
    });
    renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Email"), "me@example.com");
    await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(mockedAuthApi.loginRequest).toHaveBeenCalledWith({
      email: "me@example.com",
      password: "correct-horse-battery",
    });
  });

  it("shows the server error message for invalid credentials", async () => {
    mockedAuthApi.loginRequest.mockRejectedValue(
      new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password"),
    );
    renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Email"), "me@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText("Invalid email or password")).toBeInTheDocument();
  });

  it("disables the submit button while the request is in flight", async () => {
    let resolveLogin!: (value: { user: import("../types/user.js").User }) => void;
    mockedAuthApi.loginRequest.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLogin = resolve;
        }),
    );
    renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Email"), "me@example.com");
    await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(screen.getByRole("button", { name: "Log in" })).toBeDisabled();

    resolveLogin({
      user: { id: "1", email: "me@example.com", name: null, createdAt: new Date().toISOString() },
    });
  });
});
