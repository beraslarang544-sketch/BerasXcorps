import { AuthService } from '../services/AuthService.js';
import { ScraperService } from '../services/ScraperService.js';
import { UIManager } from '../utils/UIManager.js';
import { Logger } from '../utils/Logger.js';

const logger = Logger.getInstance();

export class AppController {
  constructor() {
    this.authService = new AuthService();
    this.scraperService = new ScraperService();
    this.uiManager = new UIManager();
  }

  async run() {
    try {
      this.uiManager.displayHeader('WELCOME TO BERAS XCORPS v2.0');
      this.uiManager.displayFeatures();

      // Authentication
      const isAuthenticated = await this.authService.authenticate();
      if (!isAuthenticated) {
        this.uiManager.displayError('Access Denied', 'Device not authenticated');
        return;
      }

      this.uiManager.displaySuccess('Access Granted', 'Starting main application...');
      
      // Main script loop
      await this.startMainScript();
    } catch (error) {
      logger.error(`Application error: ${error.message}`);
      this.uiManager.displayError('ERROR', error.message);
    }
  }

  async startMainScript() {
    // Main scraping/automation logic
    const phoneNumber = await this.uiManager.getUserInput('Enter phone number (+62): ');
    
    if (!this.validatePhoneNumber(phoneNumber)) {
      this.uiManager.displayError('Invalid Input', 'Phone must start with 8 and be at least 9 digits');
      return;
    }

    logger.info(`Processing phone number: +62${phoneNumber}`);
    await this.scraperService.processTarget(phoneNumber);
  }

  validatePhoneNumber(phone) {
    return /^8\d{8,}$/.test(phone);
  }
}
