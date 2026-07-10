# Fleet Compliance Dashboard — Live Demo

**Live demo: [fleet-compliance-demo.pages.dev/app](https://fleet-compliance-demo.pages.dev/app/)**

A working, anonymized demo of a production fleet-compliance system built for
an Alberta commercial carrier. The real system runs daily: it ingests GPS
telematics and driver vehicle inspections automatically, evaluates every
driver-day against Alberta hours-of-service rules (NSC Standards 9 and 13),
and serves an auditable dashboard plus tokenized per-driver roadside views —
at $0/month infrastructure cost.

**Every name, location, route, vehicle, and document in this demo is
synthetic.** The compliance logic, UI, and pipeline are the real thing.

## What to look at

- **Drivers tab** — per-driver compliance state, computed live in the browser
  from the dataset: 160 km exemption tests, shift-window checks, pre-trip
  inspection coverage
- **Any driver → a day → trip detail** — interactive map (Leaflet + OSM) with
  the day's route, numbered stops, and the 160 km exemption ring drawn at
  true geographic scale from the day-start anchor
- **NSC Audit Export** (top bar) — a print-ready monthly compliance report
  generated entirely client-side
- **Maintenance tab** — CVIP/service scheduling computed from a rules file
  plus a defect pipeline fed by the inspection documents

## How the demo stays anonymous

The dataset is regenerated from production data by
[`scripts/anonymize.py`](scripts/anonymize.py) (run via GitHub Actions with a
read-only credential):

- Drivers, vehicles, and the carrier get deterministic fake identities
- GPS routes are **synthesized, not jittered**: each unit-day is rebuilt as a
  coherent chain (legs match the real recorded distances, trips start where
  the previous ended, returns snap to the yard) around a fictional home
  terminal — so nothing about real locations or directions is recoverable
- A leak scanner walks the output and **fails the pipeline** if any real
  name (in any form), brand marker, or coordinate near the real terminal
  survives — a bad refresh can never replace good data

## Stack

React 18 (no build step — Babel in-browser), Leaflet + OpenStreetMap,
Cloudflare Pages hosting, GitHub Actions for the refresh workflow.
The production system adds: Python parsers for the telematics and
inspection sources, SQLite aggregation, Cloudflare Workers + R2 + KV +
Access for authenticated data serving, and a Workers cron trigger.

Truck photos: [Pexels](https://www.pexels.com) free license.
