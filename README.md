# Virgin Atlantic Reward Flight Scraper

This Playwright utility loads a Virgin Atlantic reward-flight calendar page and writes the calendar response as JSON to standard output. It captures the API response emitted by the rendered browser page, rather than making a direct HTTP request.

## Setup

```sh
npm install
npx playwright install chromium
```

## Usage

Run with the supplied Manchester to Orlando example:

```sh
npm run scrape
```

Pass another monthly finder URL as the first argument and redirect the JSON if required:

```sh
node index.js 'https://www.virginatlantic.com/reward-flight-finder/results/month?origin=LHR&destination=JFK&month=10&year=2026' > rewards.json
```

## Finding the best contiguous slot

Provide a stay length and an inclusive date range to compare available outbound and return flights. The return flight is exactly the requested number of days after the outbound flight:

```sh
node index.js \
  --slot-length 7 \
  --start-date 2026-10-01 \
  --end-date 2026-10-31 \
  > rewards.json
```

The scraper fetches every calendar month that overlaps the range. It evaluates all nine outbound/return cabin combinations, such as Economy outbound and Premium return. `bestFlights.lowestConfiguration` contains the cheapest valid round trip, while `bestFlights.configurations` contains the cheapest result for each pairing. Each result includes the outbound and return dates, their individual points prices, seat availability, saver status, and round-trip total.

The output also contains the source URL, scrape time, and Virgin Atlantic's unmodified monthly data. Each `pointsDays` entry includes the date, minimum points price, tax/currency details, and cabin-level seat availability.

Virgin Atlantic only exposes months it can serve from its calendar API. If a requested month is unavailable, the command stops with the API's HTTP status instead of producing a partial result.

## Email summary

Add `--html-output` to write a standalone HTML summary suitable for email. It highlights the lowest-points combined outbound and return value, then lists all cabin combinations beneath it. Flights marked by Virgin Atlantic as Saver awards have a `Saver reward` badge. Its footer links to every Virgin Atlantic calendar month URL used for the lookup. JSON still writes to standard output.

```sh
node index.js \
  --slot-length 7 \
  --start-date 2027-02-25 \
  --end-date 2027-03-15 \
  --html-output reward-seat-summary.html \
  > rewards.json
```

## Web interface

The Vercel web interface serves a start form at `/`. Enter the number of nights, earliest outbound date, and latest return date. The form calls `/api/summary`, then redirects to `/results.html` with the best combined value and all cabin combinations.

Run the same interface locally:

```sh
npm start
```

Open <http://127.0.0.1:3000>. The local server calls the same shared summary function as the Vercel endpoint.

### Sending email locally

Copy `.env.example` to `.env.local` and set the SMTP values for your email provider. Keep this file private; it is ignored by Git.

```sh
cp .env.example .env.local
npm run start:email
```

After opening a result, enter the recipient email address in the **Send email** section. The local server sends the existing HTML summary through the configured SMTP account.

Send directly from the command line instead:

```sh
npm run send:email -- \
  --to you@example.com \
  --slot-length 7 \
  --start-date 2027-02-25 \
  --end-date 2027-03-15
```

## Local price alerts

Run a local watcher to check immediately and then every 10 minutes:

```sh
npm run watch -- \
  --slot-length 7 \
  --start-date 2027-02-25 \
  --end-date 2027-03-15
```

The watcher checks the requested duration plus one night and minus one night. It tracks the cheapest combined trip, the dedicated Economy-outbound/Economy-return total, plus the lowest Economy, Premium, and Upper Class price in each direction for every duration. The first check records a baseline in `.reward-seat-watch-state.json`. When a later check finds a lower combined or cabin-class price, the watcher creates an `alerts/reward-seat-low-*.json` file and shows a macOS notification. Both generated locations are ignored by Git.

Use `--once` to run only one check, for example when testing the watcher.

Deploy the repository to Vercel. The serverless function uses `playwright-core` and `@sparticuz/chromium`; no additional Vercel configuration is required.
