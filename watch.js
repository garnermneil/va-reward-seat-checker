const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createSummary, defaultUrl, getAnalysisOptions } = require('./index');

const execFileAsync = promisify(execFile);
const intervalMilliseconds = 10 * 60 * 1000;
const stateFile = '.reward-seat-watch-state.json';
const alertDirectory = 'alerts';
const cabinNames = ['Economy', 'Premium', 'Upper Class'];

function usage() {
  return [
    'Usage: node watch.js --slot-length <days> --start-date <YYYY-MM-DD> --end-date <YYYY-MM-DD> [--once]',
    '',
    'Checks the requested stay length plus or minus one night every 10 minutes. A macOS alert and JSON alert file are created for new combined or cabin-price lows.',
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

function stayLengths(slotLength) {
  return [...new Set([slotLength - 1, slotLength, slotLength + 1].filter((value) => value > 0))];
}

function isLower(candidate, current) {
  return (
    !current ||
    candidate.points < current.points ||
    (candidate.points === current.points && candidate.date < current.date)
  );
}

function lowestCabinPrice(bestFlights, direction, cabin) {
  return Object.values(bestFlights.configurations)
    .map((configuration) => configuration.best?.[direction])
    .filter((flight) => flight?.cabin === cabin)
    .reduce((lowest, flight) => (isLower(flight, lowest) ? flight : lowest), null);
}

function seatClassPrices(bestFlights) {
  return Object.fromEntries(
    ['outbound', 'return'].flatMap((direction) =>
      cabinNames.map((cabin) => [
        `${direction}-${cabin.toLowerCase().replaceAll(' ', '-')}`,
        lowestCabinPrice(bestFlights, direction, cabin),
      ]),
    ),
  );
}

function currentDurationResult(bestFlights) {
  return {
    lowestConfiguration: bestFlights.lowestConfiguration,
    seatClassPrices: seatClassPrices(bestFlights),
  };
}

function formatResult(timestamp, nights, result) {
  const configuration = result.lowestConfiguration;
  if (!configuration) {
    return `[${timestamp}] ${nights}-night stay: no available return-trip configuration found.`;
  }

  return [
    `[${timestamp}] ${nights}-night stay:`,
    `${configuration.outbound.cabin} outbound on ${configuration.outbound.date} (${configuration.outbound.points} points)`,
    `+ ${configuration.return.cabin} return on ${configuration.return.date} (${configuration.return.points} points)`,
    `= ${configuration.totalPoints} points.`,
  ].join(' ');
}

function evaluateDuration(previous, current, nights) {
  if (!previous?.initialized) {
    return {
      durationState: {
        initialized: true,
        lastResult: current,
        lowestConfiguration: current.lowestConfiguration,
        lowestSeatClassPrices: current.seatClassPrices,
      },
      movements: [],
      baseline: true,
    };
  }

  const movements = [];
  const lowestConfiguration =
    current.lowestConfiguration &&
    (!previous.lowestConfiguration ||
      current.lowestConfiguration.totalPoints < previous.lowestConfiguration.totalPoints)
      ? current.lowestConfiguration
      : previous.lowestConfiguration;

  if (
    current.lowestConfiguration &&
    previous.lowestConfiguration &&
    current.lowestConfiguration.totalPoints < previous.lowestConfiguration.totalPoints
  ) {
    movements.push({
      type: 'combined',
      nights,
      previous: previous.lowestConfiguration,
      current: current.lowestConfiguration,
    });
  }

  const lowestSeatClassPrices = {};
  for (const [seatClass, currentFlight] of Object.entries(current.seatClassPrices)) {
    const previousFlight = previous.lowestSeatClassPrices?.[seatClass];
    lowestSeatClassPrices[seatClass] =
      currentFlight && (!previousFlight || currentFlight.points < previousFlight.points)
        ? currentFlight
        : previousFlight ?? null;

    if (currentFlight && previousFlight && currentFlight.points < previousFlight.points) {
      movements.push({
        type: 'seat-class',
        nights,
        seatClass,
        previous: previousFlight,
        current: currentFlight,
      });
    }
  }

  return {
    durationState: {
      initialized: true,
      lastResult: current,
      lowestConfiguration,
      lowestSeatClassPrices,
    },
    movements,
    baseline: false,
  };
}

function formatMovement(movement) {
  if (movement.type === 'combined') {
    return `${movement.nights}-night combined: ${movement.previous.totalPoints} to ${movement.current.totalPoints} points`;
  }

  return `${movement.nights}-night ${movement.seatClass}: ${movement.previous.points} to ${movement.current.points} points`;
}

async function checkForNewLow(options) {
  const lengths = stayLengths(options.slotLength);
  const summary = await createSummary({
    url: defaultUrl,
    ...options,
    stayLengths: lengths,
  });
  const state = await readState();
  const now = new Date().toISOString();
  const durations = {};
  const movements = [];
  let baselineRecorded = false;

  for (const nights of lengths) {
    const current = currentDurationResult(summary.bestFlightsByStayLength[nights]);
    const evaluation = evaluateDuration(state.durations?.[nights], current, nights);
    durations[nights] = evaluation.durationState;
    movements.push(...evaluation.movements);
    baselineRecorded ||= evaluation.baseline;
    console.log(formatResult(now, nights, current));
  }

  await writeFile(
    stateFile,
    `${JSON.stringify({ lastCheckedAt: now, durations }, null, 2)}\n`,
  );

  if (baselineRecorded) {
    console.log('Baseline recorded for all stay lengths and cabin classes.');
  }
  if (movements.length === 0) {
    return;
  }

  const alert = {
    detectedAt: now,
    movements,
    sourceUrls: summary.sourceUrls,
  };
  await mkdir(alertDirectory, { recursive: true });
  const file = alertFileName(now);
  await writeFile(file, `${JSON.stringify(alert, null, 2)}\n`);

  const message = `New lower reward-seat price: ${formatMovement(movements[0])}${movements.length > 1 ? ` (+${movements.length - 1} more)` : ''}.`;
  try {
    await notifyMac(message);
  } catch (error) {
    console.error(`Alert file created at ${file}, but macOS notification failed: ${error.message}`);
    return;
  }

  console.log(`New low saved to ${file}: ${movements.map(formatMovement).join('; ')}.`);
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
