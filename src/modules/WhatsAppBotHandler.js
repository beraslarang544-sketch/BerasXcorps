import { Logger } from '../utils/Logger.js';
import { BaileysSender } from './BaileysSender.js';

const logger = Logger.getInstance();

export class WhatsAppBotHandler {
  constructor() {
    this.baileysSender = new BaileysSender();
    this.messageHandlers = new Map();
    this.setupDefaultHandlers();
  }

  setupDefaultHandlers() {
    // Handle text messages
    this.on('message', this.handleMessage.bind(this));
    
    // Handle group invites
    this.on('group.invite', this.handleGroupInvite.bind(this));
  }

  on(event, handler) {
    if (!this.messageHandlers.has(event)) {
      this.messageHandlers.set(event, []);
    }
    this.messageHandlers.get(event).push(handler);
  }

  emit(event, data) {
    const handlers = this.messageHandlers.get(event) || [];
    handlers.forEach(handler => handler(data));
  }

  async handleMessage(message) {
    try {
      logger.info(`📨 Message received: ${message.body}`);
      
      // Auto-reply example
      if (message.body.toLowerCase().includes('ping')) {
        await this.baileysSender.whatsappService.sendMessage(message.from, {
          text: '🏓 Pong!'
        });
      }
    } catch (error) {
      logger.error(`Message handler error: ${error.message}`);
    }
  }

  async handleGroupInvite(invite) {
    try {
      logger.info(`👥 Group invite received: ${invite.subject}`);
      // Handle group invites
    } catch (error) {
      logger.error(`Group invite handler error: ${error.message}`);
    }
  }

  async startBot(phoneNumber) {
    try {
      logger.info(`🤖 Starting bot for ${phoneNumber}`);
      
      const socket = await this.baileysSender.whatsappService.initialize(phoneNumber);
      
      // Listen to messages
      socket.ev.on('messages.upsert', async ({ messages, type }) => {
        for (const msg of messages) {
          if (!msg.key.fromMe) {
            this.emit('message', msg);
          }
        }
      });

      logger.success(`✅ Bot started for ${phoneNumber}`);
    } catch (error) {
      logger.error(`Bot start error: ${error.message}`);
    }
  }

  async stopBot(phoneNumber) {
    try {
      await this.baileysSender.disconnectSession(phoneNumber);
      logger.info(`🛑 Bot stopped for ${phoneNumber}`);
    } catch (error) {
      logger.error(`Bot stop error: ${error.message}`);
    }
  }
}
