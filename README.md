# TrackFleet

TrackFleet is a logistics tracking application for small transport agencies, with SENDATRACK GPS integration, persistent trips, customer tracking, ETA learning and automation.

## Fleet GPS history

Production automation stores every SENDATRACK fleet position on each scheduler tick, even when a vehicle has no parcel currently assigned. Observations are tenant-scoped and deduplicated by provider vehicle timestamp, so TrackFleet can build its own route history over time without depending on a SENDATRACK history API.

Stored fleet observations include the logical SENDATRACK device identity, vehicle name, coordinates, speed, heading, address and provider timestamp. This history is intended to support later route reconstruction, stop detection, route learning and ETA improvements.

## Stack

- React 19 / vinext / TypeScript
- Neon Postgres on Vercel
- Cloudflare-compatible runtime adapters
- SENDATRACK live GPS integration
- GitHub Actions automation every 5 minutes

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext/Cloudflare build output
- `npm run build:vercel`: verify the Vercel build output
- `npm run test:fleet-position-history`: verify full-fleet history persistence contracts
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Operational notes

- SENDATRACK is used as the live GPS source; TrackFleet persists its own operational history.
- Parcels may remain unassigned until a compatible planned trip or truck is confirmed.
- Persistent trips and route learning are company-scoped.
- Public tracking never receives SENDATRACK credentials.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
