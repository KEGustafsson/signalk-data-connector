const { encrypt, decrypt } = require("../crypto");

describe("Crypto Module", () => {
  const validSecretKey = "12345678901234567890123456789012"; // 32 characters
  const testData = "Hello, World!";

  describe("encrypt", () => {
    test("should encrypt data successfully with valid inputs", () => {
      const result = encrypt(testData, validSecretKey);

      expect(result).toHaveProperty("iv");
      expect(result).toHaveProperty("content");
      expect(result.iv).toHaveLength(32); // 16 bytes = 32 hex chars
      expect(result.content).toBeTruthy();
      expect(typeof result.iv).toBe("string");
      expect(typeof result.content).toBe("string");
    });

    test("should generate unique IV for each encryption", () => {
      const result1 = encrypt(testData, validSecretKey);
      const result2 = encrypt(testData, validSecretKey);

      // IVs should be different
      expect(result1.iv).not.toBe(result2.iv);
      // Encrypted content should be different
      expect(result1.content).not.toBe(result2.content);
    });

    test("should accept Buffer as input", () => {
      const buffer = Buffer.from(testData, "utf8");
      const result = encrypt(buffer, validSecretKey);

      expect(result).toHaveProperty("iv");
      expect(result).toHaveProperty("content");
    });

    test("should throw error if secret key is not 32 characters", () => {
      expect(() => encrypt(testData, "short")).toThrow("Secret key must be exactly 32 characters");
      expect(() => encrypt(testData, "123456789012345678901234567890123")).toThrow(
        "Secret key must be exactly 32 characters"
      );
    });

    test("should throw error if secret key is missing", () => {
      expect(() => encrypt(testData, null)).toThrow("Secret key must be exactly 32 characters");
      expect(() => encrypt(testData, undefined)).toThrow(
        "Secret key must be exactly 32 characters"
      );
      expect(() => encrypt(testData, "")).toThrow("Secret key must be exactly 32 characters");
    });

    test("should throw error if text is empty", () => {
      expect(() => encrypt("", validSecretKey)).toThrow("Text to encrypt cannot be empty");
      expect(() => encrypt(Buffer.alloc(0), validSecretKey)).toThrow(
        "Text to encrypt cannot be empty"
      );
    });

    test("should throw error if text is null or undefined", () => {
      expect(() => encrypt(null, validSecretKey)).toThrow("Text to encrypt cannot be empty");
      expect(() => encrypt(undefined, validSecretKey)).toThrow("Text to encrypt cannot be empty");
    });
  });

  describe("decrypt", () => {
    test("should decrypt data successfully", () => {
      const encrypted = encrypt(testData, validSecretKey);
      const decrypted = decrypt(encrypted, validSecretKey);

      expect(decrypted.toString()).toBe(testData);
    });

    test("should decrypt complex JSON data", () => {
      const complexData = JSON.stringify({
        name: "Test",
        value: 123,
        nested: { key: "value" }
      });

      const encrypted = encrypt(complexData, validSecretKey);
      const decrypted = decrypt(encrypted, validSecretKey);

      expect(decrypted.toString()).toBe(complexData);
      expect(JSON.parse(decrypted.toString())).toEqual({
        name: "Test",
        value: 123,
        nested: { key: "value" }
      });
    });

    test("should throw error if secret key is invalid", () => {
      const encrypted = encrypt(testData, validSecretKey);

      expect(() => decrypt(encrypted, "wrong")).toThrow("Secret key must be exactly 32 characters");
      expect(() => decrypt(encrypted, null)).toThrow("Secret key must be exactly 32 characters");
    });

    test("should throw error if hash structure is invalid", () => {
      expect(() => decrypt(null, validSecretKey)).toThrow("Invalid encrypted data structure");
      expect(() => decrypt({}, validSecretKey)).toThrow("Invalid encrypted data structure");
      expect(() => decrypt({ iv: "only" }, validSecretKey)).toThrow(
        "Invalid encrypted data structure"
      );
      expect(() => decrypt({ content: "only" }, validSecretKey)).toThrow(
        "Invalid encrypted data structure"
      );
    });

    test("should fail to decrypt with wrong key", () => {
      const encrypted = encrypt(testData, validSecretKey);
      const wrongKey = "wrongkey12345678901234567890123";

      // Should throw or return garbage (depending on implementation)
      expect(() => decrypt(encrypted, wrongKey)).toThrow();
    });
  });

  describe("encrypt/decrypt round-trip", () => {
    test("should handle empty strings after trim", () => {
      const data = "Some text with spaces   ";
      const encrypted = encrypt(data, validSecretKey);
      const decrypted = decrypt(encrypted, validSecretKey);

      expect(decrypted.toString()).toBe(data);
    });

    test("should handle special characters", () => {
      const specialChars = "!@#$%^&*()_+-=[]{}|;:'\",.<>?/~`";
      const encrypted = encrypt(specialChars, validSecretKey);
      const decrypted = decrypt(encrypted, validSecretKey);

      expect(decrypted.toString()).toBe(specialChars);
    });

    test("should handle unicode characters", () => {
      const unicode = "Hello 世界 🌍 Ñoño";
      const encrypted = encrypt(unicode, validSecretKey);
      const decrypted = decrypt(encrypted, validSecretKey);

      expect(decrypted.toString()).toBe(unicode);
    });

    test("should handle large data", () => {
      const largeData = "x".repeat(100000);
      const encrypted = encrypt(largeData, validSecretKey);
      const decrypted = decrypt(encrypted, validSecretKey);

      expect(decrypted.toString()).toBe(largeData);
    });
  });

  describe("Security", () => {
    test("should produce different ciphertext for same plaintext", () => {
      const results = [];
      for (let i = 0; i < 10; i++) {
        results.push(encrypt(testData, validSecretKey));
      }

      // All IVs should be unique
      const ivs = results.map((r) => r.iv);
      const uniqueIvs = new Set(ivs);
      expect(uniqueIvs.size).toBe(10);

      // All ciphertexts should be unique
      const contents = results.map((r) => r.content);
      const uniqueContents = new Set(contents);
      expect(uniqueContents.size).toBe(10);
    });
  });
});
