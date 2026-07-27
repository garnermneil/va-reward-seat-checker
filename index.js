const { writeFile } = require('node:fs/promises');

const defaultUrl =
  'https://www.virginatlantic.com/reward-flight-finder/results/month?origin=MAN&destination=MCO&month=10&year=2026';
const rewardSeatApiPath = '/travelplus/reward-seat-checker-api/';
const cabinTypes = {
  economy: { key: 'awardEconomy', label: 'Economy' },
  premium: { key: 'awardComfortPlusPremiumEconomy', label: 'Premium' },
  upperClass: { key: 'awardBusiness', label: 'Upper Class' },
};

function usage() {
  return [
    'Usage: node index.js [finder-url] [options]',
    '',
    'Options:',
    '  --slot-length <days>  Number of nights between outbound and return flights.',
    '  --start-date <date>   Inclusive range start date (YYYY-MM-DD).',
    '  --end-date <date>     Inclusive range end date (YYYY-MM-DD).',
    '  --html-output <file>  Write an email-ready best-slot summary.',
  ].join('\n');
}

function parseDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${name} must use YYYY-MM-DD.`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${name} is not a valid calendar date.`);
  }

  return date;
}

function getAnalysisOptions(slotLength, startDate, endDate) {
  if (slotLength === undefined || startDate === undefined || endDate === undefined) {
    throw new Error('--slot-length, --start-date, and --end-date must be used together.');
  }

  if (!Number.isSafeInteger(slotLength) || slotLength < 1) {
    throw new Error('--slot-length must be a positive integer.');
  }

  const parsedStartDate = parseDate(startDate, '--start-date');
  const parsedEndDate = parseDate(endDate, '--end-date');
  if (parsedStartDate > parsedEndDate) {
    throw new Error('--start-date must not be after --end-date.');
  }

  return {
    slotLength,
    startDate,
    endDate,
    range: { startDate: parsedStartDate, endDate: parsedEndDate },
  };
}

