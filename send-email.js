const { createSummary, defaultUrl, getAnalysisOptions } = require('./index');
const { sendSummaryEmail } = require('./mailer');

function usage() {
  return [
    'Usage: node --env-file=.env.local send-email.js --to <email> --slot-length <days> --start-date <YYYY-MM-DD> --end-date <YYYY-MM-DD>',
    '',
    'The return flight is exactly --slot-length days after the outbound flight.',
  ].join('\n');
}

function parseArguments(args) {
  const values = {};

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help') {
      return { help: true };
    }

    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${argument} requires a value.`);
    }

    if (!['--to', '--slot-length', '--start-date', '--end-date'].includes(argument)) {
      throw new Error(`Unknown option: ${argument}`);
    }

    values[argument] = value;
    index += 1;
  }

  if (!values['--to']) {
    throw new Error('--to is required.');
  }

  return {
    to: values['--to'],
    ...getAnalysisOptions(
      Number(values['--slot-length']),
      values['--start-date'],
      values['--end-date'],
    ),
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const summary = await createSummary({ url: defaultUrl, ...options });
  const message = await sendSummaryEmail(options.to, summary);
  process.stdout.write(`Email sent to ${options.to} (${message.messageId}).\n`);
}

main().catch((error) => {
  console.error(`Unable to send reward-seat summary: ${error.message}`);
  process.exitCode = 1;
});
