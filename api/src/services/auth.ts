import { prisma } from "../lib/prisma.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { generateSessionToken, hashSessionToken, SESSION_TTL_MS } from "../lib/sessionToken.js";
import { AppError } from "../lib/errors.js";
import { logAuditEvent } from "../lib/auditLog.js";
import type { LoginInput, RegisterInput } from "../schemas/auth.js";

export type SafeUser = {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
};

function toSafeUser(user: { id: string; email: string; name: string | null; createdAt: Date }): SafeUser {
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };
}

export async function registerUser(
  input: RegisterInput,
): Promise<{ user: SafeUser; sessionToken: string; expiresAt: Date }> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw AppError.conflict("EMAIL_TAKEN", "An account with this email already exists");
  }

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: { email: input.email, passwordHash, name: input.name ?? null },
  });

  const { sessionToken, expiresAt } = await createSession(user.id);
  logAuditEvent({ event: "auth.register", userId: user.id });
  return { user: toSafeUser(user), sessionToken, expiresAt };
}

export async function loginUser(
  input: LoginInput,
): Promise<{ user: SafeUser; sessionToken: string; expiresAt: Date }> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Deliberately identical error for "no such user" and "wrong password" so
  // the response can't be used to enumerate registered email addresses. Uses
  // its own INVALID_CREDENTIALS code, distinct from the UNAUTHENTICATED code
  // requireAuth uses for "no/invalid session" on protected routes.
  const invalidCredentials = () => {
    logAuditEvent({ event: "auth.login_failure" });
    return new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  };

  if (!user) {
    throw invalidCredentials();
  }

  const passwordValid = await verifyPassword(input.password, user.passwordHash);
  if (!passwordValid) {
    throw invalidCredentials();
  }

  const { sessionToken, expiresAt } = await createSession(user.id);
  logAuditEvent({ event: "auth.login_success", userId: user.id });
  return { user: toSafeUser(user), sessionToken, expiresAt };
}

export async function createSession(
  userId: string,
): Promise<{ sessionToken: string; expiresAt: Date }> {
  const sessionToken = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: { userId, tokenHash: hashSessionToken(sessionToken), expiresAt },
  });

  return { sessionToken, expiresAt };
}

export async function getUserForSessionToken(sessionToken: string): Promise<SafeUser | null> {
  const tokenHash = hashSessionToken(sessionToken);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session || session.expiresAt < new Date()) {
    return null;
  }

  return toSafeUser(session.user);
}

export async function deleteSessionByToken(sessionToken: string): Promise<void> {
  const tokenHash = hashSessionToken(sessionToken);
  // deleteMany (not delete) so logging out an already-invalid/expired token
  // is a harmless no-op instead of throwing a "record not found" error.
  await prisma.session.deleteMany({ where: { tokenHash } });
}
