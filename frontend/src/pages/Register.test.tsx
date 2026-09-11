import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Register } from "./Register.js";
import { AuthProvider } from "../hooks/useAuth.js";
import { ApiError } from "../services/apiClient.js";
import * as authApi from "../services/authApi.js";

vi.mock("../services/authApi.js");

const mockedAuthApi = vi.mocked(authApi);

function renderRegister() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <Register />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // The AuthProvider always calls meRequest() on mount; default it to
  // "not logged in" so it doesn't interfere with the register flow.
  mockedAuthApi.meRequest.mockRejectedValue(new ApiError(401, "UNAUTHENTICATED", "nope"));
});

describe("Register page", () => {
  it("shows client-side validation errors without calling the API", async () => {
    renderRegister();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Password must be at least 10 characters.")).toBeInTheDocument();
    expect(mockedAuthApi.registerRequest).not.toHaveBeenCalled();
  });

  it("submits valid input and calls the register API", async () => {
    mockedAuthApi.registerRequest.mockResolvedValue({
      user: { id: "1", email: "new@example.com", name: null, createdAt: new Date().toISOString() },
    });
    renderRegister();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(mockedAuthApi.registerRequest).toHaveBeenCalledWith({
      email: "new@example.com",
      password: "correct-horse-battery",
      name: undefined,
    });
  });

  it("shows the server error message when the API rejects (e.g. duplicate email)", async () => {
    mockedAuthApi.registerRequest.mockRejectedValue(
      new ApiError(409, "EMAIL_TAKEN", "An account with this email already exists"),
    );
    renderRegister();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Email"), "taken@example.com");
    await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByText("An account with this email already exists"),
    ).toBeInTheDocument();
  });
});
