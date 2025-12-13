const crypto = require("crypto");

const algorithm = "aes-256-ctr";
const HMAC_ALGORITHM = "sha256";
const HMAC_SIZE = 32; // SHA-256 produces 32 bytes

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

/**
 * Creates an HMAC-SHA256 signature for the given data
 * @param {Buffer} data - Data to sign
 * @param {string} secretKey - 32-character secret key
 * @returns {Buffer} 32-byte HMAC signature
 * @throws {Error} If secretKey is invalid or data is empty
 */
const createHmac = (data, secretKey) => {
  if (!secretKey || typeof secretKey !== "string" || secretKey.length !== 32) {
    throw new Error("Secret key must be exactly 32 characters");
  }
  if (!data || (Buffer.isBuffer(data) && data.length === 0)) {
    throw new Error("Data to sign cannot be empty");
  }

  const hmac = crypto.createHmac(HMAC_ALGORITHM, secretKey);
  hmac.update(data);
  return hmac.digest();
};

/**
 * Verifies an HMAC-SHA256 signature
 * @param {Buffer} data - Data that was signed
 * @param {Buffer} signature - HMAC signature to verify
 * @param {string} secretKey - 32-character secret key
 * @returns {boolean} True if signature is valid
 * @throws {Error} If secretKey is invalid
 */
const verifyHmac = (data, signature, secretKey) => {
  if (!secretKey || typeof secretKey !== "string" || secretKey.length !== 32) {
    throw new Error("Secret key must be exactly 32 characters");
  }
  if (!signature || signature.length !== HMAC_SIZE) {
    return false;
  }

  const expected = createHmac(data, secretKey);
  // Use timing-safe comparison to prevent timing attacks
  return crypto.timingSafeEqual(signature, expected);
};

module.exports = {
  encrypt,
  decrypt,
  createHmac,
  verifyHmac,
  HMAC_SIZE
};
