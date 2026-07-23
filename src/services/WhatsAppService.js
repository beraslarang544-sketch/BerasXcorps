import { Boom } from '@hapi/boom';
import NodeCache from 'node-cache';
import { Logger } from '../utils/Logger.js';
import { PairingCodeManager } from '../modules/PairingCodeManager.js';

const logger = Logger.getInstance();

export class WhatsAppService {
  constructor() {
    this.sock = null;
    this.usePairingCode = true;
    this.phoneNumber = null;
    this.pairingCodeManager = new PairingCodeManager();
  }

  async initialize(phoneNumber) {
    try {
      this.phoneNumber = phoneNumber;
      logger.info(`🔄 Initializing WhatsApp connection for ${phoneNumber}`);
      
      // Use pairing code instead of QR
      const socket = await this.getPairingSocket();
      return socket;
    } catch (error) {
      logger.error(`WhatsApp initialization error: ${error.message}`);
      throw error;
    }
  }

  async getPairingSocket() {
    try {
      const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = await import('baileys');
      const qrcode = await import('qrcode-terminal');

      const { state, saveCreds } = await useMultiFileAuthState(`./auth_info_${this.phoneNumber}`);

      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: !this.usePairingCode,
        browser: ['Ubuntu', 'Chrome', '121.0'],
        logger: this.getLogger(),
        syncFullHistory: false
      });

      // Pairing code event
      if (this.usePairingCode) {
        this.sock.ev.on('connection.update', async (update) => {
          const { connection, lastDisconnect, pairingCode } = update;
          
          if (pairingCode) {
            logger.info(`\n📱 Pairing Code: ${chalk.yellow.bold(pairingCode)}`);
            await this.pairingCodeManager.savePairingCode(this.phoneNumber, pairingCode);
          }

          if (connection === 'open') {
            logger.success('✅ WhatsApp Connected Successfully!');
          }

          if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            logger.warn(`Connection closed, reconnect: ${shouldReconnect}`);
            if (shouldReconnect) {
              await this.initialize(this.phoneNumber);
            }
          }
        });
      }

      // Credentials update
      this.sock.ev.on('creds.update', saveCreds);

      return this.sock;
    } catch (error) {
      logger.error(`Socket creation error: ${error.message}`);
      throw error;
    }
  }

  async sendMessage(jid, message) {
    try {
      if (!this.sock) {
        throw new Error('WhatsApp not connected');
      }

      const result = await this.sock.sendMessage(jid, message);
      logger.info(`📤 Message sent to ${jid}`);
      return result;
    } catch (error) {
      logger.error(`Send message error: ${error.message}`);
      throw error;
    }
  }

  async sendBulkMessages(recipients, message) {
    try {
      const results = [];
      for (const recipient of recipients) {
        try {
          const result = await this.sendMessage(recipient, message);
          results.push({ recipient, status: 'sent', result });
          logger.info(`✅ Message sent to ${recipient}`);
        } catch (error) {
          results.push({ recipient, status: 'failed', error: error.message });
          logger.error(`❌ Failed to send to ${recipient}`);
        }
      }
      return results;
    } catch (error) {
      logger.error(`Bulk send error: ${error.message}`);
      throw error;
    }
  }

  async getContacts() {
    try {
      if (!this.sock) {
        throw new Error('WhatsApp not connected');
      }

      const contacts = await this.sock.store?.contacts || {};
      return contacts;
    } catch (error) {
      logger.error(`Get contacts error: ${error.message}`);
      return {};
    }
  }

  async disconnect() {
    try {
      if (this.sock) {
        await this.sock.end();
        logger.info('🔌 WhatsApp disconnected');
      }
    } catch (error) {
      logger.error(`Disconnect error: ${error.message}`);
    }
  }

  getLogger() {
    return {
      level: 'error',
      log: () => {}
    };
  }
}
