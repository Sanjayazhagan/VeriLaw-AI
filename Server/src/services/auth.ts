import { scryptSync, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv } from 'crypto';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'harvey_super_dev_jwt_secret_token_key_987';
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

const ENCRYPTION_SECRET = process.env.API_KEY_ENCRYPTION_SECRET || 'harvey_default_secret_encryption_key_12345';
// Derive a 32-byte key from the secret
const ENCRYPTION_KEY = scryptSync(ENCRYPTION_SECRET, 'harvey-salt', 32);

/**
 * Hashes a plain text password using Node's native scryptSync algorithm.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verifies a plain text password against a stored hashed password.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const computedHash = scryptSync(password, salt, 64).toString('hex');
  return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(computedHash, 'hex'));
}

/**
 * Encrypts an API key string using AES-256-CBC.
 */
export function encryptApiKey(text: string): string {
  if (!text) return '';
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts an AES-256-CBC encrypted API key string.
 */
export function decryptApiKey(encryptedText: string): string {
  if (!encryptedText) return '';
  const [ivHex, encrypted] = encryptedText.split(':');
  if (!ivHex || !encrypted) {
    throw new Error('Invalid encrypted API key format');
  }
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Signs a user payload into a JWT token expiring in 7 days.
 */
export function generateToken(userId: string, username: string): string {
  return jwt.sign({ id: userId, username }, JWT_SECRET, { expiresIn: '7d' });
}

/**
 * Verifies and decodes a JWT token.
 */
export function verifyToken(token: string): any {
  return jwt.verify(token, JWT_SECRET);
}