function parseArguments(args) {
  const options = { url: defaultUrl };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '--help') {
      return { help: true };
    }

    if (argument.startsWith('--')) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a value.`);
      }

      if (argument === '--slot-length') {
        options.slotLength = Number(value);
      } else if (argument === '--start-date') {
        options.startDate = value;
      } else if (argument === '--end-date') {
        options.endDate = value;
      } else if (argument === '--html-output') {
        options.htmlOutput = value;
      } else {
        throw new Error(`Unknown option: ${argument}`);
      }

      index += 1;
    } else if (options.url === defaultUrl) {
      options.url = argument;
    } else {
      throw new Error(`Unexpected argument: ${argument}`);
    }
  }

  const analysisOptions = [options.slotLength, options.startDate, options.endDate];
  if (analysisOptions.some((option) => option !== undefined)) {
    Object.assign(options, getAnalysisOptions(options.slotLength, options.startDate, options.endDate));
  }

  if (options.htmlOutput && !options.range) {
    throw new Error('--html-output requires --slot-length, --start-date, and --end-date.');
  }

  return options;
}

function validateUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'www.virginatlantic.com') {
      throw new Error('The URL must use https://www.virginatlantic.com.');
    }
  } catch (error) {
    throw new Error(`Invalid reward flight finder URL: ${error.message}`);
  }
}

function monthUrls(url, range) {
  if (!range) {
    return [url];
  }

  const current = new Date(Date.UTC(range.startDate.getUTCFullYear(), range.startDate.getUTCMonth(), 1));
  const finalMonth = new Date(Date.UTC(range.endDate.getUTCFullYear(), range.endDate.getUTCMonth(), 1));
  const urls = [];

  while (current <= finalMonth) {
    const monthUrl = new URL(url);
    monthUrl.searchParams.set('month', String(current.getUTCMonth() + 1).padStart(2, '0'));
    monthUrl.searchParams.set('year', String(current.getUTCFullYear()));
    urls.push(monthUrl.toString());
    current.setUTCMonth(current.getUTCMonth() + 1);
  }

  return urls;
}

function waitForRewardSeatResponse(page) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => finish(new Error('Timed out waiting for the reward-seat calendar response.')),
      60_000,
    );

    function finish(error, response) {
      clearTimeout(timeout);
      page.off('response', onResponse);
      page.off('close', onClose);

      if (error) {
        reject(error);
      } else {
        resolve(response);
      }
    }

    function onResponse(response) {
      if (
        response.url().includes(rewardSeatApiPath) &&
        (response.status() === 200 || response.status() >= 400)
      ) {
        finish(null, response);
      }
    }

    function onClose() {
      finish(new Error('The reward flight finder page closed before returning calendar data.'));
    }

    page.on('response', onResponse);
    page.once('close', onClose);
  });
}

async function scrapeCalendar(page, url) {
  const apiResponse = waitForRewardSeatResponse(page);

  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });

    if (!response || !response.ok()) {
      throw new Error(`The reward flight finder returned HTTP ${response?.status() ?? 'no response'}.`);
    }

    const dataResponse = await apiResponse;
    if (!dataResponse.ok()) {
      throw new Error(
        `The reward-seat calendar API returned HTTP ${dataResponse.status()} for ${url}.`,
      );
    }

    const data = await dataResponse.json();
    if (!Array.isArray(data)) {
      throw new Error('The reward-seat API returned an unexpected JSON shape.');
    }

    return data;
  } finally {
    apiResponse.catch(() => {});
  }
}

async function launchBrowser() {
  if (process.env.VERCEL) {
    const { default: chromium } = await import('@sparticuz/chromium');
    const { chromium: playwrightChromium } = require('playwright-core');

    chromium.setGraphicsMode = false;
    return playwrightChromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
  }

  const { chromium } = require('playwright');
  return chromium.launch({ headless: true });
}

function addDays(date, days) {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function isAvailable(seat) {
  return seat && seat.cabinClassSeatCount > 0 && seat.cabinPointsValue > 0;
}

function isCheaper(candidate, current) {
  return (
    !current ||
    candidate.totalPoints < current.totalPoints ||
    (candidate.totalPoints === current.totalPoints &&
      candidate.outbound.date < current.outbound.date)
  );
}

function findBestFlights(data, slotLength, range) {
  const pointsDays = data
    .flatMap((month) => month.pointsDays ?? [])
    .filter((day) => day.date >= range.startDate && day.date <= range.endDate)
    .sort((left, right) => left.date.localeCompare(right.date));
  const daysByDate = new Map(pointsDays.map((day) => [day.date, day]));
  const configurations = Object.fromEntries(
    Object.entries(cabinTypes).flatMap(([outboundName, outboundCabin]) =>
      Object.entries(cabinTypes).map(([returnName, returnCabin]) => [
        `${outboundName}Outbound${returnName}Return`,
        {
          outboundCabin: outboundCabin.label,
          returnCabin: returnCabin.label,
          best: null,
        },
      ]),
    ),
  );

  for (const outboundDay of pointsDays) {
    const returnDate = addDays(outboundDay.date, slotLength);
    if (returnDate > range.endDate) {
      continue;
    }

    const returnDay = daysByDate.get(returnDate);
    if (!returnDay) {
      continue;
    }

    for (const [outboundName, outboundCabin] of Object.entries(cabinTypes)) {
      const outboundSeat = outboundDay.seats?.[outboundCabin.key];
      if (!isAvailable(outboundSeat)) {
        continue;
      }

      for (const [returnName, returnCabin] of Object.entries(cabinTypes)) {
        const returnSeat = returnDay.seats?.[returnCabin.key];
        if (!isAvailable(returnSeat)) {
          continue;
        }

        const candidate = {
          outbound: {
            cabin: outboundCabin.label,
            date: outboundDay.date,
            points: outboundSeat.cabinPointsValue,
            availableSeats: outboundSeat.cabinClassSeatCountString,
            isSaverAward: outboundSeat.isSaverAward,
          },
          return: {
            cabin: returnCabin.label,
            date: returnDay.date,
            points: returnSeat.cabinPointsValue,
            availableSeats: returnSeat.cabinClassSeatCountString,
            isSaverAward: returnSeat.isSaverAward,
          },
          totalPoints: outboundSeat.cabinPointsValue + returnSeat.cabinPointsValue,
        };
        const configuration = configurations[`${outboundName}Outbound${returnName}Return`];
        if (isCheaper(candidate, configuration.best)) {
          configuration.best = candidate;
        }
      }
    }
  }

  const lowestConfiguration = Object.values(configurations)
    .map((configuration) => configuration.best)
    .filter(Boolean)
    .reduce((lowest, candidate) => (isCheaper(candidate, lowest) ? candidate : lowest), null);

  return { lowestConfiguration, configurations };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return entities[character];
  });
}

function formatDate(date) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function formatPoints(points) {
  return `${new Intl.NumberFormat('en-GB').format(points)} points`;
}

function saverRewardBadge(flight) {
  return flight.isSaverAward
    ? ' <span style="display: inline-block; padding: 2px 6px; background: #d9f2e6; color: #17633a; font-size: 11px; font-weight: bold;">Saver reward</span>'
    : '';
}

function renderEmailHtml(result) {
  const { origin, destination } = Object.fromEntries(new URL(result.sourceUrl).searchParams);
  const { bestFlights } = result;
  const best = bestFlights.lowestConfiguration;
  const sourceLinks = result.sourceUrls
    .map((url) => {
      const { month, year } = Object.fromEntries(new URL(url).searchParams);
      return `<a href="${escapeHtml(url)}" style="color: #4b277e;">${escapeHtml(`${year}-${month}`)}</a>`;
    })
    .join(' &middot; ');
  const summary = best
    ? `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse: collapse; font-size: 14px;">
        <tr>
          <td style="border: 1px solid #d9d9d9; padding: 12px; width: 50%; vertical-align: top;">
            <strong>Outbound</strong><br>
            ${escapeHtml(best.outbound.cabin)} &middot; ${escapeHtml(formatDate(best.outbound.date))}<br>
            <span style="font-size: 20px; line-height: 1.8;">${escapeHtml(formatPoints(best.outbound.points))}</span>${saverRewardBadge(best.outbound)}
          </td>
          <td style="border: 1px solid #d9d9d9; padding: 12px; width: 50%; vertical-align: top;">
            <strong>Return</strong><br>
            ${escapeHtml(best.return.cabin)} &middot; ${escapeHtml(formatDate(best.return.date))}<br>
            <span style="font-size: 20px; line-height: 1.8;">${escapeHtml(formatPoints(best.return.points))}</span>${saverRewardBadge(best.return)}
          </td>
        </tr>
        <tr>
          <td colspan="2" style="border: 1px solid #d9d9d9; padding: 16px; background: #5b056a; color: #ffffff; text-align: center;">
            <strong style="font-size: 16px;">Best combined value</strong><br>
            <span style="font-size: 28px; line-height: 1.5;">${escapeHtml(formatPoints(best.totalPoints))}</span>
          </td>
        </tr>
      </table>`
    : `<p style="margin: 0; line-height: 1.5;">No valid ${bestFlights.stayLengthDays}-night trip is available in this range.</p>`;
  const detailRows = Object.values(bestFlights.configurations)
    .map((configuration) => {
      if (!configuration.best) {
        return `
          <tr>
            <td style="border: 1px solid #d9d9d9; padding: 10px;">${escapeHtml(configuration.outboundCabin)}</td>
            <td style="border: 1px solid #d9d9d9; padding: 10px;">${escapeHtml(configuration.returnCabin)}</td>
            <td colspan="4" style="border: 1px solid #d9d9d9; padding: 10px;">Not available</td>
          </tr>`;
      }

      const { best: configurationBest } = configuration;
      return `
        <tr>
          <td style="border: 1px solid #d9d9d9; padding: 10px;">${escapeHtml(configurationBest.outbound.cabin)}</td>
          <td style="border: 1px solid #d9d9d9; padding: 10px;">${escapeHtml(configurationBest.return.cabin)}</td>
          <td style="border: 1px solid #d9d9d9; padding: 10px;">${escapeHtml(formatDate(configurationBest.outbound.date))}</td>
          <td style="border: 1px solid #d9d9d9; padding: 10px;">${escapeHtml(formatDate(configurationBest.return.date))}</td>
          <td style="border: 1px solid #d9d9d9; padding: 10px;">${escapeHtml(formatPoints(configurationBest.outbound.points))}${saverRewardBadge(configurationBest.outbound)}<br>+ ${escapeHtml(formatPoints(configurationBest.return.points))}${saverRewardBadge(configurationBest.return)}</td>
          <td style="border: 1px solid #d9d9d9; padding: 10px;"><strong>${escapeHtml(formatPoints(configurationBest.totalPoints))}</strong></td>
        </tr>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
  <body style="margin: 0; padding: 24px; background: #f5f5f5; color: #1f1f1f; font-family: Arial, sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td align="center">
          <table role="presentation" width="720" cellspacing="0" cellpadding="0" border="0" style="max-width: 720px; width: 100%; background: #ffffff; border-collapse: collapse;">
            <tr>
              <td style="padding: 28px 24px 12px;">
                <h1 style="margin: 0; font-size: 24px;">Virgin Atlantic reward-seat prices</h1>
                <p style="margin: 12px 0 0; line-height: 1.5;">${escapeHtml(origin)} to ${escapeHtml(destination)} &middot; ${bestFlights.stayLengthDays}-night stay &middot; ${escapeHtml(formatDate(bestFlights.range.startDate))} to ${escapeHtml(formatDate(bestFlights.range.endDate))}</p>
              </td>
            </tr>
            <tr>
              <td style="padding: 12px 24px 24px;">
                ${summary}
                <h2 style="margin: 28px 0 12px; font-size: 18px;">All cabin combinations</h2>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse: collapse; font-size: 12px;">
                  <thead>
                    <tr style="background: #e9e9e9; text-align: left;">
                      <th style="border: 1px solid #d9d9d9; padding: 10px;">Outbound</th>
                      <th style="border: 1px solid #d9d9d9; padding: 10px;">Return</th>
                      <th style="border: 1px solid #d9d9d9; padding: 10px;">Outbound date</th>
                      <th style="border: 1px solid #d9d9d9; padding: 10px;">Return date</th>
                      <th style="border: 1px solid #d9d9d9; padding: 10px;">Flight points</th>
                      <th style="border: 1px solid #d9d9d9; padding: 10px;">Total</th>
                    </tr>
                  </thead>
                  <tbody>${detailRows}
                  </tbody>
                </table>
                <p style="margin: 20px 0 0; color: #5f5f5f; font-size: 12px; line-height: 1.5;">Prices are one-way award points per traveller. Generated ${escapeHtml(new Date(result.scrapedAt).toUTCString())}. Sources: ${sourceLinks}.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
}

async function scrape(url, range) {
  const browser = await launchBrowser();

  try {
    const data = [];
    const sourceUrls = monthUrls(url, range);
    const page = await browser.newPage();

    try {
      for (const monthUrl of sourceUrls) {
        data.push(...(await scrapeCalendar(page, monthUrl)));
      }
    } finally {
      await page.close();
    }

    return { data, sourceUrls };
  } finally {
    await browser.close();
  }
}

async function createSummary(options) {
  validateUrl(options.url);
  const { data, sourceUrls } = await scrape(options.url, options.range);
  const result = {
    sourceUrl: options.url,
    sourceUrls,
    scrapedAt: new Date().toISOString(),
    data,
  };

  if (options.range) {
    result.bestFlights = {
      stayLengthDays: options.slotLength,
      range: {
        startDate: options.startDate,
        endDate: options.endDate,
      },
      ...findBestFlights(data, options.slotLength, {
        startDate: options.startDate,
        endDate: options.endDate,
      }),
    };
  }

  return result;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const result = await createSummary(options);
  if (options.htmlOutput) {
    await writeFile(options.htmlOutput, renderEmailHtml(result), 'utf8');
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Unable to scrape reward flight results: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { createSummary, defaultUrl, getAnalysisOptions };
