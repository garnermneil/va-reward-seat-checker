const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createSummary, defaultUrl, getAnalysisOptions } = require('./index');

const execFileAsync = promisify(execFile);
const intervalMilliseconds = 10 * 60 * 1000;
const stateFile = '.reward-seat-watch-state.json';
const alertDirectory = 'alerts';

function usage() {
  return [
    'Usage: node watch.js --slot-length <days> --start-date <YYYY-MM-DD> --end-date <YYYY-MM-DD> [--once]',
    '',
    'Checks immediately and then every 10 minutes. A macOS alert and JSON alert file are created for each new lowest combined points value.',
  ].join('\n');
}

function parseArguments(args) {
  const values = {};
  let once = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help') {
      return { help: true };
    }
    if (argument === '--once') {
      once = true;
      continue;
    }

    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${argument} requires a value.`);
    }
    if (!['--slot-length', '--start-date', '--end-date'].includes(argument)) {
      throw new Error(`Unknown option: ${argument}`);
    }

    values[argument] = value;
    index += 1;
  }

  return {
    once,
    ...getAnalysisOptions(
      Number(values['--slot-length']),
      values['--start-date'],
      values['--end-date'],
    ),
  };
}

async function readState() {
  try {
    return JSON.parse(await readFile(stateFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function notifyMac(message) {
  if (process.platform !== 'darwin') {
    return;
  }

  await execFileAsync('osascript', [
    '-e',
    `display notification ${JSON.stringify(message)} with title "Reward Seat Checker"`,
  ]);
}

function alertFileName(timestamp) {
  return `${alertDirectory}/reward-seat-low-${timestamp.replaceAll(':', '-')}.json`;
}

function formatResult(timestamp, configuration) {
  if (!configuration) {
    return `[${timestamp}] Last run: no available return-trip configuration found.`;
  }

  return [
    `[${timestamp}] Last run:`,
    `${configuration.outbound.cabin} outbound on ${configuration.outbound.date} (${configuration.outbound.points} points)`,
    `+ ${configuration.return.cabin} return on ${configuration.return.date} (${configuration.return.points} points)`,
    `= ${configuration.totalPoints} points.`,
  ].join(' ');
}

async function checkForNewLow(options) {
  const summary = await createSummary({ url: defaultUrl, ...options });
  const current = summary.bestFlights.lowestConfiguration;
  const state = await readState();
  const now = new Date().toISOString();

  if (!current) {
    await writeFile(stateFile, `${JSON.stringify({ ...state, lastCheckedAt: now }, null, 2)}\n`);
    console.log(formatResult(now, null));
    return;
  }

  const previous = state.lowestConfiguration;
  if (!previous) {
    await writeFile(
      stateFile,
      `${JSON.stringify(
        {
          ...state,
          lastCheckedAt: now,
          lastConfiguration: current,
          lowestConfiguration: current,
        },
        null,
        2,
      )}\n`,
    );
    console.log(formatResult(now, current));
    console.log('Baseline recorded.');
    return;
  }

  const isNewLow = current.totalPoints < previous.totalPoints;
  const nextState = {
    ...state,
    lastCheckedAt: now,
    lastConfiguration: current,
    lowestConfiguration: isNewLow ? current : previous,
  };
  await writeFile(stateFile, `${JSON.stringify(nextState, null, 2)}\n`);

  console.log(formatResult(now, current));
  if (!isNewLow) {
    return;
  }

  const alert = {
    detectedAt: now,
    previousLowestConfiguration: previous ?? null,
    newLowestConfiguration: current,
    sourceUrls: summary.sourceUrls,
  };
  await mkdir(alertDirectory, { recursive: true });
  const file = alertFileName(now);
  await writeFile(file, `${JSON.stringify(alert, null, 2)}\n`);

  const journey = `${current.outbound.cabin} outbound / ${current.return.cabin} return`;
  const previousText = previous ? `, down from ${previous.totalPoints}` : '';
  try {
    await notifyMac(`New low: ${current.totalPoints} points for ${journey}${previousText}.`);
  } catch (error) {
    console.error(`Alert file created at ${file}, but macOS notification failed: ${error.message}`);
    return;
  }

  console.log(`New low saved to ${file}.`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  let checking = false;
  const poll = async () => {
    if (checking) {
      console.log('Skipping poll because the previous check is still running.');
      return;
    }

    checking = true;
    try {
      await checkForNewLow(options);
    } finally {
      checking = false;
    }
  };

  await poll();
  if (options.once) {
    return;
  }

  console.log('Watching for lower reward-seat values every 10 minutes. Press Ctrl+C to stop.');
  setInterval(() => {
    poll().catch((error) => console.error(`Reward-seat check failed: ${error.message}`));
  }, intervalMilliseconds);
}

main().catch((error) => {
  console.error(`Unable to watch reward-seat values: ${error.message}`);
  process.exitCode = 1;
});
