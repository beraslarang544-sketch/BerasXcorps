import express from 'express';
import bodyParser from 'body-parser';
import { BaileysSender } from '../modules/BaileysSender.js';
import { Logger } from '../utils/Logger.js';

const logger = Logger.getInstance();

export class BaileysAPI {
  constructor(port = 3000) {
    this.app = express();
    this.port = port;
    this.baileysSender = new BaileysSender();
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(bodyParser.json());
    this.app.use(bodyParser.urlencoded({ extended: true }));
  }

  setupRoutes() {
    // Get pairing code
    this.app.get('/api/pairing-code/:phone', async (req, res) => {
      try {
        const { phone } = req.params;
        logger.info(`API: Get pairing code for ${phone}`);
        
        const pairingCode = await this.baileysSender.getPairingCode(phone);
        res.json({ success: !!pairingCode, pairingCode });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Send message
    this.app.post('/api/send-message', async (req, res) => {
      try {
        const { sender, recipient, message } = req.body;
        logger.info(`API: Send message from ${sender} to ${recipient}`);
        
        const results = await this.baileysSender.sendViaBaileys(sender, message, [recipient]);
        res.json({ success: true, results });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Bulk send
    this.app.post('/api/bulk-send', async (req, res) => {
      try {
        const { sender, recipients, message } = req.body;
        logger.info(`API: Bulk send to ${recipients.length} recipients`);
        
        const results = await this.baileysSender.sendViaBaileys(sender, message, recipients);
        res.json({ success: true, results });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // List sessions
    this.app.get('/api/sessions', async (req, res) => {
      try {
        const sessions = await this.baileysSender.listSessions();
        res.json({ success: true, sessions });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Disconnect session
    this.app.post('/api/disconnect', async (req, res) => {
      try {
        const { phone } = req.body;
        const success = await this.baileysSender.disconnectSession(phone);
        res.json({ success });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });
  }

  start() {
    this.app.listen(this.port, () => {
      logger.success(`🚀 Baileys API running on http://localhost:${this.port}`);
      logger.info('📚 Available endpoints:');
      logger.info('  GET  /api/pairing-code/:phone');
      logger.info('  POST /api/send-message');
      logger.info('  POST /api/bulk-send');
      logger.info('  GET  /api/sessions');
      logger.info('  POST /api/disconnect');
    });
  }
}
