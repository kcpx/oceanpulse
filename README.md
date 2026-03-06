# 🌊 OceanPulse — Maritime Intelligence Platform

> A Bloomberg Terminal-style real-time maritime intelligence dashboard built with React, D3, and Recharts.

---

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start dev server
npm run dev

# 3. Open in browser
http://localhost:5173
```

**Requires:** Node.js 18+ and npm

---

## ✅ What's Built (Current State)

### Core UI
- [x] Dark navy institutional design (`#060d18` base, IBM Plex Mono typography)
- [x] Live scrolling ticker bar (FBX, BDI, Brent, vessel counts, risk alerts)
- [x] Header with live vessel count + UTC clock
- [x] Vessel type filter bar (All / Container / Tanker / Bulk Carrier / LNG / RORO)
- [x] Risk Mode toggle with animated indicator

### Interactive World Map
- [x] D3 Natural Earth projection with real world geography (loaded from CDN)
- [x] 200 simulated vessels animating along 12 real global shipping routes
- [x] Color-coded vessel dots by type (blue/red/yellow/purple/green)
- [x] Dashed route lines across all major trade lanes
- [x] Port glow halos sized by congestion level
- [x] Clickable vessel popups (name, type, flag, route, cargo, speed)
- [x] Clickable port popups (congestion score, ships waiting, freight exposure routes)
- [x] Vessel type legend (bottom left)
- [x] Risk Mode: chokepoint overlays for Suez, Panama, Hormuz, Malacca

### Freight Panel (Bottom Left)
- [x] Live-fluctuating Baltic Dry Index, FBX Global, Brent Crude tiles
- [x] 30-day mini trend chart (BDI / FBX / Crude)
- [x] Expand modal → 90-day full chart with dual Y-axis
- [x] Correlation matrix (Freight vs Oil, BDI vs FBX, etc.)

### Port Congestion Panel (Bottom Right)
- [x] 8 major ports ranked by congestion score
- [x] Color-coded progress bars (green/yellow/red)
- [x] Vessels waiting count per port
- [x] Click port row to highlight on map

---

## 🔲 What's Next (Priority Ordered)

### Priority 1 — Real Data (2–3 hours)
- [ ] **Wire FRED API for live BDI** — endpoint: `https://fred.stlouisfed.org/graph/fredgraph.csv?id=BDIY`
- [ ] **Wire FRED API for Brent Crude** — endpoint: `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILBRENTEU`
- [ ] Replace simulated `freight` state with real fetched values
- [ ] Add `/api/freight.js` Next.js route (if migrating) or direct fetch in Vite

### Priority 2 — Vessel Density Heatmap (3–4 hours)
- [ ] Add toggle: "VESSELS" vs "DENSITY" mode
- [ ] Use D3 contour density to compute heatmap from vessel lat/lng
- [ ] Render as SVG filled contours with neon blue glow
- [ ] Highlight South China Sea, English Channel, Gulf clusters

### Priority 3 — Market Impact Panel (4–5 hours)
- [ ] New bottom panel or right sidebar: "MACRO OVERLAY"
- [ ] LNG futures price (via Alpha Vantage free tier)
- [ ] Iron ore spot price
- [ ] Visual correlation sparklines: freight rate vs commodity
- [ ] "Freight + Commodity Correlation View" toggle

### Priority 4 — Time Replay Slider (1–2 days)
- [ ] Bottom-of-map slider: Jan 2023 → Present
- [ ] Pre-bake historical congestion snapshots (JSON) for key events:
  - Ever Given Suez blockage (March 2021)
  - COVID port backlog (Oct–Dec 2021)
  - Red Sea crisis (Dec 2023)
- [ ] Animate vessel density changes over time

### Priority 5 — Search & Filter (1–2 hours)
- [ ] Search input in filter bar
- [ ] Filter by vessel name (highlights matching dot on map)
- [ ] Filter by destination port
- [ ] Clear filter button

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18 + Vite |
| Map | D3 v7 (geoNaturalEarth1 projection) |
| Charts | Recharts |
| Geography | world-atlas@2 TopoJSON (jsdelivr CDN) |
| TopoJSON client | topojson-client@3 (jsdelivr CDN) |
| Fonts | IBM Plex Mono (Google Fonts) |
| Data | Simulated (FRED API ready) |

---

## 📁 Project Structure

```
oceanpulse/
├── index.html
├── package.json
├── vite.config.js
├── src/
│   ├── main.jsx          # React entry point
│   └── OceanPulse.jsx    # Main component (all-in-one)
└── README.md
```

---

## 🎯 Resume Framing

> **OceanPulse — Global Maritime Intelligence Platform**
> Built interactive world map visualizing real-time vessel movement across 12 global shipping lanes. Integrated live maritime geography via D3 geoNaturalEarth projection with freight rate indices and port congestion scoring. Developed geopolitical risk overlay for strategic shipping chokepoints (Suez, Hormuz, Malacca, Panama). Designed for extensibility with AIS API and FRED data integration.

---

## 🔑 API Keys Needed (for live data upgrades)

| API | Key Required | Cost | Use |
|-----|-------------|------|-----|
| FRED (St. Louis Fed) | Yes (free) | Free | BDI, Brent Crude |
| Alpha Vantage | Yes (free tier) | Free (25 req/day) | Commodities |
| AISHub | Registration | Free (data contribution) | Live vessel positions |
| MarineTraffic | Yes | Paid ($) | Premium vessel data |
