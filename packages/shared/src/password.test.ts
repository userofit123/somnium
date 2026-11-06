import { describe, it, expect } from "vitest";
import { passwordProblem, PASSWORD_MIN } from "./password";

describe("password rules", () => {
  it("wants 10 characters and refuses the most common passwords, whatever their case", async () => {
    expect(await passwordProblem("short")).toContain(String(PASSWORD_MIN));
    expect(await passwordProblem("qwertyuiop")).not.toBeNull();
    expect(await passwordProblem("QWERTYUIOP ")).not.toBeNull();
    expect(await passwordProblem("1234567890")).not.toBeNull();
    expect(await passwordProblem("correct horse battery")).toBeNull();
    expect(await passwordProblem("demo-password-1")).toBeNull();
  });
});
