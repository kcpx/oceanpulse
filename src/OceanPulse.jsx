import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import * as d3 from "d3";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const VESSEL_TYPES = ["Container", "Tanker", "Bulk Carrier", "LNG", "RORO"];
const VESSEL_FLAGS = ["Panama", "Liberia", "Marshall Islands", "Bahamas", "Singapore"];
const VESSEL_COLORS = { Container: "#38bdf8", Tanker: "#f87171", "Bulk Carrier": "#fbbf24", LNG: "#a78bfa", RORO: "#34d399" };
const ROUTES = [
  { from: [121.5, 31.2], to: [-118.2, 33.7], name: "Shanghai → LA" },
  { from: [103.8, 1.3], to: [55.3, 25.3], name: "Singapore → Dubai" },
  { from: [4.9, 51.9], to: [-74.0, 40.7], name: "Rotterdam → NY" },
  { from: [121.5, 31.2], to: [4.9, 51.9], name: "Shanghai → Rotterdam" },
  { from: [-74.0, 40.7], to: [4.9, 51.9], name: "NY → Rotterdam" },
  { from: [103.8, 1.3], to: [121.5, 31.2], name: "Singapore → Shanghai" },
  { from: [55.3, 25.3], to: [4.9, 51.9], name: "Dubai → Rotterdam" },
  { from: [-118.2, 33.7], to: [121.5, 31.2], name: "LA → Shanghai" },
  { from: [139.7, 35.7], to: [121.5, 31.2], name: "Tokyo → Shanghai" },
  { from: [-43.2, -22.9], to: [4.9, 51.9], name: "Rio → Rotterdam" },
  { from: [28.0, -26.2], to: [4.9, 51.9], name: "Johannesburg → Rotterdam" },
  { from: [103.8, 1.3], to: [139.7, 35.7], name: "Singapore → Tokyo" },
];
const PORTS = [
  { name: "Shanghai", coords: [121.5, 31.2], congestion: 78, waiting: 142, routes: ["US West Coast", "Singapore", "Rotterdam"] },
  { name: "Los Angeles", coords: [-118.2, 33.7], congestion: 61, waiting: 87, routes: ["Shanghai", "Tokyo", "Singapore"] },
  { name: "Singapore", coords: [103.8, 1.3], congestion: 43, waiting: 56, routes: ["Rotterdam", "Dubai", "Mumbai"] },
  { name: "Rotterdam", coords: [4.9, 51.9], congestion: 51, waiting: 71, routes: ["New York", "Shanghai", "Dubai"] },
  { name: "Dubai", coords: [55.3, 25.3], congestion: 38, waiting: 44, routes: ["Singapore", "Rotterdam", "Mumbai"] },
  { name: "New York", coords: [-74.0, 40.7], congestion: 45, waiting: 62, routes: ["Rotterdam", "Le Havre", "Antwerp"] },
  { name: "Tokyo", coords: [139.7, 35.7], congestion: 32, waiting: 38, routes: ["LA", "Shanghai", "Pusan"] },
  { name: "Hamburg", coords: [10.0, 53.5], congestion: 29, waiting: 31, routes: ["Rotterdam", "Antwerp", "NY"] },
];
const CHOKEPOINTS = [
  { name: "Suez Canal", coords: [32.5, 30.5], risk: "HIGH", vessels: 12 },
  { name: "Panama Canal", coords: [-79.9, 9.1], risk: "MEDIUM", vessels: 8 },
  { name: "Hormuz", coords: [56.5, 26.5], risk: "HIGH", vessels: 18 },
  { name: "Malacca", coords: [103.0, 2.5], risk: "MEDIUM", vessels: 24 },
];
const TICKER_ITEMS = ["FBX +4.2%", "BDI +1.8%", "Brent -0.6%", "200 Vessels Active", "382 Waiting", "Suez: HIGH RISK", "Hormuz: HIGH RISK", "SCFI +2.1%", "LNG Futures +0.9%", "Iron Ore -1.2%"];
const NAMES = ["MSC GÜLSÜN","EVER GIVEN","COSCO FREIGHT","MAERSK ELBA","CMA CGM ANTOINE","OOCL HONG KONG","EVERGREEN ELITE","YANG MING 21","ZIM INTEGRATED","HAPAG BERLIN","NORDIC CROWN","PACIFIC PIONEER","ATLANTIC BRIDGE","INDIAN VOYAGER","ARCTIC SPIRIT","GOLDEN GATE","SUEZ NAVIGATOR","PANAMA TRADER","HORMUZ GUARDIAN","MALACCA EXPRESS"];

// FRED API Integration
const FRED_API_KEY = import.meta.env.VITE_FRED_API_KEY;
const FRED_BDI_URL = `https://api.stlouisfed.org/fred/series/observations?series_id=BDIY&api_key=${FRED_API_KEY}&file_type=json`;
const FRED_CRUDE_URL = `https://api.stlouisfed.org/fred/series/observations?series_id=DCOILBRENTEU&api_key=${FRED_API_KEY}&file_type=json`;

// OpenWeatherMap API Integration
const OPENWEATHER_API_KEY = import.meta.env.VITE_OPENWEATHER_API_KEY;
const OPENWEATHER_BASE_URL = 'https://api.openweathermap.org/data/2.5';

async function fetchBDI() {
  try {
    const response = await fetch(FRED_BDI_URL);
    if (!response.ok) throw new Error(`FRED BDI fetch failed: ${response.status}`);
    const data = await response.json();
    return data.observations
      .filter(obs => obs.value !== '.')
      .map(obs => ({
        date: new Date(obs.date),
        value: parseFloat(obs.value)
      }))
      .filter(obs => !isNaN(obs.value));
  } catch (error) {
    console.error('Error fetching BDI from FRED:', error);
    return null;
  }
}

async function fetchBrentCrude() {
  try {
    const response = await fetch(FRED_CRUDE_URL);
    if (!response.ok) throw new Error(`FRED Brent fetch failed: ${response.status}`);
    const data = await response.json();
    return data.observations
      .filter(obs => obs.value !== '.')
      .map(obs => ({
        date: new Date(obs.date),
        value: parseFloat(obs.value)
      }))
      .filter(obs => !isNaN(obs.value));
  } catch (error) {
    console.error('Error fetching Brent Crude from FRED:', error);
    return null;
  }
}

function findClosestValue(fredData, targetDate) {
  if (!fredData || fredData.length === 0) return null;
  let closest = null;
  let minDiff = Infinity;
  for (const point of fredData) {
    const diff = Math.abs(point.date - targetDate);
    if (diff < minDiff) {
      minDiff = diff;
      closest = point.value;
      if (diff < 86400000) break; // 1 day in ms
    }
  }
  return closest;
}

function buildHistoricalData(fredBDI, fredCrude) {
  const history = [];
  const today = new Date();
  const useFallback = !fredBDI || !fredCrude;

  if (useFallback) {
    console.warn('Using simulated data (FRED unavailable)');
    return makeSimulatedHistory();
  }

  for (let i = 89; i >= 0; i--) {
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() - i);
    const bdiValue = findClosestValue(fredBDI, targetDate);
    const crudeValue = findClosestValue(fredCrude, targetDate);

    // Simulate FBX using BDI correlation
    const fbxBase = bdiValue ? bdiValue * 2 : 3700;
    const fbxValue = Math.max(1500, Math.round(fbxBase + (Math.random() - 0.5) * 200));

    history.push({
      date: targetDate.toLocaleDateString("en", { month: "short", day: "numeric" }),
      BDI: bdiValue || 1800,
      FBX: fbxValue,
      Crude: crudeValue || 80
    });
  }
  return history;
}

// OpenWeatherMap functions
async function fetchWeatherForPort(lat, lon) {
  try {
    const url = `${OPENWEATHER_BASE_URL}/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Weather fetch failed: ${response.status}`);
    const data = await response.json();
    return {
      temp: Math.round(data.main.temp),
      condition: data.weather[0].main,
      description: data.weather[0].description,
      windSpeed: Math.round(data.wind.speed * 1.94384), // Convert m/s to knots
      windDir: data.wind.deg,
      humidity: data.main.humidity,
      pressure: data.main.pressure,
      icon: data.weather[0].icon
    };
  } catch (error) {
    console.error('Error fetching weather:', error);
    return null;
  }
}

// Simulated weather fallback
function makeSimulatedWeather() {
  const conditions = [
    { condition: "Clear", description: "clear sky", icon: "01d" },
    { condition: "Clouds", description: "few clouds", icon: "02d" },
    { condition: "Clouds", description: "scattered clouds", icon: "03d" },
    { condition: "Rain", description: "light rain", icon: "10d" },
    { condition: "Drizzle", description: "light drizzle", icon: "09d" }
  ];

  const weatherMap = {};
  PORTS.forEach((port, i) => {
    const weather = conditions[i % conditions.length];
    const baseTemp = port.coords[1] > 0 ? (30 - Math.abs(port.coords[1]) * 0.4) : (30 - Math.abs(port.coords[1]) * 0.3);
    weatherMap[port.name] = {
      temp: Math.round(baseTemp + (Math.random() - 0.5) * 8),
      condition: weather.condition,
      description: weather.description,
      windSpeed: Math.round(10 + Math.random() * 20),
      windDir: Math.round(Math.random() * 360),
      humidity: Math.round(60 + Math.random() * 30),
      pressure: Math.round(1010 + Math.random() * 20),
      icon: weather.icon
    };
  });
  return weatherMap;
}

