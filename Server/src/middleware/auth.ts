import { Request, Response, NextFunction } from 'express';
import { verifyToken, decryptApiKey } from '../services/auth';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
    groqApiKey: string;
  };
}

export async function authenticateJWT(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Access denied. Invalid token format.' });
  }

  try {
    const decoded = verifyToken(token);
    
    // Fetch user from DB to verify existence and retrieve the encrypted API key
    const [userRecord] = await db.select().from(users).where(eq(users.id, decoded.id));
    if (!userRecord) {
      return res.status(401).json({ error: 'Access denied. User does not exist.' });
    }

    // Decrypt the user's Groq/Grok API key
    let decryptedKey = '';
    if (userRecord.groqApiKey) {
      try {
        decryptedKey = decryptApiKey(userRecord.groqApiKey);
      } catch (decryptErr) {
        console.error('Failed to decrypt user API key:', decryptErr);
      }
    }

    req.user = {
      id: userRecord.id,
      username: userRecord.username,
      groqApiKey: decryptedKey,
    };
    
    next();
  } catch (error: any) {
    return res.status(403).json({ error: 'Access denied. Invalid or expired token.' });
  }
}
