import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

export function parseArgs() {
  return yargs(hideBin(process.argv))
    .scriptName('jean')
    .usage('$0 [command] [options]')
    .option('provider', {
      type: 'string',
      description: 'AI provider to use (claude, gemini, custom)',
      default: 'claude'
    })
    .option('model', {
      type: 'string',
      description: 'Model name'
    })
    .help()
    .alias('h', 'help')
    .parse();
}
