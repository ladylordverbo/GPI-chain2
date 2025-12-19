import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateJWT, requireLevelJWT } from '../server/jwtAuth';
import { storage } from '../server/storage';
import { completeRegistration, supabase, checkUserRegistration } from '../server/supabaseAuth';
import { generateToken } from '../server/jwtAuth';
import { insertPromotionRequestSchema, insertVoteSchema, type User } from '@shared/schema';
import { z } from 'zod';

// Helper to get user ID from request
function getUserId(req: { user?: User | null }): string | null {
  return req.user?.id || null;
}

// Helper to sanitize user data based on viewer's level
function sanitizeUser(user: User, viewerLevel: number): Partial<User> | null {
  if (user.level > viewerLevel) {
    return null;
  }
  if (viewerLevel >= 5) {
    return user;
  }
  const { email, ...rest } = user;
  return rest;
}

function filterAndSanitizeUsers(users: User[], viewerLevel: number): Partial<User>[] {
  return users
    .filter(u => u.level <= viewerLevel)
    .map(u => sanitizeUser(u, viewerLevel))
    .filter((u): u is Partial<User> => u !== null);
}

// Parse cookies from header
function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  return cookieHeader.split(';').reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split('=');
    if (key && value) acc[key] = decodeURIComponent(value);
    return acc;
  }, {} as Record<string, string>);
}

// Helper function for structured logging
function logRequest(method: string, path: string, statusCode?: number, duration?: number, error?: any) {
  const timestamp = new Date().toISOString();
  if (error) {
    console.error(`[${timestamp}] ${method} ${path} ${statusCode || 'ERROR'} ${duration ? `in ${duration}ms` : ''}`, {
      error: error.message,
      stack: error.stack,
      ...error
    });
  } else {
    console.log(`[${timestamp}] ${method} ${path} ${statusCode || 'START'} ${duration ? `in ${duration}ms` : ''}`);
  }
}

// Helper to log and return response
function logAndReturn(vercelRes: VercelResponse, method: string, path: string, startTime: number, statusCode: number, data?: any) {
  const duration = Date.now() - startTime;
  logRequest(method, path, statusCode, duration);
  if (data !== undefined) {
    return vercelRes.status(statusCode).json(data);
  }
  return vercelRes.status(statusCode).end();
}

