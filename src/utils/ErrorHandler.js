import chalk from 'chalk';
import { Logger } from './Logger.js';

const logger = Logger.getInstance();

/**
 * Global Error Handler for BerasXcorps
 */
export class ErrorHandler {
  static readonly ERROR_TYPES = {
    NETWORK: 'NETWORK_ERROR',
    DATABASE: 'DATABASE_ERROR',
    AUTH: 'AUTH_ERROR',
    VALIDATION: 'VALIDATION_ERROR',
    RATE_LIMIT: 'RATE_LIMIT_ERROR',
    PROXY: 'PROXY_ERROR',
    WHATSAPP: 'WHATSAPP_ERROR',
    FIREBASE: 'FIREBASE_ERROR',
    INTERNAL: 'INTERNAL_ERROR',
  };

  static handle(error, context = 'Unknown') {
    const errorType = this.detectErrorType(error);
    const errorMessage = this.formatError(error, errorType, context);

    logger.error(errorMessage);

    // Send to monitoring if enabled
    if (process.env.ERROR_NOTIFICATION_ENABLED === 'true') {
      this.notifyError(error, errorType, context);
    }

    return {
      type: errorType,
      message: error.message,
      context,
      timestamp: new Date().toISOString(),
    };
  }

  static detectErrorType(error) {
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return this.ERROR_TYPES.NETWORK;
    }
    if (error.message.includes('MongoDB')) {
      return this.ERROR_TYPES.DATABASE;
    }
    if (error.message.includes('JWT') || error.message.includes('Unauthorized')) {
      return this.ERROR_TYPES.AUTH;
    }
    if (error.message.includes('Rate limit')) {
      return this.ERROR_TYPES.RATE_LIMIT;
    }
    if (error.message.includes('Proxy')) {
      return this.ERROR_TYPES.PROXY;
    }
    if (error.message.includes('WhatsApp')) {
      return this.ERROR_TYPES.WHATSAPP;
    }
    if (error.message.includes('Firebase')) {
      return this.ERROR_TYPES.FIREBASE;
    }
    if (error.name === 'ValidationError') {
      return this.ERROR_TYPES.VALIDATION;
    }
    return this.ERROR_TYPES.INTERNAL;
  }

  static formatError(error, type, context) {
    const colors = {
      [this.ERROR_TYPES.NETWORK]: 'red',
      [this.ERROR_TYPES.DATABASE]: 'magenta',
      [this.ERROR_TYPES.AUTH]: 'yellow',
      [this.ERROR_TYPES.VALIDATION]: 'blue',
      [this.ERROR_TYPES.RATE_LIMIT]: 'cyan',
      [this.ERROR_TYPES.PROXY]: 'red',
      [this.ERROR_TYPES.WHATSAPP]: 'green',
      [this.ERROR_TYPES.FIREBASE]: 'yellow',
      [this.ERROR_TYPES.INTERNAL]: 'red',
    };

    const color = colors[type] || 'white';
    return chalk[color](`[${type}] ${context}: ${error.message}`);
  }

  static async notifyError(error, errorType, context) {
    try {
      const webhookUrl = process.env.NOTIFICATION_WEBHOOK;
      if (!webhookUrl) return;

      const message = {
        text: `🚨 Error in BerasXcorps`,
        attachments: [
          {
            color: 'danger',
            fields: [
              { title: 'Type', value: errorType, short: true },
              { title: 'Context', value: context, short: true },
              { title: 'Message', value: error.message, short: false },
              { title: 'Stack', value: error.stack?.substring(0, 500), short: false },
            ],
          },
        ],
      };

      // Send to webhook (Slack, Discord, etc)
      // await axios.post(webhookUrl, message);
    } catch (e) {
      logger.warn(`Failed to send error notification: ${e.message}`);
    }
  }

  static createErrorResponse(error, statusCode = 500) {
    const errorType = this.detectErrorType(error);
    
    return {
      success: false,
      error: {
        type: errorType,
        message: error.message,
        timestamp: new Date().toISOString(),
      },
      statusCode,
    };
  }
}

// Global uncaught exception handler
process.on('uncaughtException', (error) => {
  ErrorHandler.handle(error, 'UncaughtException');
  process.exit(1);
});

// Global unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
  ErrorHandler.handle(new Error(String(reason)), 'UnhandledRejection');
});

export default ErrorHandler;
