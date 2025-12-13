const { encrypt, decrypt, createHmac, verifyHmac, HMAC_SIZE } = require("../crypto");

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

  describe("HMAC", () => {
    describe("HMAC_SIZE constant", () => {
      test("should be 32 bytes (SHA-256)", () => {
        expect(HMAC_SIZE).toBe(32);
      });
    });

    describe("createHmac", () => {
      test("should create 32-byte HMAC for valid data", () => {
        const data = Buffer.from("test data");
        const hmac = createHmac(data, validSecretKey);

        expect(Buffer.isBuffer(hmac)).toBe(true);
        expect(hmac.length).toBe(32);
      });

      test("should create consistent HMAC for same data and key", () => {
        const data = Buffer.from("test data");
        const hmac1 = createHmac(data, validSecretKey);
        const hmac2 = createHmac(data, validSecretKey);

        expect(hmac1.equals(hmac2)).toBe(true);
      });

      test("should create different HMAC for different data", () => {
        const data1 = Buffer.from("test data 1");
        const data2 = Buffer.from("test data 2");
        const hmac1 = createHmac(data1, validSecretKey);
        const hmac2 = createHmac(data2, validSecretKey);

        expect(hmac1.equals(hmac2)).toBe(false);
      });

      test("should create different HMAC for different keys", () => {
        const data = Buffer.from("test data");
        const key2 = "abcdefghijklmnopqrstuvwxyz123456";
        const hmac1 = createHmac(data, validSecretKey);
        const hmac2 = createHmac(data, key2);

        expect(hmac1.equals(hmac2)).toBe(false);
      });

      test("should throw error for invalid secret key", () => {
        const data = Buffer.from("test data");
        expect(() => createHmac(data, "short")).toThrow("Secret key must be exactly 32 characters");
        expect(() => createHmac(data, null)).toThrow("Secret key must be exactly 32 characters");
        expect(() => createHmac(data, "")).toThrow("Secret key must be exactly 32 characters");
      });

      test("should throw error for empty data", () => {
        expect(() => createHmac(Buffer.alloc(0), validSecretKey)).toThrow(
          "Data to sign cannot be empty"
        );
        expect(() => createHmac(null, validSecretKey)).toThrow("Data to sign cannot be empty");
      });
    });

    describe("verifyHmac", () => {
      test("should verify valid HMAC", () => {
        const data = Buffer.from("test data");
        const hmac = createHmac(data, validSecretKey);

        expect(verifyHmac(data, hmac, validSecretKey)).toBe(true);
      });

      test("should reject tampered data", () => {
        const data = Buffer.from("test data");
        const hmac = createHmac(data, validSecretKey);
        const tamperedData = Buffer.from("tampered data");

        expect(verifyHmac(tamperedData, hmac, validSecretKey)).toBe(false);
      });

      test("should reject tampered HMAC", () => {
        const data = Buffer.from("test data");
        const hmac = createHmac(data, validSecretKey);
        const tamperedHmac = Buffer.from(hmac);
        tamperedHmac[0] ^= 0xff; // Flip bits in first byte

        expect(verifyHmac(data, tamperedHmac, validSecretKey)).toBe(false);
      });

      test("should reject wrong key", () => {
        const data = Buffer.from("test data");
        const hmac = createHmac(data, validSecretKey);
        const wrongKey = "wrongkey1234567890123456789012ab"; // 32 chars

        expect(verifyHmac(data, hmac, wrongKey)).toBe(false);
      });

      test("should reject invalid HMAC size", () => {
        const data = Buffer.from("test data");
        const shortHmac = Buffer.alloc(16); // Too short
        const longHmac = Buffer.alloc(64); // Too long

        expect(verifyHmac(data, shortHmac, validSecretKey)).toBe(false);
        expect(verifyHmac(data, longHmac, validSecretKey)).toBe(false);
      });

      test("should reject null/undefined HMAC", () => {
        const data = Buffer.from("test data");

        expect(verifyHmac(data, null, validSecretKey)).toBe(false);
        expect(verifyHmac(data, undefined, validSecretKey)).toBe(false);
      });

      test("should throw error for invalid secret key", () => {
        const data = Buffer.from("test data");
        const hmac = Buffer.alloc(32);

        expect(() => verifyHmac(data, hmac, "short")).toThrow(
          "Secret key must be exactly 32 characters"
        );
        expect(() => verifyHmac(data, hmac, null)).toThrow(
          "Secret key must be exactly 32 characters"
        );
      });
    });

    describe("HMAC round-trip", () => {
      test("should work with encrypted data", () => {
        // Simulate the actual use case: HMAC over encrypted data
        const originalData = Buffer.from(JSON.stringify({ test: "data" }));
        const encrypted = encrypt(originalData, validSecretKey);
        const encryptedBuffer = Buffer.from(JSON.stringify(encrypted));

        // Create HMAC over the encrypted data
        const hmac = createHmac(encryptedBuffer, validSecretKey);

        // Verify HMAC
        expect(verifyHmac(encryptedBuffer, hmac, validSecretKey)).toBe(true);

        // Simulate network packet: HMAC + encrypted data
        const packet = Buffer.concat([hmac, encryptedBuffer]);
        expect(packet.length).toBe(HMAC_SIZE + encryptedBuffer.length);

        // Extract and verify on "receiving" side
        const receivedHmac = packet.slice(0, HMAC_SIZE);
        const receivedData = packet.slice(HMAC_SIZE);

        expect(verifyHmac(receivedData, receivedHmac, validSecretKey)).toBe(true);

        // Decrypt the data
        const decryptedData = decrypt(JSON.parse(receivedData.toString()), validSecretKey);
        expect(JSON.parse(decryptedData.toString())).toEqual({ test: "data" });
      });

      test("should detect packet tampering", () => {
        const originalData = Buffer.from("sensitive data");
        const hmac = createHmac(originalData, validSecretKey);
        const packet = Buffer.concat([hmac, originalData]);

        // Tamper with the data portion
        const tamperedPacket = Buffer.from(packet);
        tamperedPacket[HMAC_SIZE + 5] ^= 0xff;

        const receivedHmac = tamperedPacket.slice(0, HMAC_SIZE);
        const receivedData = tamperedPacket.slice(HMAC_SIZE);

        expect(verifyHmac(receivedData, receivedHmac, validSecretKey)).toBe(false);
      });
    });
  });
});
