const {
  encrypt,
  decrypt,
  encryptBinary,
  decryptBinary,
  validateSecretKey,
  IV_LENGTH,
  AUTH_TAG_LENGTH,
  createHmac,
  verifyHmac,
  HMAC_SIZE
} = require("../crypto");

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

  describe("Binary Encryption (New API)", () => {
    describe("encryptBinary", () => {
      test("should encrypt data to binary format", () => {
        const data = Buffer.from(testData, "utf8");
        const packet = encryptBinary(data, validSecretKey);

        expect(Buffer.isBuffer(packet)).toBe(true);
        expect(packet.length).toBeGreaterThan(IV_LENGTH + AUTH_TAG_LENGTH);
      });

      test("should include IV and auth tag in packet", () => {
        const data = Buffer.from(testData, "utf8");
        const packet = encryptBinary(data, validSecretKey);

        // Packet format: [IV (12 bytes)][Encrypted Data][Auth Tag (16 bytes)]
        const minSize = IV_LENGTH + AUTH_TAG_LENGTH;
        expect(packet.length).toBeGreaterThanOrEqual(minSize);
      });

      test("should generate unique IV for each encryption", () => {
        const data = Buffer.from(testData, "utf8");
        const packet1 = encryptBinary(data, validSecretKey);
        const packet2 = encryptBinary(data, validSecretKey);

        // IVs are first 12 bytes
        const iv1 = packet1.slice(0, IV_LENGTH);
        const iv2 = packet2.slice(0, IV_LENGTH);

        expect(iv1.equals(iv2)).toBe(false);
        expect(packet1.equals(packet2)).toBe(false);
      });

      test("should accept string and convert to Buffer", () => {
        const packet = encryptBinary(testData, validSecretKey);

        expect(Buffer.isBuffer(packet)).toBe(true);
        expect(packet.length).toBeGreaterThan(IV_LENGTH + AUTH_TAG_LENGTH);
      });

      test("should throw error for invalid secret key", () => {
        const data = Buffer.from(testData);
        expect(() => encryptBinary(data, "short")).toThrow("Secret key must be exactly 32 characters");
        expect(() => encryptBinary(data, null)).toThrow("Secret key must be exactly 32 characters");
      });

      test("should throw error for empty data", () => {
        expect(() => encryptBinary(Buffer.alloc(0), validSecretKey)).toThrow(
          "Data to encrypt cannot be empty"
        );
        expect(() => encryptBinary("", validSecretKey)).toThrow("Data to encrypt cannot be empty");
      });
    });

    describe("decryptBinary", () => {
      test("should decrypt binary packet successfully", () => {
        const data = Buffer.from(testData, "utf8");
        const packet = encryptBinary(data, validSecretKey);
        const decrypted = decryptBinary(packet, validSecretKey);

        expect(Buffer.isBuffer(decrypted)).toBe(true);
        expect(decrypted.toString()).toBe(testData);
      });

      test("should handle complex JSON data", () => {
        const complexData = { name: "Test", value: 123, nested: { key: "value" } };
        const dataBuffer = Buffer.from(JSON.stringify(complexData));
        const packet = encryptBinary(dataBuffer, validSecretKey);
        const decrypted = decryptBinary(packet, validSecretKey);

        expect(JSON.parse(decrypted.toString())).toEqual(complexData);
      });

      test("should throw error for invalid packet size", () => {
        const tooSmall = Buffer.alloc(IV_LENGTH + AUTH_TAG_LENGTH - 1);
        expect(() => decryptBinary(tooSmall, validSecretKey)).toThrow("Invalid packet size");
      });

      test("should throw error for tampered packet", () => {
        const data = Buffer.from(testData);
        const packet = encryptBinary(data, validSecretKey);

        // Tamper with encrypted data
        const tamperedPacket = Buffer.from(packet);
        tamperedPacket[IV_LENGTH + 5] ^= 0xff;

        expect(() => decryptBinary(tamperedPacket, validSecretKey)).toThrow();
      });

      test("should throw error for tampered auth tag", () => {
        const data = Buffer.from(testData);
        const packet = encryptBinary(data, validSecretKey);

        // Tamper with auth tag (last 16 bytes)
        const tamperedPacket = Buffer.from(packet);
        tamperedPacket[packet.length - 1] ^= 0xff;

        expect(() => decryptBinary(tamperedPacket, validSecretKey)).toThrow();
      });

      test("should throw error with wrong key", () => {
        const data = Buffer.from(testData);
        const packet = encryptBinary(data, validSecretKey);
        const wrongKey = "wrongkey12345678901234567890123";

        expect(() => decryptBinary(packet, wrongKey)).toThrow();
      });

      test("should throw error for invalid secret key", () => {
        const packet = Buffer.alloc(100);
        expect(() => decryptBinary(packet, "short")).toThrow("Secret key must be exactly 32 characters");
      });
    });

    describe("encryptBinary/decryptBinary round-trip", () => {
      test("should handle large data", () => {
        const largeData = Buffer.from("x".repeat(100000));
        const packet = encryptBinary(largeData, validSecretKey);
        const decrypted = decryptBinary(packet, validSecretKey);

        expect(decrypted.equals(largeData)).toBe(true);
      });

      test("should handle unicode characters", () => {
        const unicode = "Hello 世界 🌍 Ñoño";
        const packet = encryptBinary(unicode, validSecretKey);
        const decrypted = decryptBinary(packet, validSecretKey);

        expect(decrypted.toString()).toBe(unicode);
      });

      test("should handle special characters", () => {
        const specialChars = "!@#$%^&*()_+-=[]{}|;:'\",.<>?/~`";
        const packet = encryptBinary(specialChars, validSecretKey);
        const decrypted = decryptBinary(packet, validSecretKey);

        expect(decrypted.toString()).toBe(specialChars);
      });

      test("should handle binary data", () => {
        const binaryData = Buffer.from([0, 1, 2, 255, 254, 253]);
        const packet = encryptBinary(binaryData, validSecretKey);
        const decrypted = decryptBinary(packet, validSecretKey);

        expect(decrypted.equals(binaryData)).toBe(true);
      });
    });

    describe("Binary format vs Legacy format", () => {
      test("binary format should be smaller than legacy for same data", () => {
        const data = Buffer.from(testData);

        // Binary format
        const binaryPacket = encryptBinary(data, validSecretKey);

        // Legacy format (JSON with hex strings)
        const legacyEncrypted = encrypt(data, validSecretKey);
        const legacyPacket = Buffer.from(JSON.stringify(legacyEncrypted));

        // Binary should be significantly smaller (no JSON overhead, no hex encoding)
        expect(binaryPacket.length).toBeLessThan(legacyPacket.length);
      });

      test("binary format should provide built-in authentication", () => {
        const data = Buffer.from(testData);
        const packet = encryptBinary(data, validSecretKey);

        // Tamper with packet
        const tamperedPacket = Buffer.from(packet);
        tamperedPacket[IV_LENGTH + 1] ^= 0xff;

        // Should throw due to failed authentication (built into GCM)
        expect(() => decryptBinary(tamperedPacket, validSecretKey)).toThrow();
      });
    });
  });

  describe("validateSecretKey", () => {
    test("should accept valid 32-character key", () => {
      expect(validateSecretKey(validSecretKey)).toBe(true);
    });

    test("should accept key with diverse characters", () => {
      const diverseKey = "Abc123!@#XYZ456$%^uvw789&*()pqr0"; // 32 chars
      expect(validateSecretKey(diverseKey)).toBe(true);
    });

    test("should throw error for short key", () => {
      expect(() => validateSecretKey("short")).toThrow("Secret key must be exactly 32 characters");
    });

    test("should throw error for long key", () => {
      expect(() => validateSecretKey("123456789012345678901234567890123")).toThrow(
        "Secret key must be exactly 32 characters"
      );
    });

    test("should throw error for null/undefined key", () => {
      expect(() => validateSecretKey(null)).toThrow("Secret key must be exactly 32 characters");
      expect(() => validateSecretKey(undefined)).toThrow("Secret key must be exactly 32 characters");
    });

    test("should throw error for all same character (weak)", () => {
      const weakKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      expect(() => validateSecretKey(weakKey)).toThrow(
        "Secret key has insufficient entropy (all same character)"
      );
    });

    test("should throw error for insufficient diversity", () => {
      const lowDiversityKey = "ababababababababababababababab12"; // Only 4 unique chars
      expect(() => validateSecretKey(lowDiversityKey)).toThrow(
        "Secret key has insufficient diversity"
      );
    });

    test("should accept key with exactly 8 unique characters", () => {
      const key8Chars = "abcdefgh" + "a".repeat(24); // 8 unique chars, 32 total
      expect(validateSecretKey(key8Chars)).toBe(true);
    });
  });

  describe("Constants", () => {
    test("IV_LENGTH should be 12 bytes (GCM standard)", () => {
      expect(IV_LENGTH).toBe(12);
    });

    test("AUTH_TAG_LENGTH should be 16 bytes (GCM standard)", () => {
      expect(AUTH_TAG_LENGTH).toBe(16);
    });

    test("HMAC_SIZE should be 32 bytes (legacy)", () => {
      expect(HMAC_SIZE).toBe(32);
    });
  });
});
