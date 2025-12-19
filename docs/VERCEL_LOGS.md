# Viewing Logs in Vercel

This guide explains how to view logs for your Vercel deployment.

## Where to Find Logs

### 1. Vercel Dashboard (Recommended)

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project
3. Click on the **"Deployments"** tab
4. Click on a specific deployment
5. Click on the **"Functions"** tab
6. Click on `api/[...path]` function
7. You'll see real-time logs for that function

### 2. Vercel CLI

You can also view logs using the Vercel CLI:

```bash
# Install Vercel CLI if you haven't
npm install -g vercel

# Login to Vercel
vercel login

# View logs for your project
vercel logs [your-project-name]

# Follow logs in real-time
vercel logs [your-project-name] --follow
```

### 3. Function Logs Tab

1. In your Vercel project dashboard
2. Go to **"Functions"** tab (in the top navigation)
3. Click on `api/[...path]`
4. View logs, invocations, and errors

## What Logs Are Available

The API route now includes comprehensive logging:

- **Request Logging**: Every request logs:
  - Timestamp
  - HTTP method
  - Path
  - Status code
  - Duration (in milliseconds)
  
- **Error Logging**: All errors include:
  - Error message
  - Stack trace
  - Request context

- **Request Details**: For debugging, logs include:
  - Query parameters
  - URL
  - Headers (host, user-agent, content-type)

## Log Format

Logs follow this format:
```
[ISO_TIMESTAMP] METHOD /path STATUS_CODE in XXXms
```

Example:
```
[2024-01-15T10:30:45.123Z] GET /api/auth/user 200 in 45ms
[2024-01-15T10:30:46.456Z] POST /api/login 401 in 12ms
```

## Troubleshooting

### No Logs Appearing

1. **Check Function Invocations**: 
   - Make sure your function is actually being called
   - Check the "Invocations" tab in Vercel dashboard
   
2. **Check Deployment Status**:
   - Ensure your latest deployment is active
   - Redeploy if necessary: `vercel --prod`

3. **Check Environment Variables**:
   - Ensure all required environment variables are set
   - Check that `NODE_ENV=production` is set

4. **Wait for Cold Start**:
   - First invocation after deployment may take longer
   - Logs may appear with a slight delay

### Logs Not Showing Errors

- Errors are logged with `console.error()` which should appear in Vercel logs
- Check both the "Functions" tab and deployment-specific logs
- Use `vercel logs --follow` to see real-time error output

## Best Practices

1. **Monitor Regularly**: Check logs after deployments
2. **Set Up Alerts**: Configure Vercel notifications for errors
3. **Use Structured Logging**: The current implementation uses structured logging for easier debugging
4. **Filter Logs**: Use Vercel's log filtering to find specific requests

## Additional Resources

- [Vercel Logs Documentation](https://vercel.com/docs/observability/logs)
- [Vercel Functions Monitoring](https://vercel.com/docs/observability/monitoring)
