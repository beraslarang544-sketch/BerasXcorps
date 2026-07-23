import { BaileysSender } from '../modules/BaileysSender.js';
import { Logger } from '../utils/Logger.js';
import { UIManager } from '../utils/UIManager.js';

const logger = Logger.getInstance();
const uiManager = new UIManager();

export class WhatsAppController {
  constructor() {
    this.baileysSender = new BaileysSender();
  }

  async runPairingCodeMode() {
    try {
      uiManager.displayHeader('WHATSAPP PAIRING CODE SENDER');
      
      const phoneNumber = await uiManager.getUserInput(
        '📱 Enter phone number (without +62): '
      );

      if (!this.validatePhoneNumber(phoneNumber)) {
        uiManager.displayError('Invalid Input', 'Phone must start with 8');
        return;
      }

      logger.info(`🔄 Getting pairing code for +62${phoneNumber}...`);
      const pairingCode = await this.baileysSender.displayPairingUI(`62${phoneNumber}`);

      if (pairingCode) {
        uiManager.displaySuccess(
          'Pairing Code Ready',
          `Scan this code on your phone: ${pairingCode}`
        );
        
        // Wait for connection
        await this.waitForConnection(phoneNumber);
      }
    } catch (error) {
      logger.error(`Pairing mode error: ${error.message}`);
      uiManager.displayError('Error', error.message);
    }
  }

  async runSenderMode() {
    try {
      uiManager.displayHeader('WHATSAPP MESSAGE SENDER (Baileys)');
      
      const senderPhone = await uiManager.getUserInput(
        '📱 Your phone number (sender): '
      );
      
      const targetPhone = await uiManager.getUserInput(
        '📨 Target phone number: '
      );

      const message = await uiManager.getUserInput(
        '💬 Message to send: '
      );

      logger.info('🚀 Sending message via Baileys...');
      
      const results = await this.baileysSender.sendViaBaileys(
        `62${senderPhone}`,
        message,
        [`62${targetPhone}`]
      );

      if (results.length > 0 && results[0].status === 'sent') {
        uiManager.displaySuccess('Success', 'Message sent successfully!');
      } else {
        uiManager.displayError('Failed', 'Failed to send message');
      }
    } catch (error) {
      logger.error(`Sender mode error: ${error.message}`);
      uiManager.displayError('Error', error.message);
    }
  }

  async runSessionManager() {
    try {
      uiManager.displayHeader('WHATSAPP SESSION MANAGER');
      
      const sessions = await this.baileysSender.listSessions();
      
      if (sessions.length === 0) {
        uiManager.displayWarning('No Sessions', 'No active WhatsApp sessions');
        return;
      }

      logger.info('\n📱 Active Sessions:');
      sessions.forEach((session, index) => {
        logger.info(`${index + 1}. ${session.phoneNumber} (${session.name})`);
      });

      const choice = await uiManager.getUserInput(
        '\n🔌 Enter session number to disconnect (0 to exit): '
      );

      if (choice === '0') return;

      const sessionIndex = parseInt(choice) - 1;
      if (sessionIndex >= 0 && sessionIndex < sessions.length) {
        await this.baileysSender.disconnectSession(sessions[sessionIndex].phoneNumber);
        uiManager.displaySuccess('Success', 'Session disconnected');
      }
    } catch (error) {
      logger.error(`Session manager error: ${error.message}`);
      uiManager.displayError('Error', error.message);
    }
  }

  async waitForConnection(phoneNumber, maxWait = 120000) {
    try {
      const startTime = Date.now();
      logger.info(`⏳ Waiting for connection (max ${maxWait / 1000}s)...`);

      while (Date.now() - startTime < maxWait) {
        const sessionInfo = await this.baileysSender.getSessionInfo(`62${phoneNumber}`);
        if (sessionInfo) {
          logger.success(`✅ Connected as ${sessionInfo.name}`);
          return true;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      logger.warn('⏱️ Connection timeout');
      return false;
    } catch (error) {
      logger.error(`Wait connection error: ${error.message}`);
      return false;
    }
  }

  validatePhoneNumber(phone) {
    return /^8\d{8,}$/.test(phone);
  }

  async run() {
    try {
      let continueRunning = true;
      while (continueRunning) {
        uiManager.displayHeader('WHATSAPP AUTOMATION MENU');
        logger.info('\n1. Get Pairing Code');
        logger.info('2. Send Message (Baileys)');
        logger.info('3. Manage Sessions');
        logger.info('4. Exit\n');

        const choice = await uiManager.getUserInput('Select option: ');

        switch (choice) {
          case '1':
            await this.runPairingCodeMode();
            break;
          case '2':
            await this.runSenderMode();
            break;
          case '3':
            await this.runSessionManager();
            break;
          case '4':
            await this.baileysSender.disconnectAll();
            continueRunning = false;
            break;
          default:
            uiManager.displayError('Invalid', 'Please select a valid option');
        }
      }
    } catch (error) {
      logger.error(`WhatsApp controller error: ${error.message}`);
      uiManager.displayError('Error', error.message);
    }
  }
}
