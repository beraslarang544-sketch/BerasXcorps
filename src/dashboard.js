import express from 'express';
import { Logger } from './utils/Logger.js';
import { TokenManager, generateChatTokens } from './utils/TokenManager.js';
import { adminRoutes } from './routes/adminRoutes.js';

const logger = Logger.getInstance();
const app = express();
const tokenManager = new TokenManager();

app.use(express.json());

// Admin routes
app.use('/api/admin', adminRoutes);

// Initialize and show tokens
async function initialize() {
  try {
    logger.info('🚀 Initializing BerasXcorps v3.0...');
    
    // Generate and display tokens for chat
    const tokens = await generateChatTokens();
    
    // Store in environment or memory
    global.ADMIN_TOKEN = tokens.admin.token;
    global.USER_TOKEN = tokens.user.token;

    logger.success('\n✅ Initialization complete!');
    logger.info('\n📌 Token Usage:');
    logger.info('   Authorization: Bearer <TOKEN>');
    logger.info('\n');
  } catch (error) {
    logger.error(`Initialization error: ${error.message}`);
  }
}

// Start
const PORT = process.env.API_PORT || 3000;
app.listen(PORT, async () => {
  await initialize();
  logger.success(`\n🌐 Server running on http://localhost:${PORT}`);
});

export { app, tokenManager };
