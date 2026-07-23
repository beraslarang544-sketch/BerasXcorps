import chalk from 'chalk';
import readline from 'readline';

export class UIManager {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  displayHeader(title) {
    console.clear();
    console.log(chalk.cyan.bold('\n╔════════════════════════════════════════╗'));
    console.log(chalk.cyan.bold('║  ' + chalk.white.bold(title.padEnd(36)) + '  ║'));
    console.log(chalk.cyan.bold('╚════════════════════════════════════════╝\n'));
  }

  displayFeatures() {
    const features = [
      '🚫 SC BAN SPAM',
      '🔒 SC BAN OTW PERMANENT',
      '⚡ SC BAN PERMANENT',
      '👑 STUDENT BANNED WA',
      '🔄 FREE UNLIMITED UPDATES',
      '🔥 UNLIMITED USAGE',
      '🍁 CAN OPEN OWN SERVICE',
      '🔐 AI SUPPORT BYPASS',
      '📤 INJECTED WHATSAPP'
    ];

    console.log(chalk.magenta.bold('═══════════════════════════════════════'));
    console.log(chalk.magenta.bold('              PREMIUM FEATURES'));
    console.log(chalk.magenta.bold('═══════════════════════════════════════'));
    features.forEach(feature => {
      console.log(chalk.green(`  ${feature}`));
    });
    console.log();
  }

  displaySuccess(title, message) {
    console.log(chalk.green.bold(`\n✓ ${title}`));
    console.log(chalk.green(`  ${message}\n`));
  }

  displayError(title, message) {
    console.log(chalk.red.bold(`\n✗ ${title}`));
    console.log(chalk.red(`  ${message}\n`));
  }

  displayWarning(title, message) {
    console.log(chalk.yellow.bold(`\n⚠ ${title}`));
    console.log(chalk.yellow(`  ${message}\n`));
  }

  async getUserInput(prompt) {
    return new Promise((resolve) => {
      this.rl.question(chalk.cyan(prompt), (answer) => {
        resolve(answer.trim());
      });
    });
  }

  close() {
    this.rl.close();
  }
}
