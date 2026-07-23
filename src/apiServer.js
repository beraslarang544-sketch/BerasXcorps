import express from 'express';
import { Logger } from './utils/Logger.js';
import { apiUsageMiddleware, generateTokenConfig } from './utils/apiUtils.js';
import { adminRoutes } from './routes/adminRoutes.js';
import { User } from './models/schemas.js';
import path from 'path';
import fs from 'fs/promises';

const logger = Logger.getInstance();
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

// Apply usage middleware
app.use(apiUsageMiddleware);

// Admin routes
app.use('/api/admin', adminRoutes);

/**
 * Download token config file
 */
app.get('/api/download-token-config/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const user = await User.findOne({ apiKey: token });
    if (!user) {
      return res.status(404).json({ error: '❌ Token not found' });
    }

    const config = generateTokenConfig(token, user.username, user.role);

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${user.username}-token-config.txt"`);
    res.send(config);

    logger.success(`✅ Token config downloaded for ${user.username}`);
  } catch (error) {
    logger.error(`Download config error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get public token download link (for semawur.com)
 */
app.get('/api/token-download-link/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const user = await User.findOne({ apiKey: token });
    if (!user) {
      return res.status(404).json({ error: '❌ Token not found' });
    }

    const downloadLink = `http://${req.get('host')}/api/download-token-config/${token}`;

    res.json({
      success: true,
      username: user.username,
      role: user.role,
      downloadLink,
      instruction: `Download from: ${downloadLink}`,
      details: {
        features: user.permissions,
        dailyLimit: user.role === 'premium' ? 500 : user.role === 'admin' ? 1000 : user.role === 'owner' ? 'unlimited' : 100,
        credits: user.credits,
        isPremium: user.isPremium
      }
    });
  } catch (error) {
    logger.error(`Download link error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Public API docs endpoint
 */
app.get('/api/docs', (req, res) => {
  const docs = `
    <html>
      <head>
        <title>BerasXcorps API Documentation</title>
        <style>
          body { font-family: Arial; margin: 40px; background: #1e1e1e; color: #fff; }
          h1 { color: #0fa; }
          .endpoint { background: #333; padding: 10px; margin: 10px 0; border-radius: 5px; }
          .method { color: #0f0; font-weight: bold; }
          .url { color: #0af; }
          code { background: #222; padding: 2px 5px; border-radius: 3px; }
        </style>
      </head>
      <body>
        <h1>🔧 BerasXcorps API Documentation</h1>
        <h2>User Token Endpoints</h2>
        <div class="endpoint">
          <p><span class="method">POST</span> <span class="url">/api/admin/generate-user-token</span></p>
          <p>Generate a new user token</p>
          <code>Headers: Authorization: Bearer JWT_TOKEN</code>
        </div>
        <div class="endpoint">
          <p><span class="method">GET</span> <span class="url">/api/admin/token-info</span></p>
          <p>Get token information and daily limits</p>
        </div>
        <div class="endpoint">
          <p><span class="method">GET</span> <span class="url">/api/admin/usage-stats</span></p>
          <p>Get API usage statistics</p>
        </div>
        <h2>Download Configuration</h2>
        <div class="endpoint">
          <p><span class="method">GET</span> <span class="url">/api/download-token-config/:token</span></p>
          <p>Download token configuration file</p>
        </div>
        <div class="endpoint">
          <p><span class="method">GET</span> <span class="url">/api/token-download-link/:token</span></p>
          <p>Get download link for token config (for semawur.com)</p>
        </div>
        <h2>Daily Limits</h2>
        <ul>
          <li><strong>User:</strong> 100 requests/day</li>
          <li><strong>Premium:</strong> 500 requests/day</li>
          <li><strong>Admin:</strong> 1000 requests/day</li>
          <li><strong>Owner:</strong> Unlimited</li>
        </ul>
      </body>
    </html>
  `;
  res.send(docs);
});

/**
 * Health check
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Start
const PORT = process.env.API_PORT || 3000;
app.listen(PORT, () => {
  logger.success(`\n🚀 API Server running on http://localhost:${PORT}`);
  logger.info(`\n📚 Documentation: http://localhost:${PORT}/api/docs`);
  logger.info(`🏥 Health Check: http://localhost:${PORT}/api/health`);
  logger.info('\n');
});

export { app };
