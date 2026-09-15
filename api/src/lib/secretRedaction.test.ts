import { describe, expect, it } from "vitest";
import { redactSecrets, REDACTED_PLACEHOLDER } from "./secretRedaction.js";

describe("redactSecrets", () => {
  it("redacts an AWS access key id", () => {
    const input = 'const key = "AKIAIOSFODNN7EXAMPLE";';
    expect(redactSecrets(input)).toBe(`const key = "${REDACTED_PLACEHOLDER}";`);
  });

  it("redacts a GitHub personal access token", () => {
    const input = "GITHUB_TOKEN=ghp_1234567890abcdefghij1234567890abcdEF";
    expect(redactSecrets(input)).toContain(REDACTED_PLACEHOLDER);
    expect(redactSecrets(input)).not.toContain("ghp_1234567890");
  });

  it("redacts an Anthropic-shaped API key", () => {
    const input = "ANTHROPIC_API_KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'";
    expect(redactSecrets(input)).not.toContain("sk-ant-");
    expect(redactSecrets(input)).toContain(REDACTED_PLACEHOLDER);
  });

  it("redacts a PEM private key block", () => {
    const input =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA1c7+9z5Pad7OejecsQ0bu3aumnAxA5mkwd7rOB3\n-----END RSA PRIVATE KEY-----";
    const result = redactSecrets(input);
    expect(result).toBe(REDACTED_PLACEHOLDER);
    expect(result).not.toContain("MIIEpAIBAAKCAQEA");
  });

  it("redacts a JWT-shaped string", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const input = `const token = "${jwt}";`;
    expect(redactSecrets(input)).toBe(`const token = "${REDACTED_PLACEHOLDER}";`);
  });

  it("redacts a credential-embedded connection string URL", () => {
    const input = "DATABASE_URL=postgresql://devforge:s3cr3tpass@db.example.com:5432/prod";
    const result = redactSecrets(input);
    expect(result).not.toContain("s3cr3tpass");
    expect(result).toContain(REDACTED_PLACEHOLDER);
  });

  it("leaves ordinary source code completely unchanged", () => {
    const input = `export function add(a: number, b: number): number {\n  return a + b;\n}`;
    expect(redactSecrets(input)).toBe(input);
  });

  it("does not falsely flag ordinary variable names containing the word 'password' or 'token' with no secret value", () => {
    const input = `function validatePassword(password: string): boolean {\n  return password.length >= 8;\n}\n\ninterface AuthToken {\n  token: string;\n  expiresAt: Date;\n}`;
    expect(redactSecrets(input)).toBe(input);
  });

  it("redacts multiple distinct secrets in the same chunk", () => {
    const input = `const awsKey = "AKIAIOSFODNN7EXAMPLE";\nconst ghToken = "ghp_1234567890abcdefghij1234567890abcdEF";`;
    const result = redactSecrets(input);
    expect(result).not.toContain("AKIA");
    expect(result).not.toContain("ghp_");
    expect(result.match(new RegExp(REDACTED_PLACEHOLDER.replace(/[[\]]/g, "\\$&"), "g"))).toHaveLength(2);
  });
});
