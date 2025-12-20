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
 * Enhanced for serverless environments
 */
export function extractToken(req: { headers: Record<string, string | string[] | undefined>; cookies?: Record<string, string> }): string | null {
  // Try Authorization header first (Bearer token)
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const authValue = typeof authHeader === "string" ? authHeader : authHeader[0];
    if (authValue && authValue.startsWith("Bearer ")) {
      const token = authValue.substring(7).trim();
      if (token) {
        console.log('[JWT Extract] Found token in Authorization header');
        return token;
      }
    }
  }

  // Try cookie object first (most reliable in serverless)
  if (req.cookies && typeof req.cookies === 'object') {
    const jwtCookie = req.cookies.jwt;
    if (jwtCookie && typeof jwtCookie === 'string' && jwtCookie.trim()) {
      console.log('[JWT Extract] Found token in req.cookies.jwt');
      return jwtCookie.trim();
    }
  }

  // Try cookie from headers (fallback for serverless environments)
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const cookieString = typeof cookieHeader === "string" 
      ? cookieHeader 
      : Array.isArray(cookieHeader) 
        ? cookieHeader[0] 
        : String(cookieHeader);
    
    if (cookieString) {
      try {
        const cookies = cookieString.split(";").reduce((acc, cookie) => {
          const trimmed = cookie.trim();
          if (!trimmed) return acc;
          
          const equalIndex = trimmed.indexOf('=');
          if (equalIndex === -1) {
            // Cookie without value
            return acc;
          }
          
          const key = trimmed.substring(0, equalIndex).trim();
          const value = trimmed.substring(equalIndex + 1).trim();
          
          if (key) {
            try {
              acc[key] = decodeURIComponent(value);
            } catch (e) {
              // If decode fails, use raw value
              acc[key] = value;
            }
          }
          return acc;
        }, {} as Record<string, string>);
        
        if (cookies.jwt && cookies.jwt.trim()) {
          console.log('[JWT Extract] Found token in Cookie header');
          return cookies.jwt.trim();
        }
      } catch (e) {
        console.warn('[JWT Extract] Error parsing cookie header:', e);
      }
    }
  }

  // Enhanced logging for debugging
  const debugInfo = {
    hasCookies: !!req.cookies,
    cookieType: req.cookies ? typeof req.cookies : 'none',
    cookieKeys: req.cookies && typeof req.cookies === 'object' ? Object.keys(req.cookies) : [],
    hasCookieHeader: !!cookieHeader,
    cookieHeaderType: cookieHeader ? typeof cookieHeader : 'none',
    cookieHeaderLength: cookieHeader 
      ? (typeof cookieHeader === 'string' 
          ? cookieHeader.length 
          : Array.isArray(cookieHeader) 
            ? cookieHeader[0]?.length || 0 
            : String(cookieHeader).length)
      : 0,
    hasAuthHeader: !!authHeader,
  };
  
  console.log('[JWT Extract] No token found', debugInfo);
  return null;
}

/**
 * Middleware to authenticate user from JWT token
 * Returns the user if authenticated, null otherwise
 * Enhanced with better error handling and logging
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
    console.log('[JWT Auth] Token verification failed - invalid or expired token');
    return null;
  }

  // Fetch fresh user data from database
  let user: User | null;
  try {
    user = await storage.getUser(payload.userId);
  } catch (error) {
    console.error('[JWT Auth] Error fetching user from database:', error);
    return null;
  }
  
  if (!user) {
    console.log('[JWT Auth] User not found in database:', payload.userId);
    return null;
  }

  // Verify level hasn't changed (optional security check)
  if (user.level !== payload.level) {
    // Token is valid but user level changed - still allow but log
    console.warn(`[JWT Auth] User ${user.id} level changed from ${payload.level} to ${user.level}`);
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

