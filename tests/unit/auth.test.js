const auth = require("../../services/auth");

// Low-cost parameters keep the suite fast; verifyPassword reads the parameters
// back out of the stored hash, so these hashes verify like production ones.
const FAST = { N: 1024, r: 8, p: 1 };

describe("services/auth", () => {
  describe("hashPassword / verifyPassword", () => {
    it("uses production scrypt parameters by default", async () => {
      const hash = await auth.hashPassword("correct horse battery");
      const [scheme, N, r, p] = hash.split("$");
      expect(scheme).toBe("scrypt");
      expect(Number(N)).toBe(auth.SCRYPT_PARAMS.N);
      expect(Number(r)).toBe(auth.SCRYPT_PARAMS.r);
      expect(Number(p)).toBe(auth.SCRYPT_PARAMS.p);
    });

    it("verifies the correct password", async () => {
      const hash = await auth.hashPassword("correct horse battery", FAST);
      expect(await auth.verifyPassword("correct horse battery", hash)).toBe(true);
    });

    it("rejects a wrong password", async () => {
      const hash = await auth.hashPassword("correct horse battery", FAST);
      expect(await auth.verifyPassword("correct horse batterY", hash)).toBe(false);
    });

    it("salts each hash so equal passwords hash differently", async () => {
      const a = await auth.hashPassword("same password", FAST);
      const b = await auth.hashPassword("same password", FAST);
      expect(a).not.toBe(b);
    });

    it("never stores the plaintext password", async () => {
      const hash = await auth.hashPassword("plaintext-canary", FAST);
      expect(hash).not.toContain("plaintext-canary");
    });

    it("rejects a tampered hash", async () => {
      const hash = await auth.hashPassword("correct horse battery", FAST);
      const parts = hash.split("$");
      const key = Buffer.from(parts[5], "base64");
      key[0] ^= 0xff;
      parts[5] = key.toString("base64");
      expect(await auth.verifyPassword("correct horse battery", parts.join("$"))).toBe(false);
    });

    it.each([
      [null],
      [undefined],
      [""],
      ["not-a-hash"],
      ["bcrypt$1$2$3$4$5"],
      ["scrypt$abc$8$1$c2FsdA==$a2V5"],
    ])("returns false for missing or malformed stored hash %p", async (stored) => {
      expect(await auth.verifyPassword("anything", stored)).toBe(false);
    });
  });

  describe("isValidUsername", () => {
    it.each(["villahousut", "a", "user_name-1", "x".repeat(32)])("accepts %p", (name) => {
      expect(auth.isValidUsername(name)).toBe(true);
    });

    it.each(["", "x".repeat(33), "user<script>", "has space", null, undefined, 42, ["a"]])(
      "rejects %p",
      (name) => {
        expect(auth.isValidUsername(name)).toBe(false);
      }
    );
  });

  describe("isValidNewPassword", () => {
    it("accepts passwords within the length bounds", () => {
      expect(auth.isValidNewPassword("x".repeat(auth.MIN_PASSWORD_LENGTH))).toBe(true);
      expect(auth.isValidNewPassword("x".repeat(auth.MAX_PASSWORD_LENGTH))).toBe(true);
    });

    it("rejects too short, too long, or non-string passwords", () => {
      expect(auth.isValidNewPassword("x".repeat(auth.MIN_PASSWORD_LENGTH - 1))).toBe(false);
      expect(auth.isValidNewPassword("x".repeat(auth.MAX_PASSWORD_LENGTH + 1))).toBe(false);
      expect(auth.isValidNewPassword(undefined)).toBe(false);
      expect(auth.isValidNewPassword(12345678)).toBe(false);
    });
  });
});
