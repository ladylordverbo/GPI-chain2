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

  // Create a minimal adapter for Express
  // Express works with Node.js req/res, so we create compatible objects
  const req = Object.create(vercelReq);
  req.url = expressPath + (vercelReq.url?.includes('?') ? '?' + vercelReq.url.split('?')[1] : '');
  req.path = expressPath;
  req.originalUrl = vercelReq.url || expressPath;
  req.query = vercelReq.query;
  
  // Add Express-specific methods
  req.get = function(name: string) {
    return this.headers[name.toLowerCase()];
  };
  
  req.protocol = (vercelReq.headers['x-forwarded-proto'] as string) || 'https';
  req.secure = req.protocol === 'https';
  req.hostname = vercelReq.headers.host || '';
  req.ip = (vercelReq.headers['x-forwarded-for'] as string || vercelReq.headers['x-real-ip'] as string || '').split(',')[0].trim();

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
      isRedirect = true;
      if (typeof url === 'number') {
        statusCode = url;
        redirectUrl = url2 || '/';
      } else {
        statusCode = 302;
        redirectUrl = url;
      }
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
    let cookieStr = `${name}=${value}`;
    if (options) {
      if (options.maxAge) cookieStr += `; Max-Age=${options.maxAge}`;
      if (options.domain) cookieStr += `; Domain=${options.domain}`;
      if (options.path) cookieStr += `; Path=${options.path || '/'}`;
      if (options.expires) cookieStr += `; Expires=${options.expires.toUTCString()}`;
      if (options.httpOnly) cookieStr += `; HttpOnly`;
      if (options.secure) cookieStr += `; Secure`;
      if (options.sameSite) cookieStr += `; SameSite=${options.sameSite}`;
    }
    const existing = responseHeaders['set-cookie'] || [];
    const cookies = Array.isArray(existing) ? existing : [existing].filter(Boolean);
    cookies.push(cookieStr);
    res.setHeader('Set-Cookie', cookies);
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
  });
}
