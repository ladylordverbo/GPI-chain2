import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase, checkUserRegistration } from '../server/supabaseAuth';
import { generateToken } from '../server/jwtAuth';
import { storage } from '../server/storage';

export default async function handler(
  vercelReq: VercelRequest,
  vercelRes: VercelResponse
) {
  const method = vercelReq.method || 'GET';

  if (method === 'GET') {
    // OAuth login - redirect to Supabase OAuth
    const inviteToken = vercelReq.query.invite as string | undefined;
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
      return vercelRes.status(400).json({ error: error.message });
    }

    if (data?.url) {
      // Store invite token in URL state or return it to client
      // For serverless, we'll pass it via the redirect URL
      const finalUrl = inviteToken 
        ? `${data.url}&state=${encodeURIComponent(JSON.stringify({ invite: inviteToken }))}`
        : data.url;
      return vercelRes.redirect(finalUrl);
    }

    return vercelRes.status(500).json({ error: 'OAuth initialization failed' });
  }

  if (method === 'POST') {
    // Email/password login
    const { email, password, invite } = vercelReq.body;
    
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
        return vercelRes.json({ pending: true, token: jwtToken });
      }

      // User is fully registered - generate JWT token
      const jwtToken = generateToken({ ...dbUser, id: authData.user.id, email: authData.user.email });
      vercelRes.setHeader('Set-Cookie', `jwt=${jwtToken}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${7 * 24 * 60 * 60}`);
      return vercelRes.json({ success: true, user: dbUser, token: jwtToken });
    } catch (error: any) {
      console.error('Login error:', error);
      return vercelRes.status(500).json({ message: error.message || 'Login failed' });
    }
  }

  // Method not allowed
  return vercelRes.status(405).json({ message: 'Method not allowed' });
}
