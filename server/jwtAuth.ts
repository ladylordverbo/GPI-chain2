import jwt from "jsonwebtoken";
import type { User } from "@shared/schema";
import { storage } from "./storage";

const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || "change-me-in-production";

if (!JWT_SECRET || JWT_SECRET === "change-me-in-production") {
  console.warn("⚠️  WARNING: Using default JWT_SECRET. Set JWT_SECRET environment variable in production!");
}

export interface JWTPayload {
  userId: string;
  email: string;
  level: number;
  iat?: number;
  exp?: number;
}

/**
 * Generate a JWT token for a user
 */
export function generateToken(user: User): string {
  const payload: JWTPayload = {
    userId: user.id,
    email: user.email,
    level: user.level,
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: "7d", // 7 days, matching session TTL
  });
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    return decoded;
  } catch (error) {
    return null;
  }
}

/**
 * Extract JWT token from request headers
 * Supports both Authorization header and cookie
 */
export function extractToken(req: { headers: Record<string, string | string[] | undefined>; cookies?: Record<string, string> }): string | null {
  // Try Authorization header first (Bearer token)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }

  // Try cookie
  if (req.cookies?.jwt) {
    return req.cookies.jwt;
  }

  // Try cookie from headers (for serverless)
  const cookieHeader = req.headers.cookie;
  if (cookieHeader && typeof cookieHeader === "string") {
    const cookies = cookieHeader.split(";").reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split("=");
      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);
    
    if (cookies.jwt) {
      return cookies.jwt;
    }
  }

  return null;
}

/**
 * Middleware to authenticate user from JWT token
 * Returns the user if authenticated, null otherwise
 */
export async function authenticateJWT(
  req: { headers: Record<string, string | string[] | undefined>; cookies?: Record<string, string> }
): Promise<User | null> {
  const token = extractToken(req);
  if (!token) {
    return null;
  }

  const payload = verifyToken(token);
  if (!payload) {
    return null;
  }

  // Fetch fresh user data from database
  const user = await storage.getUser(payload.userId);
  if (!user) {
    return null;
  }

  // Verify level hasn't changed (optional security check)
  if (user.level !== payload.level) {
    // Token is valid but user level changed - still allow but log
    console.warn(`User ${user.id} level changed from ${payload.level} to ${user.level}`);
  }

  return user;
}

/**
 * Check if user has required level (for serverless)
 */
export async function requireLevelJWT(
  user: User | null,
  minLevel: number
): Promise<{ authorized: boolean; user: User | null }> {
  if (!user) {
    return { authorized: false, user: null };
  }

  const dbUser = await storage.getUser(user.id);
  if (!dbUser || dbUser.level < minLevel) {
    return { authorized: false, user: null };
  }

  return { authorized: true, user: dbUser };
}

