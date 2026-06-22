import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import axios from 'axios';
import { db } from '../db';
import { users } from '../db/schema';
import { hashPassword, verifyPassword, encryptApiKey, generateToken } from '../services/auth';

const router = Router();

/**
 * Route: POST /api/auth/signup
 * Action: Registers a new user. Groq API key is mandatory.
 */
router.post('/signup', async (req: Request, res: Response) => {
  const { username, password, groqApiKey } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  if (!groqApiKey) {
    return res.status(400).json({ error: 'Groq API Key is mandatory to register.' });
  }

  try {
    // Check if user already exists
    const [existingUser] = await db.select().from(users).where(eq(users.username, username));
    if (existingUser) {
      return res.status(409).json({ error: 'Username is already taken.' });
    }

    // Validate the Groq API key against the live Groq models endpoint
    try {
      await axios.get('https://api.groq.com/openai/v1/models', {
        headers: {
          Authorization: `Bearer ${groqApiKey}`,
        },
      });
    } catch (validationErr: any) {
      console.error('❌ Groq API Key validation failed:', validationErr.response?.data || validationErr.message);
      const errMsg = validationErr.response?.data?.error?.message || 'Invalid Groq API Key. Please verify the key and try again.';
      return res.status(400).json({ error: errMsg });
    }

    const userId = uuidv4();
    const hashedPassword = hashPassword(password);
    const encryptedKey = encryptApiKey(groqApiKey);

    await db.insert(users).values({
      id: userId,
      username,
      passwordHash: hashedPassword,
      groqApiKey: encryptedKey,
    });

    return res.status(201).json({ message: 'User registered successfully. You can now log in.' });
  } catch (err: any) {
    console.error('❌ Signup error:', err);
    return res.status(500).json({ error: 'Failed to complete registration.' });
  }
});

/**
 * Route: POST /api/auth/login
 * Action: Authenticates user credentials and returns a JWT token.
 */
router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const isMatch = verifyPassword(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const token = generateToken(user.id, user.username);
    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
      },
    });
  } catch (err: any) {
    console.error('❌ Login error:', err);
    return res.status(500).json({ error: 'Failed to authenticate user.' });
  }
});

export default router;
