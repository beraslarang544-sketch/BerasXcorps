import chalk from 'chalk';
import { Logger } from '../utils/Logger.js';
import { WhatsAppService } from '../services/WhatsAppService.js';
import { UIManager } from '../utils/UIManager.js';

const logger = Logger.getInstance();
const uiManager = new UIManager();

export class BaileysSender {
  constructor() {
    this.whatsappService = new WhatsAppService();
    this.activeConnections = new Map();
  }

  async getPairingCode(phoneNumber) {
    try {
      logger.info(`🔐 Requesting pairing code for +${phoneNumber}`);
      
      const socket = await this.whatsappService.initialize(phoneNumber);
      
      // Wait for pairing code
      await new Promise(resolve => {
        const timeout = setTimeout(() => {
          logger.error('⏱️ Pairing code timeout');
          resolve();
        }, 60000); // 60 second timeout

        socket.ev.on('connection.update', (update) => {
          if (update.pairingCode) {
            clearTimeout(timeout);
            resolve();
          }
        });
      });

      const pairingCode = await this.whatsappService.pairingCodeManager.getPairingCode(phoneNumber);
      return pairingCode?.code || null;
    } catch (error) {
      logger.error(`Pairing code error: ${error.message}`);
      return null;
    }
  }

  async sendViaBaileys(phoneNumber, message, targetNumbers) {
    try {
      logger.info(`📨 Initializing Baileys sender for ${phoneNumber}`);
      
      // Get or create connection
      let connection = this.activeConnections.get(phoneNumber);
      if (!connection) {
        connection = await this.whatsappService.initialize(phoneNumber);
        this.activeConnections.set(phoneNumber, connection);
      }

      // Wait for connection
      await new Promise(resolve => {
        const checkConnection = () => {
          if (connection.user) {
            resolve();
          } else {
            setTimeout(checkConnection, 100);
          }
        };
        checkConnection();
      });

      logger.info(`📤 Sending ${targetNumbers.length} messages`);
      const results = await this.whatsappService.sendBulkMessages(targetNumbers, {
        text: message
      });

      return results;
    } catch (error) {
      logger.error(`Baileys send error: ${error.message}`);
      return [];
    }
  }

  async getSessionInfo(phoneNumber) {
    try {
      const connection = this.activeConnections.get(phoneNumber);
      if (!connection) {
        return null;
      }

      return {
        jid: connection.user?.id,
        name: connection.user?.name,
        status: 'connected',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Get session info error: ${error.message}`);
      return null;
    }
  }

  async listSessions() {
    try {
      const sessions = [];
      for (const [phone, connection] of this.activeConnections) {
        if (connection.user) {
          sessions.push({
            phoneNumber: phone,
            jid: connection.user.id,
            connected: true,
            name: connection.user.name
          });
        }
      }
      return sessions;
    } catch (error) {
      logger.error(`List sessions error: ${error.message}`);
      return [];
    }
  }

  async disconnectSession(phoneNumber) {
    try {
      const connection = this.activeConnections.get(phoneNumber);
      if (connection) {
        await this.whatsappService.disconnect();
        this.activeConnections.delete(phoneNumber);
        logger.info(`🔌 Session disconnected: ${phoneNumber}`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error(`Disconnect error: ${error.message}`);
      return false;
    }
  }

  async disconnectAll() {
    try {
      for (const [phone] of this.activeConnections) {
        await this.disconnectSession(phone);
      }
      logger.info('🔌 All sessions disconnected');
    } catch (error) {
      logger.error(`Disconnect all error: ${error.message}`);
    }
  }

  async displayPairingUI(phoneNumber) {
    try {
      logger.info(`\n${chalk.cyan('═'.repeat(50))}`);
      logger.info(chalk.cyan.bold('   WHATSAPP PAIRING CODE SENDER'));
      logger.info(chalk.cyan('═'.repeat(50)));
      logger.info(`\n📱 Phone Number: ${chalk.yellow(phoneNumber)}`);
      logger.info(chalk.green('⏳ Waiting for pairing code...\n'));
      
      const pairingCode = await this.getPairingCode(phoneNumber);
      
      if (pairingCode) {
        logger.info(`${chalk.green.bold('✓ Pairing Code Retrieved:')}`);
        logger.info(`${chalk.yellow.bold(pairingCode)}\n`);
        return pairingCode;
      } else {
        logger.error('Failed to get pairing code');
        return null;
      }
    } catch (error) {
      logger.error(`UI display error: ${error.message}`);
      return null;
    }
  }
}