// Main handler
export default async function handler(
  vercelReq: VercelRequest,
  vercelRes: VercelResponse
) {
  const startTime = Date.now();
  let path = '';
  let method = '';
  
  try {
    // Extract path - handle Vercel's catch-all routing
    // For /api/login, vercelReq.query.path should be 'login'
    let pathArray: string[] = [];
    
    if (vercelReq.query.path) {
      if (Array.isArray(vercelReq.query.path)) {
        pathArray = vercelReq.query.path;
      } else {
        pathArray = [vercelReq.query.path];
      }
    }
    
    // Also check url for fallback (in case query.path is not set)
    const url = vercelReq.url || '';
    if (pathArray.length === 0 && url.includes('/api/')) {
      const urlPath = url.split('/api/')[1]?.split('?')[0];
      if (urlPath) {
        pathArray = urlPath.split('/').filter(p => p);
      }
    }
    
    path = '/' + pathArray.join('/');
    method = vercelReq.method || 'GET';
    
    // Log incoming request
    logRequest(method, path);
    console.log('Request details:', { 
      path, 
      method, 
      queryPath: vercelReq.query.path, 
      url,
      headers: {
        host: vercelReq.headers.host,
        'user-agent': vercelReq.headers['user-agent'],
        'content-type': vercelReq.headers['content-type']
      }
    });

    // Parse cookies
    const cookies = parseCookies(vercelReq.headers.cookie);
    
    // Create request-like object
    const req: any = {
      method,
      path,
      query: vercelReq.query,
      body: vercelReq.body,
      headers: vercelReq.headers,
      cookies,
      params: {} as Record<string, string>,
      user: null,
    };

    // Extract params from path
    const pathParts = path.split('/').filter(p => p);
    if (pathParts.length > 0) {
      // Handle common param patterns
      if (pathParts[0] === 'users' && pathParts[1]) {
        req.params.userId = pathParts[1];
        if (pathParts[2] === 'username') {
          req.params.action = 'username';
        } else if (pathParts[2] === 'level') {
          req.params.action = 'level';
        } else       if (pathParts[2] === 'invitees') {
        req.params.action = 'invitees';
      } else if (pathParts[2] === 'username') {
        req.params.action = 'username';
      } else if (pathParts[2] === 'level') {
        req.params.action = 'level';
      }
    } else if (pathParts[0] === 'invite' && pathParts[1]) {
        req.params.token = pathParts[1];
      } else if (pathParts[0] === 'promotions' && pathParts[1]) {
        req.params.id = pathParts[1];
      if (pathParts[2] === 'vote') {
        req.params.action = 'vote';
      }
    } else if (pathParts[0] === 'level5-governance' && pathParts[1] === 'bootstrap-promote') {
      req.params.action = 'bootstrap-promote';
    } else if (pathParts[0] === 'username' && pathParts[1] === 'check' && pathParts[2]) {
        req.params.username = pathParts[2];
      }
    }

    // Try JWT authentication
    const user = await authenticateJWT(req);
    if (user) {
      req.user = user;
    }

    // Handle OPTIONS for CORS preflight
    if (method === 'OPTIONS') {
      vercelRes.setHeader('Access-Control-Allow-Origin', '*');
      vercelRes.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      vercelRes.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      logRequest(method, path, 200, Date.now() - startTime);
      return vercelRes.status(200).end();
    }

    // Route handlers
    // Note: /login is handled here for serverless compatibility
    
    if (path === '/login' && method === 'GET') {
      // OAuth login - redirect to Supabase OAuth
      const inviteToken = req.query.invite as string | undefined;
      const host = vercelReq.headers.host || 'localhost';
      const protocol = vercelReq.headers['x-forwarded-proto'] || 'https';
      const redirectUrl = `${protocol}://${host}/callback.html`;
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (error) {
        logRequest(method, path, 400, Date.now() - startTime, error);
        return vercelRes.status(400).json({ error: error.message });
      }

      if (data?.url) {
        // Store invite token in URL state or return it to client
        // For serverless, we'll pass it via the redirect URL
        const finalUrl = inviteToken 
          ? `${data.url}&state=${encodeURIComponent(JSON.stringify({ invite: inviteToken }))}`
          : data.url;
        logRequest(method, path, 302, Date.now() - startTime);
        return vercelRes.redirect(finalUrl);
      }

      logRequest(method, path, 500, Date.now() - startTime);
      return vercelRes.status(500).json({ error: 'OAuth initialization failed' });
    }

    if (path === '/login' && method === 'POST') {
      // Email/password login
      const { email, password, invite } = req.body;
      
      if (!email || !password) {
        return vercelRes.status(400).json({ message: 'Email and password are required' });
      }

      try {
        // Authenticate with Supabase
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (authError || !authData.user) {
          return vercelRes.status(401).json({ message: authError?.message || 'Invalid credentials' });
        }

        // Get user from database
        const dbUser = await storage.getUser(authData.user.id);
        if (!dbUser) {
          return vercelRes.status(404).json({ message: 'User not found in database' });
        }

        // Check registration status
        const result = await checkUserRegistration(email, invite);
        
        if (result.error) {
          return vercelRes.status(400).json({ message: result.error });
        }

        if (result.pending) {
          // User needs to complete registration
          const jwtToken = generateToken({ 
            id: authData.user.id, 
            email: authData.user.email,
            pendingRegistration: true 
          });
          vercelRes.setHeader('Set-Cookie', `jwt=${jwtToken}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${7 * 24 * 60 * 60}`);
          logRequest(method, path, 200, Date.now() - startTime);
          return vercelRes.json({ pending: true, token: jwtToken });
        }

        // User is fully registered - generate JWT token
        const jwtToken = generateToken({ ...dbUser, id: authData.user.id, email: authData.user.email });
        vercelRes.setHeader('Set-Cookie', `jwt=${jwtToken}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${7 * 24 * 60 * 60}`);
        logRequest(method, path, 200, Date.now() - startTime);
        return vercelRes.json({ success: true, user: dbUser, token: jwtToken });
      } catch (error: any) {
        const duration = Date.now() - startTime;
        logRequest(method, path, 500, duration, error);
        console.error('Login error:', error);
        return vercelRes.status(500).json({ message: error.message || 'Login failed' });
      }
    }
    
    if (path === '/callback-token' && method === 'POST') {
      // OAuth callback handler - receives token from client-side callback page
      const { access_token, refresh_token, invite } = req.body;

      if (!access_token) {
        return vercelRes.status(400).json({ error: 'No access token provided' });
      }

      try {
        // Set Supabase session
        const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
          access_token,
          refresh_token: refresh_token || '',
        });

        if (sessionError || !sessionData.user) {
          return vercelRes.status(400).json({ error: sessionError?.message || 'Authentication failed' });
        }

        const userEmail = sessionData.user.email;
        if (!userEmail) {
          return vercelRes.status(400).json({ error: 'No email found in user profile' });
        }

        // Check registration status
        const result = await checkUserRegistration(userEmail, invite);
        
        if (result.error) {
          return vercelRes.status(400).json({ error: result.error });
        }

        if (result.pending) {
          // User needs to complete registration
          const jwtToken = generateToken({ 
            id: sessionData.user.id, 
            email: userEmail,
            pendingRegistration: true 
          });
          vercelRes.setHeader('Set-Cookie', `jwt=${jwtToken}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${7 * 24 * 60 * 60}`);
          logRequest(method, path, 200, Date.now() - startTime);
          return vercelRes.json({ pending: true, token: jwtToken });
        }

        // Get user from database
        const dbUser = await storage.getUser(sessionData.user.id);
        if (!dbUser) {
          logRequest(method, path, 404, Date.now() - startTime);
          return vercelRes.status(404).json({ error: 'User not found in database' });
        }

        // User is fully registered - generate JWT token
        const jwtToken = generateToken({ ...dbUser, id: sessionData.user.id, email: userEmail });
        vercelRes.setHeader('Set-Cookie', `jwt=${jwtToken}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${7 * 24 * 60 * 60}`);
        logRequest(method, path, 200, Date.now() - startTime);
        return vercelRes.json({ success: true, user: dbUser, token: jwtToken });
      } catch (error: any) {
        const duration = Date.now() - startTime;
        logRequest(method, path, 500, duration, error);
        console.error('Callback token error:', error);
        return vercelRes.status(500).json({ error: error.message || 'Authentication failed' });
      }
    }

    if (path === '/callback' && method === 'GET') {
      // OAuth callback route (for code-based flow)
      const { code, error } = req.query;

      if (error) {
        return vercelRes.redirect(`/?error=${encodeURIComponent(error as string)}`);
      }

      if (!code) {
        return vercelRes.redirect('/?error=No authorization code received');
      }

      try {
        // Exchange code for session
        const { data: sessionData, error: sessionError } = await supabase.auth.exchangeCodeForSession(code as string);

        if (sessionError || !sessionData.user) {
          return vercelRes.redirect(`/?error=${encodeURIComponent(sessionError?.message || 'Authentication failed')}`);
        }

        const userEmail = sessionData.user.email;
        if (!userEmail) {
          return vercelRes.redirect('/?error=No email found in user profile');
        }

        // Get invite token from query (for serverless, we can't use sessions)
        const inviteToken = req.query.invite as string | undefined;

        // Check registration status
        const result = await checkUserRegistration(userEmail, inviteToken);
        
        if (result.error) {
          return vercelRes.redirect(`/?error=${encodeURIComponent(result.error)}`);
        }

        if (result.pending) {
          // New user needs to choose username - store in JWT
          const jwtToken = generateToken({ 
            id: sessionData.user.id, 
            email: userEmail,
            pendingRegistration: true 
          });
          vercelRes.setHeader('Set-Cookie', `jwt=${jwtToken}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${7 * 24 * 60 * 60}`);
          return vercelRes.redirect('/?register=pending');
        }

        // Existing user - get from database
        const dbUser = await storage.getUser(sessionData.user.id);
        if (!dbUser) {
          return vercelRes.redirect('/?error=User not found in database');
        }

        // Generate JWT token
        const jwtToken = generateToken({ ...dbUser, email: userEmail });
        vercelRes.setHeader('Set-Cookie', `jwt=${jwtToken}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${7 * 24 * 60 * 60}`);
        return vercelRes.redirect('/');
      } catch (err: any) {
        return vercelRes.redirect(`/?error=${encodeURIComponent(err.message || 'Authentication failed')}`);
      }
    }

    if (path === '/logout' && method === 'GET') {
      // Logout - clear JWT cookie
      vercelRes.setHeader('Set-Cookie', 'jwt=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0');
      logRequest(method, path, 200, Date.now() - startTime);
      return vercelRes.json({ success: true });
    }

    // Auth routes
    if (path === '/auth/user' && method === 'GET') {
      if (!user) {
        logRequest(method, path, 401, Date.now() - startTime);
        return vercelRes.status(401).json({ message: "Unauthorized" });
      }
      const dbUser = await storage.getUserWithInviter(user.id);
      if (!dbUser) {
        logRequest(method, path, 404, Date.now() - startTime);
        return vercelRes.status(404).json({ message: "User not found" });
      }
      const invitees = await storage.getInvitees(user.id);
      const visibleInvitees = invitees.filter(inv => inv.level <= dbUser.level);
      const sanitizedInviter = dbUser.inviter && dbUser.inviter.level <= dbUser.level 
        ? sanitizeUser(dbUser.inviter, dbUser.level)
        : undefined;
      logRequest(method, path, 200, Date.now() - startTime);
      return vercelRes.json({
        ...dbUser,
        inviter: sanitizedInviter,
        inviteCount: visibleInvitees.length,
      });
    }

    if (path === '/auth/setup-required' && method === 'GET') {
      const userCount = await storage.getUserCount();
      return vercelRes.json({ setupRequired: userCount === 0 });
    }

    if (path === '/auth/pending-registration' && method === 'GET') {
      // For serverless, pending registration is handled via JWT or session storage
      // This would need to be stored in a database or external store
      return vercelRes.json({ pending: false });
    }

    if (path === '/auth/complete-registration' && method === 'POST') {
      // This requires session storage - for serverless, we'd need to use a database
      // For now, return error suggesting to use Express for registration
      return vercelRes.status(400).json({ 
        message: "Registration completion requires session storage. Please use the Express server for registration." 
      });
    }

    if (path.startsWith('/invite/') && method === 'GET') {
      const token = req.params.token;
      if (!token) {
        return vercelRes.status(400).json({ message: "Token required" });
      }
      const link = await storage.getInviteLinkByToken(token);
      if (!link || link.status !== "active") {
        return vercelRes.status(404).json({ valid: false, message: "Invalid or expired invite link" });
      }
      const inviter = await storage.getUser(link.invitedByUserId);
      return vercelRes.json({
        valid: true,
        inviterName: inviter ? inviter.username : "Unknown",
      });
    }

    if (path.startsWith('/username/check/') && method === 'GET') {
      const username = req.params.username?.toLowerCase().trim();
      if (!username) {
        return vercelRes.status(400).json({ message: "Username required" });
      }
      if (username.length < 3 || username.length > 30) {
        return vercelRes.json({ available: false, reason: "Username must be 3-30 characters" });
      }
      if (!/^[a-z0-9_]+$/.test(username)) {
        return vercelRes.json({ available: false, reason: "Username can only contain letters, numbers, and underscores" });
      }
      const available = await storage.isUsernameAvailable(username);
      return vercelRes.json({ available, reason: available ? null : "Username is already taken" });
    }

    // User routes
    if (path === '/users' && method === 'GET') {
      if (!user) {
        return vercelRes.status(401).json({ message: "Unauthorized" });
      }
      const requestingUser = await storage.getUser(user.id);
      if (!requestingUser) {
        return vercelRes.status(401).json({ message: "User not found" });
      }
      const level = req.query.level ? parseInt(req.query.level as string) : undefined;
      const allUsers = await storage.getUsersByLevel(level);
      const visibleUsers = filterAndSanitizeUsers(allUsers, requestingUser.level);
      return vercelRes.json(visibleUsers);
    }

    if (path.startsWith('/users/') && req.params.userId && method === 'GET') {
      if (!user) {
        return vercelRes.status(401).json({ message: "Unauthorized" });
      }
      const requestingUser = await storage.getUser(user.id);
      if (!requestingUser) {
        return vercelRes.status(401).json({ message: "User not found" });
      }
      const targetUser = await storage.getUserWithInviter(req.params.userId);
      if (!targetUser) {
        return vercelRes.status(404).json({ message: "User not found" });
      }
      if (targetUser.level > requestingUser.level) {
        return vercelRes.status(403).json({ message: "You cannot view this user's profile" });
      }
      const invitees = await storage.getInvitees(req.params.userId);
      const sanitizedUser = sanitizeUser(targetUser, requestingUser.level);
      const sanitizedInviter = targetUser.inviter ? sanitizeUser(targetUser.inviter, requestingUser.level) : undefined;
      const sanitizedInvitees = filterAndSanitizeUsers(invitees, requestingUser.level);
      return vercelRes.json({
        ...sanitizedUser,
        inviter: sanitizedInviter,
        invitees: sanitizedInvitees,
        inviteCount: sanitizedInvitees.length,
      });
    }

    if (path.startsWith('/users/') && req.params.userId && req.params.action === 'invitees' && method === 'GET') {
      if (!user) {
        return vercelRes.status(401).json({ message: "Unauthorized" });
      }
      const requestingUser = await storage.getUser(user.id);
      if (!requestingUser) {
        return vercelRes.status(401).json({ message: "User not found" });
      }
      const targetUser = await storage.getUser(req.params.userId);
      if (!targetUser) {
        return vercelRes.status(404).json({ message: "User not found" });
      }
      if (targetUser.level > requestingUser.level) {
        return vercelRes.status(403).json({ message: "Not authorized" });
      }
      const invitees = await storage.getInvitees(req.params.userId);
      const sanitizedInvitees = filterAndSanitizeUsers(invitees, requestingUser.level);
      return vercelRes.json(sanitizedInvitees);
    }

    if (path.startsWith('/users/') && req.params.userId && req.params.action === 'username' && method === 'PATCH') {
      if (!user) {
        return vercelRes.status(401).json({ message: "Unauthorized" });
      }
      const currentUserId = user.id;
      const targetUserId = req.params.userId;
      const { username } = req.body;
      const currentUser = await storage.getUser(currentUserId);
      if (!currentUser) {
        return vercelRes.status(401).json({ message: "Unauthorized" });
      }
      const isSelf = targetUserId === currentUserId;
      const isLevel5 = currentUser.level === 5;
      if (!isSelf && !isLevel5) {
        return vercelRes.status(403).json({ message: "Only Level 5 members can edit other users' usernames" });
      }
      const normalizedUsername = username.toLowerCase().trim();
      if (normalizedUsername.length < 3 || normalizedUsername.length > 30) {
        return vercelRes.status(400).json({ message: "Username must be 3-30 characters" });
      }
      if (!/^[a-z0-9_]+$/.test(normalizedUsername)) {
        return vercelRes.status(400).json({ message: "Username can only contain letters, numbers, and underscores" });
      }
      const available = await storage.isUsernameAvailable(normalizedUsername, targetUserId);
      if (!available) {
        return vercelRes.status(400).json({ message: "Username is already taken" });
      }
      const updatedUser = await storage.updateUsername(targetUserId, normalizedUsername);
      return vercelRes.json(updatedUser);
    }

    if (path.startsWith('/users/') && req.params.userId && req.params.action === 'level' && method === 'POST') {
      if (!user) {
        return vercelRes.status(401).json({ message: "Unauthorized" });
      }
      const { authorized, user: dbUser } = await requireLevelJWT(user, 5);
      if (!authorized) {
        return vercelRes.status(403).json({ message: "Level 5+ required" });
      }
      const { newLevel, reason } = req.body;
      if (!newLevel || !reason) {
        return vercelRes.status(400).json({ message: "newLevel and reason are required" });
      }
      const targetUser = await storage.getUser(req.params.userId);
      if (!targetUser) {
        return vercelRes.status(404).json({ message: "User not found" });
      }
      if (targetUser.level === 5 && newLevel !== 5) {
        return vercelRes.status(400).json({ message: "Level 5 demotions require the governance voting process" });
      }
      if (newLevel === 5 && targetUser.level !== 5) {
        return vercelRes.status(400).json({ message: "Level 5 promotions require the governance voting process" });
      }
      const updatedUser = await storage.updateUserLevel(req.params.userId, newLevel, user.id, reason);
      return vercelRes.json(updatedUser);
    }

    if (path === '/level5-governance' && method === 'GET') {
      if (!user) {
        return vercelRes.status(401).json({ message: "Unauthorized" });
      }
      const requestingUser = await storage.getUser(user.id);
      if (!requestingUser) {
        return vercelRes.status(401).json({ message: "User not found" });
      }
      if (requestingUser.level < 5) {
        return vercelRes.status(403).json({ message: "Not authorized" });
      }
      const level5Count = await storage.countLevel5Users();
      const voteThreshold = await storage.getLevel5VoteThreshold();
      const canBootstrap = await storage.canBootstrapPromoteToLevel5();
      return vercelRes.json({
        level5Count,
        voteThreshold,
        canBootstrap,
        rules: {
          description: canBootstrap 
            ? "As the only Level 5, you can directly promote 1 user to Level 5 without voting."
            : level5Count === 2
              ? "With 2 Level 5 members, Level 5 changes require unanimous 2 votes."
              : "With 3+ Level 5 members, Level 5 changes require 3 votes.",
        }
      });
    }

    if (path === '/level5-governance/bootstrap-promote' && method === 'POST') {
      if (!user) {
        return vercelRes.status(401).json({ message: "Unauthorized" });
      }
      const { authorized, user: dbUser } = await requireLevelJWT(user, 5);
      if (!authorized) {
        return vercelRes.status(403).json({ message: "Level 5+ required" });
      }
      const { candidateUserId, reason } = req.body;
      if (!candidateUserId || !reason) {
        return vercelRes.status(400).json({ message: "candidateUserId and reason are required" });
      }
      const canBootstrap = await storage.canBootstrapPromoteToLevel5();
      if (!canBootstrap) {
        return vercelRes.status(400).json({ message: "Bootstrap promotion is only available when there is exactly 1 Level 5 member" });
      }
      const candidate = await storage.getUser(candidateUserId);
      if (!candidate) {
        return vercelRes.status(404).json({ message: "Candidate not found" });
      }
      if (candidate.level === 5) {
        return vercelRes.status(400).json({ message: "User is already Level 5" });
      }
      const updatedUser = await storage.updateUserLevel(candidateUserId, 5, user.id, `Bootstrap promotion to Level 5: ${reason}`);
      return vercelRes.json(updatedUser);
    }

    // Invite routes
    if (path === '/invites' && method === 'GET') {
      if (!user) {
        return vercelRes.status(401).json({ message: "Unauthorized" });
      }
      const links = await storage.getInviteLinksByUser(user.id);
      const linksWithDetails = await Promise.all(
        links.map(async (link) => {
          let usedByName: string | undefined;
          if (link.usedByUserId) {
            const usedBy = await storage.getUser(link.usedByUserId);
            usedByName = usedBy ? `${usedBy.firstName || ""} ${usedBy.lastName || ""}`.trim() || usedBy.email || undefined : undefined;
          }
          return { ...link, usedByName };
        })
      );
      return vercelRes.json(linksWithDetails);
    }

    if (path === '/invites' && method === 'POST') {
      if (!user) {
        return vercelRes.status(401).json({ message: "Unauthorized" });
      }
      const link = await storage.createInviteLink(user.id);
      return vercelRes.json(link);
    }

    // Promotion routes
    if (path === '/promotions' && method === 'GET') {
      if (!user) {
        return vercelRes.status(401).json({ message: "Unauthorized" });
      }
      const requestingUser = await storage.getUser(user.id);
      if (!requestingUser) {
        return vercelRes.status(401).json({ message: "User not found" });
      }
      const status = req.query.status as "open" | "approved" | "rejected" | "expired" | undefined;
      const requests = await storage.getPromotionRequests(status);
      const visibleRequests = requests.filter(r => 
        r.currentLevel <= requestingUser.level && r.proposedLevel <= requestingUser.level
      );
      const requestsWithDetails = await Promise.all(
        visibleRequests.map(async (r) => {
          const details = await storage.getPromotionRequestWithDetails(r.id);
          if (!details) return null;
          const visibleVotes = (details.votes || []).filter((v: any) => 
            v.voter && v.voter.level <= requestingUser.level
          ).map((v: any) => ({
            ...v,
            voter: sanitizeUser(v.voter!, requestingUser.level),
          }));
          return {
            ...details,
            candidate: details.candidate ? sanitizeUser(details.candidate, requestingUser.level) : null,
            proposer: details.proposer ? sanitizeUser(details.proposer, requestingUser.level) : null,
            votes: visibleVotes,
            votesFor: visibleVotes.filter((v: any) => v.vote === "for").length,
            votesAgainst: visibleVotes.filter((v: any) => v.vote === "against").length,
          };
        })
      );
      const validRequests = requestsWithDetails.filter(r => 
        r !== null && r.candidate !== null && r.proposer !== null
      );
      return vercelRes.json(validRequests);
    }

    if (path.startsWith('/promotions/') && req.params.id && method === 'GET') {
      if (!user) {
        return vercelRes.status(401).json({ message: "Unauthorized" });
      }
      const requestingUser = await storage.getUser(user.id);
      if (!requestingUser) {
        return vercelRes.status(401).json({ message: "User not found" });
      }
      const request = await storage.getPromotionRequestWithDetails(req.params.id);
      if (!request) {
        return vercelRes.status(404).json({ message: "Promotion request not found" });
      }
      if (request.currentLevel > requestingUser.level || request.proposedLevel > requestingUser.level) {
        return vercelRes.status(403).json({ message: "Not authorized" });
      }
      const visibleVotes = (request.votes || []).filter((v: any) => 
        v.voter && v.voter.level <= requestingUser.level
      ).map((v: any) => ({
        ...v,
        voter: sanitizeUser(v.voter!, requestingUser.level),
      }));
      return vercelRes.json({
        ...request,
        candidate: request.candidate ? sanitizeUser(request.candidate, requestingUser.level) : null,
        proposer: request.proposer ? sanitizeUser(request.proposer, requestingUser.level) : null,
        votes: visibleVotes,
        votesFor: visibleVotes.filter((v: any) => v.vote === "for").length,
        votesAgainst: visibleVotes.filter((v: any) => v.vote === "against").length,
      });
    }

    if (path === '/promotions' && method === 'POST') {
      if (!user) {
        return vercelRes.status(401).json({ message: "Unauthorized" });
      }
      const creator = await storage.getUser(user.id);
      if (!creator) {
        return vercelRes.status(401).json({ message: "User not found" });
      }
      const candidate = await storage.getUser(req.body.candidateUserId);
      if (!candidate) {
        return vercelRes.status(404).json({ message: "Candidate not found" });
      }
      const suppliedCurrentLevel = parseInt(req.body.currentLevel);
      if (suppliedCurrentLevel !== candidate.level) {
        return vercelRes.status(400).json({ message: "Current level does not match candidate's actual level" });
      }
      const requestType = req.body.requestType || "PROMOTE";
      const proposedLevel = parseInt(req.body.proposedLevel);
      if (requestType === "PROMOTE" || requestType === "PROMOTE_TO_5") {
        if (proposedLevel <= candidate.level) {
          return vercelRes.status(400).json({ message: "Promotion must increase the level" });
        }
        if (proposedLevel > 5) {
          return vercelRes.status(400).json({ message: "Level cannot exceed 5" });
        }
      } else if (requestType === "DEMOTE" || requestType === "DEMOTE_FROM_5") {
        if (proposedLevel >= candidate.level) {
          return vercelRes.status(400).json({ message: "Demotion must decrease the level" });
        }
        if (proposedLevel < 1) {
          return vercelRes.status(400).json({ message: "Level cannot be less than 1" });
        }
      }
      if (creator.level < candidate.level) {
        return vercelRes.status(403).json({ message: "You can only create requests for members at or below your level" });
      }
      if ((requestType === "PROMOTE_TO_5" || requestType === "DEMOTE_FROM_5") && creator.level < 5) {
        return vercelRes.status(403).json({ message: "Only Level 5 members can create Level 5 governance requests" });
      }
      if (requestType === "PROMOTE_TO_5") {
        const canBootstrap = await storage.canBootstrapPromoteToLevel5();
        if (canBootstrap) {
          return vercelRes.status(400).json({ message: "Use bootstrap promotion when there is only 1 Level 5 member" });
        }
      }
      if (requestType === "DEMOTE_FROM_5") {
        const canDemote = await storage.canDemoteFromLevel5(req.body.candidateUserId);
        if (!canDemote) {
          return vercelRes.status(400).json({ message: "Cannot demote the last remaining Level 5 member" });
        }
      }
      let requiredVotes = req.body.requiredVotes || 3;
      let allowedVoterMinLevel = candidate.level;
      if (requestType === "PROMOTE_TO_5" || requestType === "DEMOTE_FROM_5") {
        requiredVotes = await storage.getLevel5VoteThreshold();
        allowedVoterMinLevel = 5;
      }
      const data = insertPromotionRequestSchema.parse({
        candidateUserId: req.body.candidateUserId,
        currentLevel: candidate.level,
        proposedLevel: proposedLevel,
        createdByUserId: user.id,
        justification: req.body.justification,
        requestType,
        requiredVotes,
        allowedVoterMinLevel,
      });
      const request = await storage.createPromotionRequest(data);
      return vercelRes.json(request);
    }

    if (path.startsWith('/promotions/') && req.params.id && req.params.action === 'vote' && method === 'POST') {
      if (!user) {
        return vercelRes.status(401).json({ message: "Unauthorized" });
      }
      const voter = await storage.getUser(user.id);
      if (!voter) {
        return vercelRes.status(401).json({ message: "User not found" });
      }
      const promotion = await storage.getPromotionRequestWithDetails(req.params.id);
      if (!promotion) {
        return vercelRes.status(404).json({ message: "Promotion request not found" });
      }
      if (promotion.status !== "open") {
        return vercelRes.status(400).json({ message: "This promotion is no longer open for voting" });
      }
      if (voter.level < promotion.allowedVoterMinLevel) {
        return vercelRes.status(403).json({ message: `Level ${promotion.allowedVoterMinLevel}+ required to vote on this request` });
      }
      if (voter.level < promotion.currentLevel) {
        return vercelRes.status(403).json({ message: "You can only vote on requests for members at or below your level" });
      }
      const hasVoted = await storage.hasUserVoted(req.params.id, user.id);
      if (hasVoted) {
        return vercelRes.status(400).json({ message: "You have already voted on this request" });
      }
      const voteData = insertVoteSchema.parse({
        promotionRequestId: req.params.id,
        voterUserId: user.id,
        vote: req.body.vote,
        comment: req.body.comment,
      });
      await storage.createVote(voteData);
      const updatedRequest = await storage.processPromotionVotes(req.params.id);
      return vercelRes.json({ success: true, requestStatus: updatedRequest.status });
    }

    // Stats route
    if (path === '/stats' && method === 'GET') {
      if (!user) {
        return vercelRes.status(401).json({ message: "Unauthorized" });
      }
      const dbUser = await storage.getUser(user.id);
      if (!dbUser) {
        return vercelRes.status(401).json({ message: "User not found" });
      }
      const allUsers = await storage.getUsersByLevel();
      const myInvites = await storage.getInvitees(user.id);
      const openPromotions = await storage.getPromotionRequests("open");
      const visibleUsers = allUsers.filter(u => u.level <= dbUser.level);
      const visibleInvites = myInvites.filter(u => u.level <= dbUser.level);
      const levelCounts = [];
      for (let level = 1; level <= dbUser.level; level++) {
        levelCounts.push({
          level,
          count: visibleUsers.filter(u => u.level === level).length,
        });
      }
      const visiblePromotions = openPromotions.filter(promo => 
        promo.currentLevel <= dbUser.level && promo.proposedLevel <= dbUser.level
      );
      let pendingMyVote = 0;
      if (dbUser.level >= 4) {
        for (const promo of visiblePromotions) {
          const hasVoted = await storage.hasUserVoted(promo.id, user.id);
          if (!hasVoted && promo.allowedVoterMinLevel <= dbUser.level) {
            pendingMyVote++;
          }
        }
      }
      return vercelRes.json({
        totalMembers: visibleUsers.length,
        myInviteCount: visibleInvites.length,
        pendingPromotions: visiblePromotions.length,
        pendingMyVote,
        levelDistribution: levelCounts,
        maxVisibleLevel: dbUser.level,
      });
    }

    // 404 for unmatched routes
    const duration = Date.now() - startTime;
    logRequest(method, path, 404, duration);
    return vercelRes.status(404).json({ message: 'Route not found' });
  } catch (error: any) {
    const duration = Date.now() - startTime;
    logRequest(method, path || 'unknown', 500, duration, error);
    console.error('Serverless handler error:', {
      message: error.message,
      stack: error.stack,
      error: error
    });
    return vercelRes.status(500).json({ message: error.message || 'Internal server error' });
  }
}
