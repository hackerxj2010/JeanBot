import { parseArgs } from './config/config.js';
import chalk from 'chalk';

async function main() {
  console.log(chalk.blue.bold('Jean Code - Multi-Provider AI CLI'));

  const argv = await parseArgs();

  console.log(chalk.green(`Using provider: ${argv.provider}`));
  if (argv.model) {
    console.log(chalk.green(`Using model: ${argv.model}`));
  }

  // Implementation logic would go here
}

main().catch(err => {
  console.error(chalk.red('Error:'), err);
  process.exit(1);
});
