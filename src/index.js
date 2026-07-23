#!/usr/bin/env node

import { AppController } from './controllers/AppController.js';
import { Logger } from './utils/Logger.js';

const logger = Logger.getInstance();

async function main() {
  try {
    logger.info('🚀 Starting BerasXcorps v2.0 (Node.js)...');
    const app = new AppController();
    await app.run();
  } catch (error) {
    logger.error(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

main();
