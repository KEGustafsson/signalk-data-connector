const crypto = require("crypto");

const algorithm = "aes-256-ctr";

/**
 * Encrypts data using AES-256-CTR with a randomly generated IV per encryption
 * @param {Buffer|string} text - Data to encrypt
 * @param {string} secretKey - 32-character secret key
 * @returns {{iv: string, content: string}} Encrypted data with IV
 * @throws {Error} If secretKey is invalid or text is empty
 */
const encrypt = (text, secretKey) => {
  // Validate inputs
  if (!secretKey || typeof secretKey !== "string" || secretKey.length !== 32) {
    throw new Error("Secret key must be exactly 32 characters");
  }
  if (!text || (Buffer.isBuffer(text) && text.length === 0)) {
    throw new Error("Text to encrypt cannot be empty");
  }

  // Generate a new IV for each encryption operation (critical for AES-CTR security)
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, secretKey, iv);
  const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
  return {
    iv: iv.toString("hex"),
    content: encrypted.toString("hex")
  };
};

/**
 * Decrypts data encrypted with AES-256-CTR
 * @param {{iv: string, content: string}} hash - Encrypted data with IV
 * @param {string} secretKey - 32-character secret key
 * @returns {Buffer} Decrypted data as Buffer
 * @throws {Error} If secretKey or hash structure is invalid
 */
const decrypt = (hash, secretKey) => {
  // Validate inputs
  if (!secretKey || typeof secretKey !== "string" || secretKey.length !== 32) {
    throw new Error("Secret key must be exactly 32 characters");
  }
  if (!hash || typeof hash !== "object" || !hash.iv || !hash.content) {
    throw new Error("Invalid encrypted data structure");
  }

  const decipher = crypto.createDecipheriv(algorithm, secretKey, Buffer.from(hash.iv, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(hash.content, "hex")),
    decipher.final()
  ]);
  return decrypted;
};

module.exports = {
  encrypt,
  decrypt
};
