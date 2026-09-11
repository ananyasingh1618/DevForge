import { apiRequest } from "./apiClient.js";
import type { User } from "../types/user.js";

export function registerRequest(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<{ user: User }> {
  return apiRequest("/auth/register", { method: "POST", body: JSON.stringify(input) });
}

export function loginRequest(input: { email: string; password: string }): Promise<{ user: User }> {
  return apiRequest("/auth/login", { method: "POST", body: JSON.stringify(input) });
}

export function logoutRequest(): Promise<void> {
  return apiRequest("/auth/logout", { method: "POST" });
}

export function meRequest(): Promise<{ user: User }> {
  return apiRequest("/auth/me");
}
