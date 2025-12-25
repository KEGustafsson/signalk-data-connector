const crypto = require("crypto");

// Use AES-256-GCM for authenticated encryption (encryption + authentication in one)
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard IV length
const AUTH_TAG_LENGTH = 16; // GCM authentication tag length

// Legacy support for old format
const LEGACY_ALGORITHM = "aes-256-ctr";
const HMAC_ALGORITHM = "sha256";
const HMAC_SIZE = 32; // SHA-256 produces 32 bytes

/**
 * Encrypts data using AES-256-GCM with binary output
 * Binary format: [IV (12 bytes)][Encrypted Data][Auth Tag (16 bytes)]
 * @param {Buffer} data - Data to encrypt
 * @param {string} secretKey - 32-character secret key
 * @returns {Buffer} Binary packet with IV, encrypted data, and auth tag
 * @throws {Error} If secretKey is invalid or data is empty
 */
const encryptBinary = (data, secretKey) => {
  // Validate inputs
  if (!secretKey || typeof secretKey !== "string" || secretKey.length !== 32) {
    throw new Error("Secret key must be exactly 32 characters");
  }
  if (!data || (Buffer.isBuffer(data) && data.length === 0)) {
    throw new Error("Data to encrypt cannot be empty");
  }

  // Ensure data is a Buffer
  const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

  // Generate random IV for each encryption (critical for GCM security)
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, secretKey, iv);

  const encrypted = Buffer.concat([cipher.update(dataBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Return single buffer: [IV][Encrypted][AuthTag]
  return Buffer.concat([iv, encrypted, authTag]);
};

/**
 * Decrypts data encrypted with AES-256-GCM
 * @param {Buffer} packet - Binary packet with IV, encrypted data, and auth tag
 * @param {string} secretKey - 32-character secret key
 * @returns {Buffer} Decrypted data as Buffer
 * @throws {Error} If secretKey or packet is invalid, or authentication fails
 */
const decryptBinary = (packet, secretKey) => {
  // Validate inputs
  if (!secretKey || typeof secretKey !== "string" || secretKey.length !== 32) {
    throw new Error("Secret key must be exactly 32 characters");
  }
  if (!Buffer.isBuffer(packet) || packet.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Invalid packet size");
  }

  // Extract components from packet
  const iv = packet.slice(0, IV_LENGTH);
  const authTag = packet.slice(-AUTH_TAG_LENGTH);
  const encrypted = packet.slice(IV_LENGTH, -AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, secretKey, iv);
  decipher.setAuthTag(authTag);

  // This will throw if authentication fails (tampered data)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
};

/**
 * Legacy: Encrypts data using AES-256-CTR (for backward compatibility)
 * @param {Buffer|string} text - Data to encrypt
 * @param {string} secretKey - 32-character secret key
 * @returns {{iv: string, content: string}} Encrypted data with IV
 * @throws {Error} If secretKey is invalid or text is empty
 * @deprecated Use encryptBinary instead
 */
const encrypt = (text, secretKey) => {
  // Validate inputs
  if (!secretKey || typeof secretKey !== "string" || secretKey.length !== 32) {
    throw new Error("Secret key must be exactly 32 characters");
  }
  if (!text || (Buffer.isBuffer(text) && text.length === 0)) {
    throw new Error("Text to encrypt cannot be empty");
  }

  // Generate a new IV for each encryption operation
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(LEGACY_ALGORITHM, secretKey, iv);
  const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
  return {
    iv: iv.toString("hex"),
    content: encrypted.toString("hex")
  };
};

/**
 * Legacy: Decrypts data encrypted with AES-256-CTR (for backward compatibility)
 * @param {{iv: string, content: string}} hash - Encrypted data with IV
 * @param {string} secretKey - 32-character secret key
 * @returns {Buffer} Decrypted data as Buffer
 * @throws {Error} If secretKey or hash structure is invalid
 * @deprecated Use decryptBinary instead
 */
const decrypt = (hash, secretKey) => {
  // Validate inputs
  if (!secretKey || typeof secretKey !== "string" || secretKey.length !== 32) {
    throw new Error("Secret key must be exactly 32 characters");
  }
  if (!hash || typeof hash !== "object" || !hash.iv || !hash.content) {
    throw new Error("Invalid encrypted data structure");
  }

  const decipher = crypto.createDecipheriv(LEGACY_ALGORITHM, secretKey, Buffer.from(hash.iv, "hex"));
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
 * @deprecated Use AES-GCM (encryptBinary) which includes authentication
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
 * @deprecated Use AES-GCM (decryptBinary) which includes authentication
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

/**
 * Validates secret key strength
 * @param {string} key - Secret key to validate
 * @returns {boolean} True if key is valid
 * @throws {Error} If key is weak or invalid
 */
function validateSecretKey(key) {
  if (!key || typeof key !== "string" || key.length !== 32) {
    throw new Error("Secret key must be exactly 32 characters");
  }

  // Check for common weak patterns (all same character)
  if (/^(.)\1{31}$/.test(key)) {
    throw new Error("Secret key has insufficient entropy (all same character)");
  }

  // Check character diversity
  const uniqueChars = new Set(key.split("")).size;
  if (uniqueChars < 8) {
    throw new Error("Secret key has insufficient diversity (use at least 8 different characters)");
  }

  return true;
}

module.exports = {
  // New binary format (recommended)
  encryptBinary,
  decryptBinary,
  validateSecretKey,
  IV_LENGTH,
  AUTH_TAG_LENGTH,
  // Legacy format (backward compatibility)
  encrypt,
  decrypt,
  createHmac,
  verifyHmac,
  HMAC_SIZE
};