async function fetchAllPortWeather() {
  try {
    const weatherPromises = PORTS.map(port =>
      fetchWeatherForPort(port.coords[1], port.coords[0])
    );
    const weatherData = await Promise.all(weatherPromises);

    // Check if any weather data is valid
    const hasValidData = weatherData.some(w => w !== null);
    if (!hasValidData) {
      console.warn('Weather API unavailable, using simulated data');
      return makeSimulatedWeather();
    }

    const weatherMap = {};
    PORTS.forEach((port, i) => {
      weatherMap[port.name] = weatherData[i];
    });
    return weatherMap;
  } catch (error) {
    console.error('Error fetching all port weather:', error);
    return makeSimulatedWeather();
  }
}

function makeVessels() {
  return Array.from({ length: 200 }, (_, i) => {
    const route = ROUTES[i % ROUTES.length];
    const t = Math.random();
    const lat = route.from[1] + (route.to[1] - route.from[1]) * t + (Math.random() - 0.5) * 6;
    const lng = route.from[0] + (route.to[0] - route.from[0]) * t + (Math.random() - 0.5) * 4;
    const type = VESSEL_TYPES[i % VESSEL_TYPES.length];
    return {
      id: i,
      name: NAMES[i % NAMES.length] + (i >= NAMES.length ? ` ${i}` : ""),
      type, lat: Math.max(-72, Math.min(72, lat)), lng: Math.max(-175, Math.min(175, lng)),
      speed: (Math.random() * 12 + 8).toFixed(1), t, route,
      flag: VESSEL_FLAGS[Math.floor(Math.random() * VESSEL_FLAGS.length)],
      cargo: type === "Tanker" ? "Crude Oil" : type === "LNG" ? "Liquefied Gas" : type === "Bulk Carrier" ? "Iron Ore" : "Mixed Containers"
    };
  });
}

function makeSimulatedHistory() {
  let bdi = 1800, fbx = 3700, crude = 80;
  return Array.from({ length: 90 }, (_, i) => {
    bdi += (Math.random() - 0.48) * 55;
    fbx += (Math.random() - 0.48) * 110;
    crude += (Math.random() - 0.5) * 1.5;
    return {
      date: new Date(2025, 0, 1 + i).toLocaleDateString("en", { month: "short", day: "numeric" }),
      BDI: Math.max(800, Math.round(bdi)),
      FBX: Math.max(1500, Math.round(fbx)),
      Crude: Math.max(55, +crude.toFixed(1))
    };
  });
}
const congColor = s => s >= 70 ? "#dc2626" : s >= 50 ? "#ea580c" : "#16a34a";
const riskColor = r => r === "HIGH" ? "#dc2626" : "#ea580c";

// Weather helper function
const getWeatherEmoji = (condition) => {
  if (!condition) return "";
  const c = condition.toLowerCase();
  if (c.includes("clear")) return "☀️";
  if (c.includes("cloud")) return "☁️";
  if (c.includes("rain") || c.includes("drizzle")) return "🌧️";
  if (c.includes("thunder") || c.includes("storm")) return "⛈️";
  if (c.includes("snow")) return "❄️";
  if (c.includes("mist") || c.includes("fog")) return "🌫️";
  return "⛅";
};

