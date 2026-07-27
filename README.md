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
