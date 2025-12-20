import type { VercelRequest, VercelResponse } from '@vercel/node';
import { app, initializeApp } from '../server/app';

// Initialize the Express app on first request
let appInitialized = false;

export default async function handler(
  vercelReq: VercelRequest,
  vercelRes: VercelResponse
) {
  // Initialize app on first request
  if (!appInitialized) {
    await initializeApp();
    appInitialized = true;
  }

  // Extract path from Vercel's catch-all routing
  let pathArray: string[] = [];
  
  if (vercelReq.query.path) {
    if (Array.isArray(vercelReq.query.path)) {
      pathArray = vercelReq.query.path as string[];
    } else {
      pathArray = [vercelReq.query.path as string];
    }
  }
  
  // Fallback: extract from URL if query.path is not set
  if (pathArray.length === 0 && vercelReq.url) {
    const urlPath = vercelReq.url.split('/api/')[1]?.split('?')[0];
    if (urlPath) {
      pathArray = urlPath.split('/').filter(p => p);
    }
  }
  
  // Reconstruct full path with /api prefix (since Express routes already have it)
  const expressPath = pathArray.length > 0 
    ? `/api/${pathArray.join('/')}` 
    : vercelReq.url?.startsWith('/api') 
      ? vercelReq.url.split('?')[0] 
      : '/api';

  // Debug logging (reduced verbosity for cookie header in production)
  console.log('[API Handler]', {
    method: vercelReq.method,
    originalUrl: vercelReq.url,
    queryPath: vercelReq.query.path,
    pathArray,
    expressPath,
    hasCookies: !!(vercelReq.cookies || vercelReq.headers.cookie),
    cookieHeaderPresent: !!vercelReq.headers.cookie,
    cookieHeaderLength: vercelReq.headers.cookie 
      ? (typeof vercelReq.headers.cookie === 'string' 
          ? vercelReq.headers.cookie.length 
          : Array.isArray(vercelReq.headers.cookie) 
            ? vercelReq.headers.cookie[0]?.length || 0 
            : 0)
      : 0,
    parsedCookiesCount: vercelReq.cookies ? Object.keys(vercelReq.cookies).length : 0,
  });

  // Parse cookies from Cookie header - merge both parsed cookies and raw header
  let cookies: Record<string, string> = {};
  
  // Start with Vercel's parsed cookies if available
  if (vercelReq.cookies && typeof vercelReq.cookies === 'object') {
    cookies = { ...vercelReq.cookies };
  }
  
  // Also parse from Cookie header to catch any cookies Vercel might have missed
  if (vercelReq.headers.cookie) {
    const cookieHeader = typeof vercelReq.headers.cookie === 'string' 
      ? vercelReq.headers.cookie 
      : Array.isArray(vercelReq.headers.cookie)
        ? vercelReq.headers.cookie[0]
        : String(vercelReq.headers.cookie);
    
    if (cookieHeader) {
      cookieHeader.split(';').forEach(cookie => {
        const trimmed = cookie.trim();
        if (!trimmed) return;
        
        const equalIndex = trimmed.indexOf('=');
        if (equalIndex === -1) {
          // Cookie without value (e.g., "secure")
          const key = trimmed;
          if (key && !cookies[key]) {
            cookies[key] = '';
          }
        } else {
          const key = trimmed.substring(0, equalIndex).trim();
          const value = trimmed.substring(equalIndex + 1).trim();
          if (key) {
            try {
              cookies[key] = decodeURIComponent(value);
            } catch (e) {
              // If decode fails, use raw value
              cookies[key] = value;
            }
          }
        }
      });
    }
  }
  
  // Log cookie parsing for debugging (but not the values for security)
  if (Object.keys(cookies).length > 0) {
    console.log('[API Handler] Parsed cookies:', Object.keys(cookies).join(', '));
  }

  // Create a minimal adapter for Express
  // Express works with Node.js req/res, so we create compatible objects
  const req = Object.create(vercelReq);
  req.method = vercelReq.method || 'GET';
  req.url = expressPath + (vercelReq.url?.includes('?') ? '?' + vercelReq.url.split('?')[1] : '');
  req.path = expressPath;
  req.originalUrl = vercelReq.url || expressPath;
  req.query = vercelReq.query;
  req.body = vercelReq.body || {};
  req.headers = vercelReq.headers;
  req.cookies = cookies;
  req.session = undefined; // Will be set by session middleware
  req.user = undefined; // Will be set by auth middleware
  
  // Add Passport methods (will be overridden by Passport middleware if it runs)
  req.isAuthenticated = function() {
    return !!(this.user || this.session?.passport?.user);
  };
  
  req.login = req.logIn = function(user: any, callback: (err?: any) => void) {
    if (!this.session) {
      this.session = {};
    }
    if (!this.session.passport) {
      this.session.passport = {};
    }
    this.session.passport.user = user;
    this.user = user;
    if (callback) callback();
  };
  
  req.logout = req.logOut = function(callback: (err?: any) => void) {
    this.user = undefined;
    if (this.session) {
      delete this.session.passport;
    }
    if (callback) callback();
  };
  
  // Add Express-specific methods
  req.get = function(name: string) {
    const lowerName = name.toLowerCase();
    if (lowerName === 'host') {
      // On Vercel, prefer x-forwarded-host, then host header
      return this.headers['x-forwarded-host'] 
        || this.headers.host 
        || this.headers[':authority'] 
        || '';
    }
    return this.headers[lowerName] || this.headers[name];
  };
  
  // On Vercel, always use https
  req.protocol = (vercelReq.headers['x-forwarded-proto'] as string) || 
                 (process.env.VERCEL ? 'https' : 'http');
  req.secure = req.protocol === 'https';
  // For hostname, prefer x-forwarded-host (Vercel's header)
  req.hostname = (vercelReq.headers['x-forwarded-host'] as string) || 
                 vercelReq.headers.host || '';
  req.host = req.hostname;
  req.ip = (vercelReq.headers['x-forwarded-for'] as string || vercelReq.headers['x-real-ip'] as string || '').split(',')[0].trim();
  
  // Add methods that Express/session middleware might use
  req.connection = { remoteAddress: req.ip } as any;
  req.socket = req.connection;

  // Create response adapter
  const res = Object.create(vercelRes);
  let statusCode = 200;
  const responseHeaders: Record<string, string | string[]> = {};
  let responseBody: any = null;
  let isRedirect = false;
  let redirectUrl: string | null = null;

  // Track if response was sent
  let responseSent = false;
  res.headersSent = false;

  // Handle finish event for Express logging middleware
  const finishCallbacks: Array<() => void> = [];
  res.on = function(event: string, callback: Function) {
    if (event === 'finish') {
      finishCallbacks.push(callback as () => void);
    }
    return this;
  };

  // Helper to trigger finish event
  const triggerFinish = () => {
    if (!responseSent) {
      responseSent = true;
      res.headersSent = true;
      finishCallbacks.forEach(cb => {
        try {
          cb();
        } catch (e) {
          console.error('Finish callback error:', e);
        }
      });
    }
  };

  // Override response methods to capture
  res.status = function(code: number) {
    statusCode = code;
    return this;
  };

  res.json = function(body: any) {
    if (!responseSent) {
      responseSent = true;
      responseHeaders['content-type'] = 'application/json';
      vercelRes.status(statusCode);
      Object.keys(responseHeaders).forEach(key => {
        const value = responseHeaders[key];
        if (Array.isArray(value)) {
          value.forEach(v => vercelRes.setHeader(key, v));
        } else {
          vercelRes.setHeader(key, value as string);
        }
      });
      vercelRes.json(body);
      triggerFinish();
    }
    return this;
  };

  res.send = function(data: any) {
    if (!responseSent) {
      if (typeof data === 'object' && data !== null) {
        return res.json(data);
      }
      responseBody = data;
      responseHeaders['content-type'] = 'text/plain';
      vercelRes.status(statusCode);
      Object.keys(responseHeaders).forEach(key => {
        const value = responseHeaders[key];
        if (Array.isArray(value)) {
          value.forEach(v => vercelRes.setHeader(key, v));
        } else {
          vercelRes.setHeader(key, value as string);
        }
      });
      vercelRes.send(data);
      triggerFinish();
    }
    return this;
  };

  res.end = function(data?: any) {
    if (!responseSent) {
      if (data) {
        responseBody = data;
      }
      vercelRes.status(statusCode);
      Object.keys(responseHeaders).forEach(key => {
        const value = responseHeaders[key];
        if (Array.isArray(value)) {
          value.forEach(v => vercelRes.setHeader(key, v));
        } else {
          vercelRes.setHeader(key, value as string);
        }
      });
      if (responseBody !== null) {
        vercelRes.send(responseBody);
      } else {
        vercelRes.end();
      }
      triggerFinish();
    }
    return this;
  };

  res.redirect = function(url: string | number, url2?: string) {
    if (!responseSent) {
      responseSent = true;
      isRedirect = true;
      if (typeof url === 'number') {
        statusCode = url;
        redirectUrl = url2 || '/';
      } else {
        statusCode = 302;
        redirectUrl = url;
      }
      // Set headers before redirect
      Object.keys(responseHeaders).forEach(key => {
        const value = responseHeaders[key];
        if (Array.isArray(value)) {
          value.forEach(v => vercelRes.setHeader(key, v));
        } else {
          vercelRes.setHeader(key, value as string);
        }
      });
      vercelRes.redirect(statusCode, redirectUrl);
      triggerFinish();
    }
    return this;
  };

  res.setHeader = function(name: string, value: string | string[]) {
    responseHeaders[name.toLowerCase()] = value;
    vercelRes.setHeader(name, value);
    return this;
  };

  res.set = function(name: string, value: string | string[]) {
    return res.setHeader(name, value);
  };

  res.cookie = function(name: string, value: string, options?: any) {
    let cookieStr = `${name}=${encodeURIComponent(value)}`;
    if (options) {
      if (options.maxAge) cookieStr += `; Max-Age=${Math.floor(options.maxAge / 1000)}`; // Convert ms to seconds
      if (options.domain) cookieStr += `; Domain=${options.domain}`;
      if (options.path) cookieStr += `; Path=${options.path || '/'}`;
      if (options.expires) cookieStr += `; Expires=${options.expires.toUTCString()}`;
      if (options.httpOnly) cookieStr += `; HttpOnly`;
      // For Vercel, always use Secure and SameSite=None if secure is true
      if (options.secure !== false) {
        cookieStr += `; Secure`;
        // Default to SameSite=None for Vercel (cross-origin cookies)
        if (options.sameSite) {
          cookieStr += `; SameSite=${options.sameSite}`;
        } else if (options.secure === true || process.env.VERCEL) {
          cookieStr += `; SameSite=None`;
        }
      } else if (options.sameSite) {
        cookieStr += `; SameSite=${options.sameSite}`;
      }
    }
    const existing = responseHeaders['set-cookie'] || [];
    const cookies = Array.isArray(existing) ? existing : [existing].filter(Boolean);
    cookies.push(cookieStr);
    res.setHeader('Set-Cookie', cookies);
    console.log('[Cookie Set]', { name, hasValue: !!value, options, cookieStr });
    return this;
  };

  res.getHeader = function(name: string) {
    return responseHeaders[name.toLowerCase()];
  };

  res.header = function(name: string, value?: string) {
    if (value !== undefined) {
      return res.setHeader(name, value);
    }
    return res.getHeader(name);
  };

  res.type = function(type: string) {
    res.setHeader('Content-Type', type);
    return this;
  };

  // Handle the request with Express app
  return new Promise<void>((resolve) => {
    let handled = false;
    
    // Express app is a function that takes (req, res, next)
    try {
      app(req, res, (err?: any) => {
        if (handled) return;
        handled = true;
        
        if (err) {
          console.error('Express error:', err);
          if (!responseSent) {
            vercelRes.status(500).json({ message: err.message || 'Internal server error' });
            triggerFinish();
          }
          resolve();
        } else {
          // If Express didn't send a response, send a default 404
          if (!responseSent) {
            vercelRes.status(404).json({ message: 'Not found' });
            triggerFinish();
          }
          resolve();
        }
      });
    } catch (error) {
      console.error('Error calling Express app:', error);
      if (!responseSent) {
        vercelRes.status(500).json({ message: 'Internal server error' });
        triggerFinish();
      }
      resolve();
    }
  });
}
