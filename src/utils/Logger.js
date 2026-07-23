import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';

export class Logger {
  static instance = null;

  constructor() {
    this.logFile = 'logs/app.log';
    this.initLogDir();
  }

  static getInstance() {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  async initLogDir() {
    try {
      await fs.mkdir('logs', { recursive: true });
    } catch (error) {
      // Directory already exists
    }
  }

  info(message) {
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] ${chalk.blue('ℹ')} ${message}`;
    console.log(formatted);
    this.writeLog(formatted);
  }

  success(message) {
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] ${chalk.green('✓')} ${message}`;
    console.log(formatted);
    this.writeLog(formatted);
  }

  warn(message) {
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] ${chalk.yellow('⚠')} ${message}`;
    console.log(formatted);
    this.writeLog(formatted);
  }

  error(message) {
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] ${chalk.red('✗')} ${message}`;
    console.log(formatted);
    this.writeLog(formatted);
  }

  writeLog(message) {
    // Async write to file
    fs.appendFile(this.logFile, `${message}\n`).catch(() => {});
  }
}