export default function OceanPulse() {
  const containerRef = useRef(null);
  const tickRef = useRef(0);
  const [vessels, setVessels] = useState(makeVessels);
  const [worldGeo, setWorldGeo] = useState(null);
  const [dims, setDims] = useState({ w: 900, h: 460 });
  const [filter, setFilter] = useState("All");
  const [riskMode, setRiskMode] = useState(false);
  const [selVessel, setSelVessel] = useState(null);
  const [selPort, setSelPort] = useState(null);
  const [selRoute, setSelRoute] = useState(null);
  const [freightModal, setFreightModal] = useState(false);
  const [tickerPos, setTickerPos] = useState(0);
  const [freight, setFreight] = useState({ bdi: 1842, fbx: 3920, crude: 82.14, bdic: 2.1, fbxc: 4.8, crudec: -1.2 });
  const [fredData, setFredData] = useState({ bdi: null, crude: null });
  const [dataSource, setDataSource] = useState('loading');
  const [lastFredFetch, setLastFredFetch] = useState(null);
  const [history, setHistory] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [portWeather, setPortWeather] = useState({});
  const [showRoutes, setShowRoutes] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js";
    s.onload = () => {
      fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json")
        .then(r => r.json())
        .then(topo => setWorldGeo(window.topojson.feature(topo, topo.objects.countries)));
    };
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width;
      setDims({ w, h: Math.max(400, Math.min(650, w * 0.55)) });
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    async function loadFredData() {
      setDataSource('loading');
      const [bdiData, crudeData] = await Promise.all([fetchBDI(), fetchBrentCrude()]);
      setFredData({ bdi: bdiData, crude: crudeData });
      const historicalData = buildHistoricalData(bdiData, crudeData);
      setHistory(historicalData);

      if (bdiData && crudeData) {
        setDataSource('fred');
        setLastFredFetch(Date.now());
        const latestBDI = bdiData[bdiData.length - 1].value;
        const latestCrude = crudeData[crudeData.length - 1].value;
        setFreight(prev => ({
          ...prev,
          bdi: Math.round(latestBDI),
          crude: parseFloat(latestCrude.toFixed(2))
        }));
      } else {
        setDataSource('simulated');
      }
    }
    loadFredData();
  }, []);

  const refreshFredData = useCallback(async () => {
    console.log('Refreshing FRED data (background)...');
    const [bdiData, crudeData] = await Promise.all([fetchBDI(), fetchBrentCrude()]);
    if (bdiData && crudeData) {
      setFredData({ bdi: bdiData, crude: crudeData });
      setHistory(buildHistoricalData(bdiData, crudeData));
      setLastFredFetch(Date.now());
      const latestBDI = bdiData[bdiData.length - 1].value;
      const latestCrude = crudeData[crudeData.length - 1].value;
      setFreight(prev => ({
        ...prev,
        bdi: Math.round(latestBDI),
        crude: parseFloat(latestCrude.toFixed(2))
      }));
    }
  }, []);

  // Load weather data on mount and refresh every 10 minutes
  useEffect(() => {
    async function loadWeather() {
      const weather = await fetchAllPortWeather();
      setPortWeather(weather);
    }
    loadWeather();
    const weatherInterval = setInterval(loadWeather, 10 * 60 * 1000); // 10 minutes
    return () => clearInterval(weatherInterval);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      tickRef.current++;
      setVessels(prev => prev.map(v => {
        const t = v.t + 0.00022 > 1 ? 0 : v.t + 0.00022;
        const lat = v.route.from[1] + (v.route.to[1] - v.route.from[1]) * t + Math.sin(t * Math.PI) * 2.5;
        const lng = v.route.from[0] + (v.route.to[0] - v.route.from[0]) * t;
        return { ...v, t, lat: Math.max(-72, Math.min(72, lat)), lng };
      }));
      if (tickRef.current % 25 === 0) {
        setFreight(p => {
          if (dataSource === 'fred') {
            return {
              bdi: Math.max(900, Math.round(p.bdi + (Math.random() - 0.5) * 5)),
              fbx: Math.max(1600, Math.round(p.fbx + (Math.random() - 0.5) * 35)),
              crude: Math.max(55, parseFloat((p.crude + (Math.random() - 0.5) * 0.1).toFixed(2))),
              bdic: +((Math.random() * 2 - 0.5).toFixed(1)),
              fbxc: +((Math.random() * 6 - 0.5).toFixed(1)),
              crudec: +((Math.random() * 1.5 - 0.5).toFixed(1)),
            };
          } else {
            return {
              bdi: Math.max(900, +(p.bdi + (Math.random() - 0.5) * 18).toFixed(0)),
              fbx: Math.max(1600, +(p.fbx + (Math.random() - 0.5) * 35).toFixed(0)),
              crude: Math.max(55, +(p.crude + (Math.random() - 0.5) * 0.4).toFixed(2)),
              bdic: +((Math.random() * 5 - 1).toFixed(1)),
              fbxc: +((Math.random() * 6 - 0.5).toFixed(1)),
              crudec: +((Math.random() * 4 - 2.5).toFixed(1)),
            };
          }
        });
      }
      if (tickRef.current % 7200 === 0 && lastFredFetch) {
        const hoursSinceLastFetch = (Date.now() - lastFredFetch) / (1000 * 60 * 60);
        if (hoursSinceLastFetch >= 24) {
          refreshFredData();
        }
      }
    }, 120);
    return () => clearInterval(id);
  }, [dataSource, lastFredFetch, refreshFredData]);

  useEffect(() => {
    let pos = 0;
    const id = setInterval(() => {
      pos -= 0.55;
      if (pos < -1400) pos = 0;
      setTickerPos(pos);
    }, 16);
    return () => clearInterval(id);
  }, []);

  const proj = useCallback(() =>
    d3.geoNaturalEarth1()
      .scale((dims.w / 6.4) * zoom)
      .translate([dims.w / 2 + pan.x, dims.h / 2 + 10 + pan.y]),
    [dims, zoom, pan]
  );
  const pt = useCallback((lng, lat) => {
    try { return proj()([lng, lat]) || [0, 0]; } catch { return [0, 0]; }
  }, [proj]);
  const pathFn = useCallback(() => d3.geoPath().projection(proj()), [proj]);

  // Combined filtering: vessel type + search
  const filtered = vessels
    .filter(v => filter === "All" || v.type === filter)
    .filter(v => {
      if (!searchQuery.trim()) return true;
      const query = searchQuery.toLowerCase();
      return v.name.toLowerCase().includes(query) ||
             v.route.name.toLowerCase().includes(query) ||
             v.flag.toLowerCase().includes(query) ||
             v.cargo.toLowerCase().includes(query);
    });

  // Alert Detection System
  const alerts = useMemo(() => {
    const alertList = [];

    // Port congestion alerts
    PORTS.forEach(port => {
      if (port.congestion >= 70) {
        alertList.push({
          id: `port-${port.name}`,
          severity: 'critical',
          type: 'congestion',
          title: `${port.name} congestion critical`,
          details: `${port.waiting} ships waiting`,
          location: port.coords,
          timestamp: Date.now()
        });
      } else if (port.congestion >= 50) {
        alertList.push({
          id: `port-${port.name}`,
          severity: 'warning',
          type: 'congestion',
          title: `${port.name} congestion rising`,
          details: `${port.waiting} ships waiting`,
          location: port.coords,
          timestamp: Date.now()
        });
      }
    });

    // Weather/storm alerts
    PORTS.forEach(port => {
      const weather = portWeather[port.name];
      if (weather && (weather.condition.toLowerCase().includes('storm') || weather.windSpeed > 35)) {
        alertList.push({
          id: `storm-${port.name}`,
          severity: weather.windSpeed > 45 ? 'critical' : 'warning',
          type: 'weather',
          title: `Storm near ${port.name}`,
          details: `Wind: ${weather.windSpeed} kn, ${weather.description}`,
          location: port.coords,
          timestamp: Date.now()
        });
      }
    });

    // Market alerts
    if (Math.abs(freight.bdic) > 2) {
      alertList.push({
        id: 'market-bdi',
        severity: 'watch',
        type: 'market',
        title: `Baltic Dry Index ${freight.bdic > 0 ? 'rising' : 'falling'}`,
        details: `${freight.bdic > 0 ? '+' : ''}${freight.bdic}% change`,
        location: null,
        timestamp: Date.now()
      });
    }

    if (Math.abs(freight.crudec) > 2) {
      alertList.push({
        id: 'market-crude',
        severity: 'watch',
        type: 'market',
        title: `Brent Crude ${freight.crudec > 0 ? 'rising' : 'falling'}`,
        details: `${freight.crudec > 0 ? '+' : ''}${freight.crudec}% change`,
        location: null,
        timestamp: Date.now()
      });
    }

    // Sort by severity: critical → warning → watch
    const severityOrder = { critical: 0, warning: 1, watch: 2 };
    return alertList.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  }, [portWeather, freight]);

  // Handle alert click - zoom to location
  const handleAlertClick = useCallback((alert) => {
    if (alert.location) {
      // Find the port and select it
      const port = PORTS.find(p => p.coords[0] === alert.location[0] && p.coords[1] === alert.location[1]);
      if (port) {
        // Clear selection first to ensure fresh state
        setSelPort(null);

        // Calculate position using base projection (zoom=1, pan=0)
        const baseProj = d3.geoNaturalEarth1()
          .scale(dims.w / 6.5)
          .translate([dims.w / 2, dims.h / 2 + 10]);
        const baseCoords = baseProj([port.coords[0], port.coords[1]]) || [0, 0];

        const targetZoom = 2;
        setZoom(targetZoom);

        // Center on port using base coordinates
        setPan({
          x: dims.w / 2 - baseCoords[0] * targetZoom,
          y: dims.h / 2 - baseCoords[1] * targetZoom
        });

        // Set port selection after a brief delay to ensure state updates
        setTimeout(() => setSelPort(port), 50);
      }
    }
  }, [dims]);

  return (
    <div style={{ background: "#f8f9fa", color: "#212529", fontFamily: "'IBM Plex Mono',monospace", minHeight: "100vh" }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(1.5)} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
        * { box-sizing:border-box; margin:0; padding:0; }
      `}</style>

      {/* TICKER */}
      <div style={{ background: "#ffffff", borderBottom: "1px solid #dee2e6", height: 36, overflow: "hidden", display: "flex", alignItems: "center" }}>
        <div style={{ color: "#0284c7", fontSize: 13, fontWeight: 700, padding: "0 16px", whiteSpace: "nowrap", borderRight: "1px solid #dee2e6", letterSpacing: 1.5 }}>● LIVE</div>
        <div style={{ overflow: "hidden", flex: 1 }}>
          <div style={{ display: "flex", gap: 32, transform: `translateX(${tickerPos}px)`, whiteSpace: "nowrap", fontSize: 13, willChange: "transform" }}>
            {[...TICKER_ITEMS, ...TICKER_ITEMS, ...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
              <span key={i} style={{ color: item.includes("RISK") ? "#dc2626" : item.includes("+") ? "#16a34a" : item.includes("-") ? "#dc2626" : "#64748b" }}>
                {item}<span style={{ color: "#cbd5e1", marginLeft: 20 }}>◆</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* COMMAND BAR */}
      <div style={{ background: "#0f172a", borderBottom: "2px solid #1e293b", padding: "10px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
        {/* Left: System Health */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 8px #22c55e" }} />
            <span style={{ fontSize: 11, color: "#22c55e", letterSpacing: 1, fontWeight: 600 }}>SYSTEMS NOMINAL</span>
          </div>
          <div style={{ width: 1, height: 20, background: "#334155" }} />
          <div style={{ fontSize: 10, color: "#94a3b8", letterSpacing: 0.5 }}>
            API: <span style={{ color: dataSource === 'fred' ? '#22c55e' : '#fbbf24' }}>{dataSource === 'fred' ? 'LIVE' : 'SIM'}</span>
          </div>
          <div style={{ fontSize: 10, color: "#94a3b8", letterSpacing: 0.5 }}>
            GEO: <span style={{ color: worldGeo ? '#22c55e' : '#94a3b8' }}>{worldGeo ? 'LOADED' : 'LOADING'}</span>
          </div>
          <div style={{ fontSize: 10, color: "#94a3b8", letterSpacing: 0.5 }}>
            WEATHER: <span style={{ color: Object.keys(portWeather).length > 0 ? '#22c55e' : '#94a3b8' }}>
              {Object.keys(portWeather).length > 0 ? 'ACTIVE' : 'STANDBY'}
            </span>
          </div>
        </div>

        {/* Center: Key Metrics */}
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, color: "#0ea5e9", fontWeight: 700 }}>{vessels.length}</div>
            <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1 }}>VESSELS</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, color: "#8b5cf6", fontWeight: 700 }}>{PORTS.length}</div>
            <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1 }}>PORTS</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, color: "#f59e0b", fontWeight: 700 }}>{ROUTES.length}</div>
            <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1 }}>ROUTES</div>
          </div>
          <div style={{ width: 1, height: 30, background: "#334155" }} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, color: alerts.length === 0 ? "#22c55e" : alerts.filter(a => a.severity === 'critical').length > 0 ? "#dc2626" : "#f59e0b", fontWeight: 700 }}>
              {alerts.length}
            </div>
            <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1 }}>ALERTS</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, color: "#ef4444", fontWeight: 700 }}>
              {PORTS.filter(p => p.congestion >= 70).length}
            </div>
            <div style={{ fontSize: 9, color: "#64748b", letterSpacing: 1 }}>CRITICAL</div>
          </div>
        </div>

        {/* Right: Quick Stats */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ fontSize: 10, color: "#94a3b8", textAlign: "right" }}>
            <div style={{ color: "#cbd5e1", fontWeight: 600 }}>
              AVG CONGESTION: <span style={{ color: PORTS.reduce((sum, p) => sum + p.congestion, 0) / PORTS.length >= 60 ? '#dc2626' : '#22c55e' }}>
                {Math.round(PORTS.reduce((sum, p) => sum + p.congestion, 0) / PORTS.length)}%
              </span>
            </div>
            <div style={{ marginTop: 2 }}>
              WAITING VESSELS: <span style={{ color: "#f59e0b", fontWeight: 600 }}>
                {PORTS.reduce((sum, p) => sum + p.waiting, 0)}
              </span>
            </div>
          </div>
          <div style={{ width: 1, height: 30, background: "#334155" }} />
          <div style={{ fontSize: 10, color: "#cbd5e1", fontWeight: 600, background: "rgba(6,182,212,0.1)", padding: "6px 12px", borderRadius: 4, border: "1px solid #0891b2" }}>
            ZOOM: {zoom.toFixed(1)}x
          </div>
        </div>
      </div>

      {/* HEADER */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", borderBottom: "1px solid #dee2e6", background: "#ffffff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 32 }}>🌊</span>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 4, color: "#0f172a" }}>OCEANPULSE</div>
            <div style={{ fontSize: 11, color: "#64748b", letterSpacing: 3 }}>MARITIME INTELLIGENCE PLATFORM</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e", animation: "pulse 1.8s infinite" }} />
            <span style={{ fontSize: 13, color: "#475569", letterSpacing: 1 }}>LIVE</span>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 18, color: "#0284c7", fontWeight: 700 }}>{filtered.length.toLocaleString()}</div>
            <div style={{ fontSize: 11, color: "#64748b", letterSpacing: 1 }}>ACTIVE VESSELS</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, color: "#475569" }}>{new Date().toUTCString().slice(5, 22)}</div>
            <div style={{ fontSize: 10, color: "#94a3b8", letterSpacing: 1 }}>UTC</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, color: dataSource === 'fred' ? '#16a34a' : dataSource === 'loading' ? '#0284c7' : '#ea580c', fontWeight: 700 }}>
              {dataSource === 'loading' ? 'LOADING...' : dataSource === 'fred' ? 'FRED DATA' : 'SIMULATED'}
            </div>
            <div style={{ fontSize: 10, color: "#94a3b8", letterSpacing: 1 }}>
              {dataSource === 'fred' ? 'LIVE FEDERAL RESERVE' : dataSource === 'loading' ? 'FETCHING DATA' : 'DEMO MODE'}
            </div>
          </div>
          {(() => {
            const stormsAtPorts = PORTS.filter(p => {
              const w = portWeather[p.name];
              return w && (w.condition.toLowerCase().includes("storm") || w.windSpeed > 35);
            });
            if (stormsAtPorts.length === 0) return null;
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", background: "rgba(220,38,38,0.1)", borderRadius: 6, border: "1px solid #dc2626" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#dc2626", animation: "pulse 1.5s infinite" }} />
                <div style={{ fontSize: 11, color: "#dc2626", fontWeight: 700, letterSpacing: 1 }}>
                  ⛈️ STORM ALERT: {stormsAtPorts.map(p => p.name).join(", ")}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* FILTER BAR */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 24px", borderBottom: "1px solid #dee2e6", background: "#f1f3f5", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "#64748b", letterSpacing: 2 }}>VESSEL TYPE</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {["All", ...VESSEL_TYPES].map(t => (
            <button key={t} onClick={() => setFilter(t)} style={{ padding: "6px 16px", fontSize: 12, borderRadius: 4, border: `1px solid ${filter === t ? (VESSEL_COLORS[t] || "#0284c7") : "#cbd5e1"}`, background: filter === t ? "rgba(2,132,199,0.1)" : "#ffffff", color: filter === t ? (VESSEL_COLORS[t] || "#0284c7") : "#64748b", cursor: "pointer", letterSpacing: 0.5, transition: "all 0.2s" }}>
              {t.toUpperCase()}
            </button>
          ))}
        </div>
        <div style={{ width: 1, height: 24, background: "#cbd5e1", margin: "0 8px" }} />
        <span style={{ fontSize: 12, color: "#64748b", letterSpacing: 2 }}>SEARCH</span>
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, route, flag, cargo..."
            style={{
              padding: "6px 32px 6px 12px",
              fontSize: 12,
              borderRadius: 4,
              border: "1px solid #cbd5e1",
              background: "#ffffff",
              color: "#1e293b",
              width: 220,
              outline: "none",
              transition: "all 0.2s"
            }}
            onFocus={(e) => e.target.style.borderColor = "#0284c7"}
            onBlur={(e) => e.target.style.borderColor = "#cbd5e1"}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              style={{
                position: "absolute",
                right: 6,
                background: "transparent",
                border: "none",
                color: "#94a3b8",
                cursor: "pointer",
                fontSize: 16,
                padding: "0 4px",
                lineHeight: 1
              }}
              title="Clear search"
            >
              ×
            </button>
          )}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={() => setShowRoutes(r => !r)}
            style={{
              padding: "6px 12px",
              fontSize: 11,
              borderRadius: 4,
              border: `1px solid ${showRoutes ? "#0284c7" : "#cbd5e1"}`,
              background: showRoutes ? "rgba(2,132,199,0.1)" : "#ffffff",
              color: showRoutes ? "#0284c7" : "#64748b",
              cursor: "pointer",
              letterSpacing: 0.5,
              transition: "all 0.2s",
              fontWeight: 600
            }}
          >
            {showRoutes ? "HIDE" : "SHOW"} ROUTES
          </button>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={() => setZoom(z => Math.min(4, z * 1.2))}
              style={{
                padding: "4px 10px",
                fontSize: 14,
                borderRadius: 4,
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                color: "#64748b",
                cursor: "pointer",
                fontWeight: 700
              }}
              title="Zoom in"
            >
              +
            </button>
            <button
              onClick={() => setZoom(z => Math.max(0.5, z * 0.8))}
              style={{
                padding: "4px 10px",
                fontSize: 14,
                borderRadius: 4,
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                color: "#64748b",
                cursor: "pointer",
                fontWeight: 700
              }}
              title="Zoom out"
            >
              −
            </button>
            <button
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
                setSearchQuery("");
                setFilter("All");
                setSelPort(null);
              }}
              style={{
                padding: "4px 12px",
                fontSize: 11,
                borderRadius: 4,
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                color: "#64748b",
                cursor: "pointer",
                letterSpacing: 0.5,
                fontWeight: 600
              }}
              title="Reset view, zoom, and filters"
            >
              ↺ RESET
            </button>
          </div>
          <div style={{ width: 1, height: 24, background: "#cbd5e1", margin: "0 8px" }} />
          <span style={{ fontSize: 12, color: "#64748b", letterSpacing: 1 }}>RISK MODE</span>
          <div onClick={() => setRiskMode(r => !r)} style={{ width: 52, height: 26, borderRadius: 13, background: riskMode ? "rgba(220,38,38,0.1)" : "#e2e8f0", cursor: "pointer", position: "relative", border: `1px solid ${riskMode ? "#dc2626" : "#cbd5e1"}`, transition: "all 0.3s" }}>
            <div style={{ position: "absolute", top: 3, left: riskMode ? 27 : 3, width: 18, height: 18, borderRadius: "50%", background: riskMode ? "#dc2626" : "#94a3b8", transition: "all 0.3s", boxShadow: riskMode ? "0 0 8px #dc2626" : "none" }} />
          </div>
          {riskMode && <span style={{ fontSize: 12, color: "#dc2626", letterSpacing: 1, animation: "blink 1.5s infinite" }}>● ACTIVE</span>}
        </div>
      </div>

      {/* MAIN LAYOUT: 3-ZONE COMMAND CENTER */}
      <div style={{ display: "flex", minHeight: "calc(100vh - 200px)" }}>

        {/* LEFT/CENTER ZONE: Map + Bottom Panels */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>

          {/* MAP */}
          <div ref={containerRef} style={{ background: "#e0f2fe", borderBottom: "1px solid #cbd5e1", position: "relative", width: "100%", flex: 1 }}>
        {!worldGeo && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10, height: 460 }}>
            <div style={{ color: "#64748b", fontSize: 11, letterSpacing: 3 }}>LOADING MARITIME DATA...</div>
          </div>
        )}
        <svg
          width={dims.w}
          height={dims.h}
          style={{ display: "block", cursor: isDragging ? "grabbing" : "grab" }}
          onWheel={(e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            setZoom(prev => Math.max(0.5, Math.min(4, prev * delta)));
          }}
          onMouseDown={(e) => {
            setIsDragging(true);
            setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
          }}
          onMouseMove={(e) => {
            if (isDragging) {
              setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
            }
          }}
          onMouseUp={() => setIsDragging(false)}
          onMouseLeave={() => setIsDragging(false)}
        >
          <defs>
            <radialGradient id="oceanBg" cx="50%" cy="40%" r="70%">
              <stop offset="0%" stopColor="#bae6fd" />
              <stop offset="100%" stopColor="#7dd3fc" />
            </radialGradient>
            <radialGradient id="portHalo" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#0284c7" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#0284c7" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="riskHalo" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#dc2626" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#dc2626" stopOpacity="0" />
            </radialGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="2.5" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          <rect width={dims.w} height={dims.h} fill="url(#oceanBg)" />

          {[-60, -30, 0, 30, 60].map(lat => {
            const [, y] = pt(0, lat);
            return <line key={lat} x1={0} y1={y} x2={dims.w} y2={y} stroke="#cbd5e1" strokeWidth={0.5} strokeOpacity={0.5} />;
          })}

          {worldGeo?.features.map((f, i) => {
            try {
              const d = pathFn()(f);
              return d ? <path key={i} d={d} fill="#d1d5db" stroke="#9ca3af" strokeWidth={0.5} /> : null;
            } catch { return null; }
          })}

          {showRoutes && ROUTES.map((r, i) => {
            const [x1, y1] = pt(r.from[0], r.from[1]);
            const [x2, y2] = pt(r.to[0], r.to[1]);
            const isSelected = selRoute?.name === r.name;
            return (
              <g key={i} style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); setSelRoute(isSelected ? null : r); }}>
                {/* Invisible hitbox for easier clicking */}
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={12} />
                {/* Visible route line */}
                <line
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={isSelected ? "#0ea5e9" : "#dc2626"}
                  strokeWidth={isSelected ? 3 : 1.5}
                  strokeOpacity={isSelected ? 1 : 0.8}
                  strokeDasharray={isSelected ? "8,3" : "6,4"}
                  filter={isSelected ? "url(#glow)" : undefined}
                />
              </g>
            );
          })}

          {PORTS.map((p, i) => {
            const [x, y] = pt(p.coords[0], p.coords[1]);
            return <circle key={i} cx={x} cy={y} r={20 + p.congestion * 0.3} fill="url(#portHalo)" opacity={0.4 + p.congestion / 220} />;
          })}

          {riskMode && CHOKEPOINTS.map((cp, i) => {
            const [x, y] = pt(cp.coords[0], cp.coords[1]);
            return (
              <g key={i}>
                <circle cx={x} cy={y} r={52} fill="url(#riskHalo)" />
                <circle cx={x} cy={y} r={16} fill="none" stroke={riskColor(cp.risk)} strokeWidth={2} strokeDasharray="3,3" opacity={0.8} filter="url(#glow)" />
                <circle cx={x} cy={y} r={4} fill={riskColor(cp.risk)} opacity={0.9} filter="url(#glow)" />
                <text x={x} y={y - 22} textAnchor="middle" fill={riskColor(cp.risk)} fontSize={9} fontWeight={700} fontFamily="IBM Plex Mono,monospace" letterSpacing={1}>{cp.name.toUpperCase()}</text>
                <text x={x} y={y - 12} textAnchor="middle" fill={riskColor(cp.risk)} fontSize={8} fontFamily="IBM Plex Mono,monospace" opacity={0.75}>{cp.vessels} VESSELS</text>
              </g>
            );
          })}

          {filtered.map(v => {
            const [x, y] = pt(v.lng, v.lat);
            if (x < -5 || x > dims.w + 5 || y < -5 || y > dims.h + 5) return null;
            const color = VESSEL_COLORS[v.type] || "#38bdf8";
            const sel = selVessel?.id === v.id;
            const query = searchQuery.toLowerCase();
            const isHighlighted = searchQuery.trim() && (
              v.name.toLowerCase().includes(query) ||
              v.route.name.toLowerCase().includes(query) ||
              v.flag.toLowerCase().includes(query) ||
              v.cargo.toLowerCase().includes(query)
            );
            const radius = sel ? 7 : isHighlighted ? 4.5 : 2.5;
            const opacity = sel ? 1 : isHighlighted ? 1 : 0.82;
            return (
              <g key={v.id} onClick={() => setSelVessel(sel ? null : v)} style={{ cursor: "pointer" }}>
                {(sel || isHighlighted) && <circle cx={x} cy={y} r={16} fill={color} opacity={0.12} />}
                <circle cx={x} cy={y} r={radius} fill={color} opacity={opacity} filter={sel || isHighlighted ? "url(#glow)" : undefined} stroke={sel || isHighlighted ? "#fff" : "none"} strokeWidth={1.5} />
              </g>
            );
          })}

          {PORTS.map((p, i) => {
            const [x, y] = pt(p.coords[0], p.coords[1]);
            const sel = selPort?.name === p.name;
            const color = congColor(p.congestion);
            const weather = portWeather[p.name];
            const weatherIcon = weather ? getWeatherEmoji(weather.condition) : "";
            const hasStorm = weather && (weather.condition.toLowerCase().includes("storm") || weather.windSpeed > 35);
            return (
              <g key={i} onClick={() => setSelPort(sel ? null : p)} style={{ cursor: "pointer" }}>
                {sel && <circle cx={x} cy={y} r={16} fill={color} opacity={0.12} />}
                {hasStorm && <circle cx={x} cy={y} r={28} fill="#dc2626" opacity={0.15} className="storm-pulse" />}
                <circle cx={x} cy={y} r={sel ? 9 : 6.5} fill="none" stroke={color} strokeWidth={sel ? 2.5 : 2} filter={sel ? "url(#glow)" : undefined} />
                <circle cx={x} cy={y} r={2.5} fill={color} />
                {(zoom > 1.2 || sel) && (
                  <>
                    <text x={x + 12} y={y + 4} fill="#4a6a8a" fontSize={11} fontFamily="IBM Plex Mono,monospace" letterSpacing={0.3}>
                      {p.name} {weatherIcon}
                    </text>
                    {weather && (
                      <text x={x + 12} y={y + 16} fill="#64748b" fontSize={9} fontFamily="IBM Plex Mono,monospace">
                        {weather.temp}°C
                      </text>
                    )}
                  </>
                )}
              </g>
            );
          })}

          {selVessel && (() => {
            const [vx, vy] = pt(selVessel.lng, selVessel.lat);
            const cardWidth = 300;
            const cardHeight = 260;
            const bx = Math.min(Math.max(vx + 18, 5), dims.w - cardWidth - 5);
            const by = Math.min(Math.max(vy - 80, 5), dims.h - cardHeight - 5);
            const color = VESSEL_COLORS[selVessel.type] || "#0284c7";

            // Calculate risk score (0-100)
            const destPort = PORTS.find(p => selVessel.route.name.includes(p.name));
            const destCongestion = destPort ? destPort.congestion : 50;
            const destWeather = destPort ? portWeather[destPort.name] : null;
            const speedAnomaly = Math.abs(selVessel.speed - 18) / 18; // Normal speed ~18kn
            const weatherRisk = destWeather && destWeather.windSpeed > 30 ? 30 : 0;
            const congestionRisk = destCongestion * 0.3;
            const speedRisk = speedAnomaly * 20;
            const riskScore = Math.min(100, Math.round(weatherRisk + congestionRisk + speedRisk));
            const riskLevel = riskScore >= 70 ? "HIGH" : riskScore >= 40 ? "MEDIUM" : "LOW";
            const riskColor = riskScore >= 70 ? "#dc2626" : riskScore >= 40 ? "#f59e0b" : "#22c55e";

            // Calculate route progress (simulated based on vessel position)
            const routeProgress = Math.round((selVessel.lng + 180) % 100);

            // Calculate ETA (simulated - distance / speed)
            const distRemaining = Math.round(((100 - routeProgress) / 100) * 5000); // km
            const etaHours = Math.round(distRemaining / (selVessel.speed * 1.852)); // kn to km/h
            const etaDays = Math.floor(etaHours / 24);
            const etaRemainder = etaHours % 24;
            const etaString = etaDays > 0 ? `${etaDays}d ${etaRemainder}h` : `${etaRemainder}h`;
            const etaConfidence = routeProgress > 50 ? "HIGH" : "MEDIUM";

            // Related vessels on same route
            const relatedVessels = vessels.filter(v => v.route.name === selVessel.route.name && v.id !== selVessel.id).length;

            return (
              <g>
                <line x1={vx} y1={vy} x2={bx + 2} y2={by + 130} stroke={color} strokeWidth={1.2} opacity={0.5} strokeDasharray="4,5" />
                <rect x={bx} y={by} width={cardWidth} height={cardHeight} rx={6} fill="#ffffff" stroke={color} strokeWidth={2} opacity={0.98} filter="url(#glow)" />

                {/* Header */}
                <rect x={bx} y={by} width={cardWidth} height={28} rx={6} fill={color} opacity={0.15} />
                <text x={bx + 12} y={by + 19} fill={color} fontSize={13} fontWeight={700} fontFamily="IBM Plex Mono,monospace" letterSpacing={0.5}>{selVessel.name}</text>
                <text x={bx + cardWidth - 20} y={by + 19} fill="#64748b" fontSize={14} style={{ cursor: "pointer" }} fontFamily="IBM Plex Mono,monospace" onClick={() => setSelVessel(null)}>✕</text>

                {/* Risk Badge */}
                <rect x={bx + 12} y={by + 38} width={80} height={22} rx={4} fill={riskColor} opacity={0.15} stroke={riskColor} strokeWidth={1} />
                <text x={bx + 18} y={by + 52} fill={riskColor} fontSize={10} fontWeight={700} fontFamily="IBM Plex Mono,monospace" letterSpacing={0.5}>RISK: {riskLevel}</text>
                <text x={bx + 100} y={by + 52} fill={riskColor} fontSize={14} fontWeight={700} fontFamily="IBM Plex Mono,monospace">{riskScore}</text>

                {/* Basic Info */}
                <text x={bx + 12} y={by + 78} fill="#64748b" fontSize={9} fontFamily="IBM Plex Mono,monospace" letterSpacing={1}>TYPE</text>
                <text x={bx + 80} y={by + 78} fill="#1e293b" fontSize={10} fontWeight={600} fontFamily="IBM Plex Mono,monospace">{selVessel.type}</text>

                <text x={bx + 180} y={by + 78} fill="#64748b" fontSize={9} fontFamily="IBM Plex Mono,monospace" letterSpacing={1}>FLAG</text>
                <text x={bx + 220} y={by + 78} fill="#1e293b" fontSize={10} fontWeight={600} fontFamily="IBM Plex Mono,monospace">{selVessel.flag}</text>

                <text x={bx + 12} y={by + 96} fill="#64748b" fontSize={9} fontFamily="IBM Plex Mono,monospace" letterSpacing={1}>CARGO</text>
                <text x={bx + 80} y={by + 96} fill="#1e293b" fontSize={10} fontWeight={600} fontFamily="IBM Plex Mono,monospace">{selVessel.cargo}</text>

                <text x={bx + 180} y={by + 96} fill="#64748b" fontSize={9} fontFamily="IBM Plex Mono,monospace" letterSpacing={1}>SPEED</text>
                <text x={bx + 220} y={by + 96} fill="#1e293b" fontSize={10} fontWeight={600} fontFamily="IBM Plex Mono,monospace">{selVessel.speed} kn</text>

                {/* Divider */}
                <line x1={bx + 12} y1={by + 108} x2={bx + cardWidth - 12} y2={by + 108} stroke="#e5e7eb" strokeWidth={1} />

                {/* Route Analytics */}
                <text x={bx + 12} y={by + 124} fill="#0369a1" fontSize={10} fontWeight={700} fontFamily="IBM Plex Mono,monospace" letterSpacing={1}>ROUTE: {selVessel.route.name}</text>

                {/* Progress Bar */}
                <rect x={bx + 12} y={by + 132} width={cardWidth - 24} height={8} rx={4} fill="#e5e7eb" />
                <rect x={bx + 12} y={by + 132} width={(cardWidth - 24) * (routeProgress / 100)} height={8} rx={4} fill={color} />
                <text x={bx + 12} y={by + 152} fill="#64748b" fontSize={9} fontFamily="IBM Plex Mono,monospace">Progress: {routeProgress}%</text>
                <text x={bx + 120} y={by + 152} fill="#64748b" fontSize={9} fontFamily="IBM Plex Mono,monospace">Distance: {distRemaining} km</text>

                {/* ETA */}
                <rect x={bx + 12} y={by + 162} width={130} height={28} rx={4} fill="#f8fafc" stroke="#cbd5e1" strokeWidth={1} />
                <text x={bx + 18} y={by + 174} fill="#64748b" fontSize={8} fontFamily="IBM Plex Mono,monospace" letterSpacing={1}>ETA</text>
                <text x={bx + 18} y={by + 186} fill="#0f172a" fontSize={12} fontWeight={700} fontFamily="IBM Plex Mono,monospace">{etaString}</text>
                <text x={bx + 90} y={by + 186} fill={etaConfidence === "HIGH" ? "#22c55e" : "#f59e0b"} fontSize={8} fontFamily="IBM Plex Mono,monospace">{etaConfidence}</text>

                {/* Related Vessels */}
                <rect x={bx + 150} y={by + 162} width={cardWidth - 162} height={28} rx={4} fill="#f8fafc" stroke="#cbd5e1" strokeWidth={1} />
                <text x={bx + 156} y={by + 174} fill="#64748b" fontSize={8} fontFamily="IBM Plex Mono,monospace" letterSpacing={1}>ON ROUTE</text>
                <text x={bx + 156} y={by + 186} fill="#0f172a" fontSize={12} fontWeight={700} fontFamily="IBM Plex Mono,monospace">{relatedVessels} vessels</text>

                {/* Status Indicators */}
                <text x={bx + 12} y={by + 210} fill="#64748b" fontSize={8} fontFamily="IBM Plex Mono,monospace" letterSpacing={1}>STATUS</text>
                {destWeather && destWeather.windSpeed > 25 && (
                  <g>
                    <circle cx={bx + 18} cy={by + 220} r={4} fill="#f59e0b" />
                    <text x={bx + 26} y={by + 224} fill="#f59e0b" fontSize={9} fontFamily="IBM Plex Mono,monospace">⛈️ Weather Alert</text>
                  </g>
                )}
                {destCongestion >= 70 && (
                  <g>
                    <circle cx={bx + 160} cy={by + 220} r={4} fill="#dc2626" />
                    <text x={bx + 168} y={by + 224} fill="#dc2626" fontSize={9} fontFamily="IBM Plex Mono,monospace">🚦 Port Congestion</text>
                  </g>
                )}
                {!destWeather || destWeather.windSpeed <= 25 && destCongestion < 70 && (
                  <text x={bx + 18} y={by + 224} fill="#22c55e" fontSize={9} fontFamily="IBM Plex Mono,monospace">✓ On Schedule</text>
                )}

                {/* Footer */}
                <text x={bx + 12} y={by + 248} fill="#94a3b8" fontSize={8} fontFamily="IBM Plex Mono,monospace">Real-time maritime intelligence • Click outside to close</text>
              </g>
            );
          })()}

          {selPort && (() => {
            const [px, py] = pt(selPort.coords[0], selPort.coords[1]);
            const weather = portWeather[selPort.name];
            const hasWeather = weather && weather.temp !== undefined;
            const popupHeight = hasWeather ? 240 : 180;
            const bx = Math.min(Math.max(px + 18, 5), dims.w - 230);
            const by = Math.min(Math.max(py - 80, 5), dims.h - popupHeight - 10);
            const color = congColor(selPort.congestion);
            return (
              <g>
                <line x1={px} y1={py} x2={bx + 2} y2={by + 95} stroke={color} strokeWidth={1.2} opacity={0.5} strokeDasharray="4,5" />
                <rect x={bx} y={by} width={220} height={popupHeight} rx={5} fill="#ffffff" stroke={color} strokeWidth={1.5} opacity={0.98} />
                <rect x={bx} y={by} width={220} height={24} rx={5} fill={color} opacity={0.12} />
                <text x={bx + 10} y={by + 17} fill={color} fontSize={12} fontWeight={700} fontFamily="IBM Plex Mono,monospace">PORT: {selPort.name.toUpperCase()}</text>
                <text x={bx + 195} y={by + 17} fill="#64748b" fontSize={13} style={{ cursor: "pointer" }} onClick={() => setSelPort(null)}>✕</text>
                <text x={bx + 10} y={by + 39} fill={color} fontSize={11} fontFamily="IBM Plex Mono,monospace">CONGESTION: {selPort.congestion}/100</text>
                <rect x={bx + 10} y={by + 45} width={198} height={6} rx={3} fill="#e2e8f0" />
                <rect x={bx + 10} y={by + 45} width={198 * selPort.congestion / 100} height={6} rx={3} fill={color} />
                <text x={bx + 10} y={by + 65} fill="#475569" fontSize={10} fontFamily="IBM Plex Mono,monospace">SHIPS IN 30KM: <tspan fill="#1e293b">{selPort.waiting}</tspan></text>
                <text x={bx + 10} y={by + 84} fill="#64748b" fontSize={10} fontFamily="IBM Plex Mono,monospace">FREIGHT EXPOSURE:</text>
                {selPort.routes.map((r, ri) => (
                  <text key={ri} x={bx + 18} y={by + 103 + ri * 21} fill="#475569" fontSize={10} fontFamily="IBM Plex Mono,monospace">→ {r}</text>
                ))}
                {hasWeather && (
                  <>
                    <line x1={bx + 10} y1={by + 165} x2={bx + 210} y2={by + 165} stroke="#cbd5e1" strokeWidth={1} />
                    <text x={bx + 10} y={by + 180} fill="#64748b" fontSize={10} fontFamily="IBM Plex Mono,monospace">⛅ WEATHER:</text>
                    <text x={bx + 18} y={by + 200} fill="#475569" fontSize={10} fontFamily="IBM Plex Mono,monospace">
                      {weather.temp}°C • {weather.description}
                    </text>
                    <text x={bx + 18} y={by + 220} fill="#475569" fontSize={10} fontFamily="IBM Plex Mono,monospace">
                      Wind: {weather.windSpeed} kn • {weather.humidity}% humidity
                    </text>
                  </>
                )}
              </g>
            );
          })()}

          {selRoute && (() => {
            // Calculate route statistics
            const routeVessels = vessels.filter(v => v.route.name === selRoute.name);
            const vesselCount = routeVessels.length;
            const avgSpeed = vesselCount > 0 ? Math.round(routeVessels.reduce((sum, v) => sum + v.speed, 0) / vesselCount) : 0;

            // Calculate approximate distance (haversine formula simplified)
            const toRad = deg => deg * Math.PI / 180;
            const R = 6371; // Earth radius in km
            const dLat = toRad(selRoute.to[1] - selRoute.from[1]);
            const dLon = toRad(selRoute.to[0] - selRoute.from[0]);
            const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                      Math.cos(toRad(selRoute.from[1])) * Math.cos(toRad(selRoute.to[1])) *
                      Math.sin(dLon/2) * Math.sin(dLon/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            const distance = Math.round(R * c);

            // Estimate transit time
            const transitHours = avgSpeed > 0 ? Math.round(distance / (avgSpeed * 1.852)) : 0; // kn to km/h
            const transitDays = Math.floor(transitHours / 24);

            // Check for congestion at endpoints
            const startPort = PORTS.find(p =>
              Math.abs(p.coords[0] - selRoute.from[0]) < 5 &&
              Math.abs(p.coords[1] - selRoute.from[1]) < 5
            );
            const endPort = PORTS.find(p =>
              Math.abs(p.coords[0] - selRoute.to[0]) < 5 &&
              Math.abs(p.coords[1] - selRoute.to[1]) < 5
            );

            const startCongestion = startPort ? startPort.congestion : null;
            const endCongestion = endPort ? endPort.congestion : null;
            const hasCongestionData = startCongestion !== null || endCongestion !== null;
            const avgCongestion = hasCongestionData ? Math.round(((startCongestion || 0) + (endCongestion || 0)) / (startPort && endPort ? 2 : 1)) : null;
            const congestionColor = avgCongestion >= 70 ? "#dc2626" : avgCongestion >= 50 ? "#f59e0b" : "#22c55e";

            // Position card in center-right
            const cardWidth = 300;
            const cardHeight = hasCongestionData ? 220 : 170;
            const bx = Math.max(dims.w - cardWidth - 20, 20);
            const by = Math.max((dims.h - cardHeight) / 2, 20);

            return (
              <g>
                <rect x={bx} y={by} width={cardWidth} height={cardHeight} rx={6} fill="#ffffff" stroke="#0ea5e9" strokeWidth={2} opacity={0.98} filter="url(#glow)" />

                {/* Header */}
                <rect x={bx} y={by} width={cardWidth} height={32} rx={6} fill="#0ea5e9" opacity={0.15} />
                <text x={bx + 12} y={by + 21} fill="#0ea5e9" fontSize={13} fontWeight={700} fontFamily="IBM Plex Mono,monospace" letterSpacing={0.5}>🚢 ROUTE ANALYTICS</text>
                <text x={bx + cardWidth - 20} y={by + 21} fill="#64748b" fontSize={14} style={{ cursor: "pointer" }} fontFamily="IBM Plex Mono,monospace" onClick={() => setSelRoute(null)}>✕</text>

                {/* Route Name */}
                <text x={bx + 12} y={by + 52} fill="#0f172a" fontSize={15} fontWeight={700} fontFamily="IBM Plex Mono,monospace">{selRoute.name}</text>

                {/* Distance */}
                <rect x={bx + 12} y={by + 66} width={cardWidth - 24} height={32} rx={4} fill="#f8fafc" stroke="#cbd5e1" strokeWidth={1} />
                <text x={bx + 18} y={by + 78} fill="#64748b" fontSize={9} fontFamily="IBM Plex Mono,monospace" letterSpacing={0.5}>DISTANCE</text>
                <text x={bx + 18} y={by + 92} fill="#0f172a" fontSize={18} fontWeight={700} fontFamily="IBM Plex Mono,monospace">{distance.toLocaleString()} km</text>

                {/* Divider */}
                <line x1={bx + 12} y1={by + 108} x2={bx + cardWidth - 12} y2={by + 108} stroke="#e5e7eb" strokeWidth={1} />

                {/* Stats Grid */}
                <text x={bx + 12} y={by + 124} fill="#0369a1" fontSize={10} fontWeight={700} fontFamily="IBM Plex Mono,monospace" letterSpacing={1}>ROUTE TRAFFIC</text>

                {/* Vessels */}
                <rect x={bx + 12} y={by + 132} width={86} height={44} rx={4} fill="#f8fafc" stroke="#cbd5e1" strokeWidth={1} />
                <text x={bx + 18} y={by + 144} fill="#64748b" fontSize={8} fontFamily="IBM Plex Mono,monospace" letterSpacing={0.5}>VESSELS</text>
                <text x={bx + 18} y={by + 160} fill="#0f172a" fontSize={20} fontWeight={700} fontFamily="IBM Plex Mono,monospace">{vesselCount}</text>
                <text x={bx + 18} y={by + 171} fill="#64748b" fontSize={8} fontFamily="IBM Plex Mono,monospace">active</text>

                {/* Avg Speed - only show if we have vessels */}
                {vesselCount > 0 && (
                  <>
                    <rect x={bx + 107} y={by + 132} width={86} height={44} rx={4} fill="#f8fafc" stroke="#cbd5e1" strokeWidth={1} />
                    <text x={bx + 113} y={by + 144} fill="#64748b" fontSize={8} fontFamily="IBM Plex Mono,monospace" letterSpacing={0.5}>AVG SPEED</text>
                    <text x={bx + 113} y={by + 160} fill="#0f172a" fontSize={20} fontWeight={700} fontFamily="IBM Plex Mono,monospace">{avgSpeed}</text>
                    <text x={bx + 113} y={by + 171} fill="#64748b" fontSize={8} fontFamily="IBM Plex Mono,monospace">knots</text>
                  </>
                )}

                {/* Transit Time - only show if we have speed */}
                {avgSpeed > 0 && (
                  <>
                    <rect x={bx + 202} y={by + 132} width={86} height={44} rx={4} fill="#f8fafc" stroke="#cbd5e1" strokeWidth={1} />
                    <text x={bx + 208} y={by + 144} fill="#64748b" fontSize={8} fontFamily="IBM Plex Mono,monospace" letterSpacing={0.5}>EST. TRANSIT</text>
                    <text x={bx + 208} y={by + 160} fill="#0f172a" fontSize={20} fontWeight={700} fontFamily="IBM Plex Mono,monospace">{transitDays}d</text>
                    <text x={bx + 208} y={by + 171} fill="#64748b" fontSize={8} fontFamily="IBM Plex Mono,monospace">{transitHours % 24}h</text>
                  </>
                )}

                {/* Congestion Status - only show if we have port data */}
                {hasCongestionData && (
                  <>
                    <line x1={bx + 12} y1={by + 186} x2={bx + cardWidth - 12} y2={by + 186} stroke="#e5e7eb" strokeWidth={1} />
                    <rect x={bx + 12} y={by + 194} width={cardWidth - 24} height={38} rx={4} fill="rgba(100,116,139,0.05)" stroke="#e5e7eb" strokeWidth={1} />
                    <text x={bx + 18} y={by + 208} fill="#64748b" fontSize={9} fontFamily="IBM Plex Mono,monospace" letterSpacing={0.5}>PORT CONGESTION</text>
                    <rect x={bx + 18} y={by + 214} width={cardWidth - 48} height={6} rx={3} fill="#e5e7eb" />
                    <rect x={bx + 18} y={by + 214} width={(cardWidth - 48) * (avgCongestion / 100)} height={6} rx={3} fill={congestionColor} />
                    <text x={bx + 18} y={by + 228} fill={congestionColor} fontSize={10} fontWeight={700} fontFamily="IBM Plex Mono,monospace">{avgCongestion}%</text>
                    {startPort && <text x={bx + 80} y={by + 228} fill="#64748b" fontSize={9} fontFamily="IBM Plex Mono,monospace">Start: {startCongestion}%</text>}
                    {endPort && <text x={bx + 180} y={by + 228} fill="#64748b" fontSize={9} fontFamily="IBM Plex Mono,monospace">End: {endCongestion}%</text>}
                  </>
                )}
              </g>
            );
          })()}

          <g transform={`translate(14, ${dims.h - 195})`}>
            <rect x={0} y={0} width={210} height={185} rx={6} fill="#ffffff" stroke="#94a3b8" strokeWidth={1.5} opacity={0.98} />
            <text x={12} y={20} fill="#0369a1" fontSize={12} fontWeight={700} fontFamily="IBM Plex Mono,monospace" letterSpacing={1.5}>📍 LEGEND</text>
            <line x1={12} y1={24} x2={198} y2={24} stroke="#cbd5e1" strokeWidth={1} />

            {/* Vessel Types */}
            <text x={12} y={40} fill="#64748b" fontSize={10} fontWeight={600} fontFamily="IBM Plex Mono,monospace">Vessel Types:</text>
            {Object.entries(VESSEL_COLORS).map(([type, color], i) => (
              <g key={i} transform={`translate(12, ${48 + i * 16})`}>
                <circle cx={6} cy={6} r={5} fill={color} stroke="#ffffff" strokeWidth={1.5} />
                <text x={20} y={11} fill="#1e293b" fontSize={11} fontWeight={500} fontFamily="IBM Plex Mono,monospace">{type}</text>
              </g>
            ))}

            {/* Port Congestion */}
            <line x1={12} y1={136} x2={198} y2={136} stroke="#e5e7eb" strokeWidth={1} />
            <text x={12} y={150} fill="#64748b" fontSize={10} fontWeight={600} fontFamily="IBM Plex Mono,monospace">Port Congestion:</text>
            <g transform="translate(12, 158)">
              <circle cx={6} cy={6} r={5} fill="none" stroke="#16a34a" strokeWidth={2} />
              <text x={20} y={11} fill="#1e293b" fontSize={10} fontWeight={500} fontFamily="IBM Plex Mono,monospace">Low (0-49)</text>
            </g>
            <g transform="translate(105, 158)">
              <circle cx={6} cy={6} r={5} fill="none" stroke="#ea580c" strokeWidth={2} />
              <text x={20} y={11} fill="#1e293b" fontSize={10} fontWeight={500} fontFamily="IBM Plex Mono,monospace">Med (50-69)</text>
            </g>
            <g transform="translate(12, 174)">
              <circle cx={6} cy={6} r={5} fill="none" stroke="#dc2626" strokeWidth={2} />
              <text x={20} y={11} fill="#1e293b" fontSize={10} fontWeight={500} fontFamily="IBM Plex Mono,monospace">High (70+)</text>
            </g>
          </g>

          {riskMode && (
            <g transform={`translate(${dims.w - 195}, ${dims.h - 135})`}>
              <rect x={0} y={0} width={180} height={125} rx={6} fill="#ffffff" stroke="#dc2626" strokeWidth={1.5} opacity={0.98} />
              <text x={12} y={20} fill="#dc2626" fontSize={11} fontWeight={700} fontFamily="IBM Plex Mono,monospace" letterSpacing={1.5}>⚠ RISK ZONES</text>
              <line x1={12} y1={24} x2={168} y2={24} stroke="#fecaca" strokeWidth={1} />
              <text x={12} y={38} fill="#64748b" fontSize={9} fontFamily="IBM Plex Mono,monospace">Chokepoints:</text>
              {CHOKEPOINTS.map((cp, i) => (
                <g key={i} transform={`translate(12, ${46 + i * 19})`}>
                  <circle cx={6} cy={6} r={5} fill={riskColor(cp.risk)} stroke="#ffffff" strokeWidth={1.5} />
                  <text x={20} y={11} fill="#1e293b" fontSize={11} fontWeight={500} fontFamily="IBM Plex Mono,monospace">{cp.name}</text>
                  <text x={165} y={11} fill={riskColor(cp.risk)} fontSize={10} fontWeight={700} fontFamily="IBM Plex Mono,monospace" textAnchor="end">{cp.risk}</text>
                </g>
              ))}
            </g>
          )}
        </svg>
      </div>

      {/* BOTTOM PANELS */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>

        {/* Freight */}
        <div style={{ padding: "20px 24px", borderRight: "1px solid #e5e7eb", background: "#ffffff" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <span style={{ fontSize: 13, color: "#0369a1", letterSpacing: 2, fontWeight: 700 }}>📦 FREIGHT INDICES</span>
              <span style={{ fontSize: 12, color: "#475569", marginLeft: 10, fontWeight: 500 }}>LIVE · 30D TREND</span>
            </div>
            <button onClick={() => setFreightModal(true)} style={{ fontSize: 11, color: "#0369a1", background: "#ffffff", border: "1px solid #94a3b8", borderRadius: 3, padding: "6px 14px", cursor: "pointer", letterSpacing: 1, fontWeight: 600 }}>
              EXPAND ↗
            </button>
          </div>
          {dataSource === 'loading' ? (
            <div style={{ textAlign: 'center', padding: '50px 0', color: '#64748b', fontSize: 13 }}>
              <div style={{ marginBottom: 10 }}>Loading market data from FRED...</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Federal Reserve Economic Data</div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
              {[
                { label: "BALTIC DRY", val: freight.bdi.toLocaleString(), change: freight.bdic, color: "#0284c7" },
                { label: "FBX GLOBAL", val: `$${freight.fbx.toLocaleString()}`, change: freight.fbxc, color: "#7c3aed" },
                { label: "BRENT CRUDE", val: `$${freight.crude}`, change: freight.crudec, color: "#ea580c" },
              ].map((item, i) => (
                <div key={i} style={{ background: "#f8fafc", borderRadius: 4, padding: "12px 14px", border: "1px solid #e2e8f0", borderTop: `3px solid ${item.color}` }}>
                  <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6, letterSpacing: 1 }}>{item.label}</div>
                  <div style={{ fontSize: 20, color: "#0f172a", fontWeight: 700 }}>{item.val}</div>
                  <div style={{ fontSize: 12, color: item.change >= 0 ? "#16a34a" : "#dc2626", marginTop: 4 }}>
                    {item.change >= 0 ? "▲" : "▼"} {Math.abs(item.change)}%
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ height: 90 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history.slice(-30)}>
                <XAxis dataKey="date" hide />
                <YAxis hide />
                <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", fontSize: 11, color: "#1e293b", borderRadius: 3, fontFamily: "IBM Plex Mono,monospace" }} />
                <Line type="monotone" dataKey="BDI" stroke="#0284c7" dot={false} strokeWidth={2} name="Baltic Dry" />
                <Line type="monotone" dataKey="FBX" stroke="#7c3aed" dot={false} strokeWidth={2} name="FBX" />
                <Line type="monotone" dataKey="Crude" stroke="#ea580c" dot={false} strokeWidth={2} name="Crude" />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: "flex", gap: 18, marginTop: 8 }}>
            {[["BDI", "#0284c7"], ["FBX", "#7c3aed"], ["Crude", "#ea580c"]].map(([l, c]) => (
              <div key={l} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <div style={{ width: 18, height: 3, background: c, borderRadius: 1.5 }} />
                <span style={{ fontSize: 11, color: "#64748b" }}>{l}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Port Congestion */}
        <div style={{ padding: "20px 24px", background: "#ffffff" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <span style={{ fontSize: 13, color: "#0369a1", letterSpacing: 2, fontWeight: 700 }}>🚦 PORT CONGESTION</span>
            <div style={{ display: "flex", gap: 12, fontSize: 11, alignItems: "center" }}>
              <span style={{ color: "#475569", fontWeight: 500 }}>WAITING: <span style={{ color: "#ea580c", fontWeight: 700 }}>{PORTS.reduce((s, p) => s + p.waiting, 0)}</span></span>
              <span style={{ color: "#16a34a", fontSize: 11, fontWeight: 600 }}>● CLEAR</span>
              <span style={{ color: "#ea580c", fontSize: 11, fontWeight: 600 }}>● MOD</span>
              <span style={{ color: "#dc2626", fontSize: 11, fontWeight: 600 }}>● SEVERE</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[...PORTS].sort((a, b) => b.congestion - a.congestion).map((port, i) => {
              const sel = selPort?.name === port.name;
              return (
                <div key={i} onClick={() => setSelPort(sel ? null : port)} style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", padding: "8px 12px", borderRadius: 4, background: sel ? "#f1f5f9" : "#f8fafc", border: `1px solid ${sel ? congColor(port.congestion) : "#e2e8f0"}`, transition: "all 0.2s" }}>
                  <span style={{ fontSize: 11.5, color: "#475569", width: 100, letterSpacing: 0.5, flexShrink: 0 }}>{port.name.toUpperCase()}</span>
                  <div style={{ flex: 1, height: 5, background: "#e2e8f0", borderRadius: 2.5 }}>
                    <div style={{ width: `${port.congestion}%`, height: "100%", background: congColor(port.congestion), borderRadius: 2.5, transition: "width 0.5s" }} />
                  </div>
                  <span style={{ fontSize: 12, color: congColor(port.congestion), width: 32, textAlign: "right", fontWeight: 700 }}>{port.congestion}</span>
                  <span style={{ fontSize: 11, color: "#475569", width: 40 }}>{port.waiting}⚓</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

        </div> {/* End LEFT/CENTER ZONE */}

        {/* RIGHT PANEL: INTELLIGENCE FEED */}
        <div style={{ width: 320, background: "#ffffff", borderLeft: "1px solid #dee2e6", display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 200px)", overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid #dee2e6", background: "#f8f9fa" }}>
            <div style={{ fontSize: 13, color: "#0369a1", letterSpacing: 2, fontWeight: 700 }}>🔔 LIVE INTELLIGENCE</div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{alerts.length} ACTIVE ALERTS</div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
            {alerts.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "#94a3b8" }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
                <div style={{ fontSize: 12 }}>All systems normal</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {alerts.map(alert => {
                  const severityColors = {
                    critical: { bg: "rgba(220,38,38,0.1)", border: "#dc2626", text: "#dc2626", icon: "🔴" },
                    warning: { bg: "rgba(234,88,12,0.1)", border: "#ea580c", text: "#ea580c", icon: "🟠" },
                    watch: { bg: "rgba(250,204,21,0.1)", border: "#facc15", text: "#ca8a04", icon: "🟡" }
                  };
                  const colors = severityColors[alert.severity];

                  return (
                    <div
                      key={alert.id}
                      onClick={() => handleAlertClick(alert)}
                      style={{
                        background: colors.bg,
                        border: `1px solid ${colors.border}`,
                        borderLeft: `4px solid ${colors.border}`,
                        borderRadius: 6,
                        padding: "12px",
                        cursor: alert.location ? "pointer" : "default",
                        transition: "all 0.2s"
                      }}
                      onMouseEnter={(e) => {
                        if (alert.location) e.currentTarget.style.transform = "translateX(4px)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = "translateX(0)";
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "start", gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 14 }}>{colors.icon}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, color: colors.text, fontWeight: 700, marginBottom: 4, letterSpacing: 0.3 }}>
                            {alert.title.toUpperCase()}
                          </div>
                          <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.5 }}>
                            {alert.details}
                          </div>
                        </div>
                      </div>
                      {alert.location && (
                        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
                          📍 Click to zoom
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </div> {/* End MAIN LAYOUT */}

      {/* Freight Modal */}
      {freightModal && (
        <div onClick={() => setFreightModal(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 8, padding: 32, width: "min(900px, 94vw)", maxHeight: "90vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
              <div>
                <div style={{ fontSize: 15, color: "#0284c7", letterSpacing: 2, fontWeight: 700 }}>FREIGHT TREND — 90 DAYS</div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>BALTIC DRY INDEX · FBX GLOBAL · BRENT CRUDE OIL</div>
              </div>
              <button onClick={() => setFreightModal(false)} style={{ background: "#f8fafc", border: "1px solid #cbd5e1", color: "#475569", cursor: "pointer", fontSize: 16, width: 36, height: 36, borderRadius: 4 }}>✕</button>
            </div>
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history}>
                  <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 10, fontFamily: "IBM Plex Mono,monospace" }} interval={14} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="left" tick={{ fill: "#64748b", fontSize: 10, fontFamily: "IBM Plex Mono,monospace" }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: "#64748b", fontSize: 10, fontFamily: "IBM Plex Mono,monospace" }} axisLine={false} tickLine={false} domain={[50, 110]} />
                  <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", fontSize: 12, color: "#1e293b", borderRadius: 4, fontFamily: "IBM Plex Mono,monospace" }} />
                  <Line yAxisId="left" type="monotone" dataKey="BDI" stroke="#0284c7" dot={false} strokeWidth={2.5} name="Baltic Dry Index" />
                  <Line yAxisId="left" type="monotone" dataKey="FBX" stroke="#7c3aed" dot={false} strokeWidth={2.5} name="FBX Global" />
                  <Line yAxisId="right" type="monotone" dataKey="Crude" stroke="#ea580c" dot={false} strokeWidth={2.5} name="Brent Crude" />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{ marginTop: 24, borderTop: "1px solid #e5e7eb", paddingTop: 20 }}>
              <div style={{ fontSize: 12, color: "#64748b", letterSpacing: 2, marginBottom: 16 }}>CORRELATION MATRIX</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {[
                  { label: "Freight vs Brent Oil", val: "0.62", color: "#ea580c", desc: "Moderate positive" },
                  { label: "Freight vs BDI", val: "0.74", color: "#0284c7", desc: "Strong positive" },
                  { label: "BDI vs FBX", val: "0.81", color: "#7c3aed", desc: "Very strong positive" },
                  { label: "Crude vs FBX (30d lag)", val: "0.55", color: "#10b981", desc: "Moderate positive" },
                ].map((item, i) => (
                  <div key={i} style={{ background: "#f8fafc", borderRadius: 5, padding: "16px 20px", border: "1px solid #e2e8f0", borderLeft: `4px solid ${item.color}` }}>
                    <div style={{ fontSize: 10, color: "#64748b", marginBottom: 5, letterSpacing: 1 }}>CORRELATION</div>
                    <div style={{ fontSize: 13, color: "#475569", marginBottom: 10 }}>{item.label}</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                      <span style={{ fontSize: 34, color: item.color, fontWeight: 700 }}>{item.val}</span>
                      <span style={{ fontSize: 11, color: "#64748b" }}>{item.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
