// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CONFIGURATION
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const API = 'http://localhost:5000/api';

// â”€â”€ STATE â”€â”€
let graphData = null;
let currentPath = [];
let visitedNodes = [];
let selectedAlgo = 'dijkstra';
let selectedMultiRouteIdx = 0;
let multiRoutes = [];
let meshTrafficIntensity = 0.35;
let meshSeed = 424242;
let meshResolutionFactor = 1.0;
let hexCells = [];
let hexCellById = new Map();
let hexLayer;
let activeHexRoute = [];
let meshRenderVersion = 0;

// â”€â”€ MAP â”€â”€
let map;
let nodeMarkers = {};
let edgeLines = [];
let bounds;

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// INIT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
window.addEventListener('DOMContentLoaded', async () => {
  await loadMeshConfigFromServer();
  initMap();
  await loadGraphFromServer();
});

async function loadMeshConfigFromServer() {
  try {
    const res = await fetch(`${API}/mesh/config`);
    const cfg = await res.json();
    if (typeof cfg.intensity === 'number') meshTrafficIntensity = cfg.intensity;
    if (typeof cfg.seed === 'number') meshSeed = cfg.seed;
    const slider = document.getElementById('traffic-slider');
    const val = document.getElementById('traffic-val');
    if (slider && val) {
      const pct = Math.round(meshTrafficIntensity * 100);
      slider.value = String(pct);
      val.textContent = `${pct}%`;
    }
  } catch (_) {
    // Keep local defaults if backend mesh config is unavailable.
  }
}

async function loadGraphFromServer() {
  try {
    const res = await fetch(`${API}/graph`);
    graphData = await res.json();
    updateMapLayer();
    // Wait for markers to be created then fit bounds
    setTimeout(resetView, 100);
  } catch(e) {
    showToast('Could not load graph from server. Using local demo data.', 'error');
    graphData = getDemoGraph();
    updateMapLayer();
  }
}

function initMap() {
  map = L.map('map', { zoomControl: false }).setView([20, 0], 2);
  L.tileLayer('http://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    attribution: '&copy; Google Maps',
    maxZoom: 20
  }).addTo(map);

  hexLayer = L.layerGroup().addTo(map);
  refreshHexMesh();
  map.on('zoomend moveend', () => {
    refreshHexMesh();
  });
}

function fract(v) {
  return v - Math.floor(v);
}

function getHexSizeDegForZoom(zoom) {
  const maxRadius = 14;
  const minRadius = 0.15;
  const decayed = maxRadius * Math.pow(0.77, Math.max(0, zoom - 2));
  return Math.max(minRadius, decayed * meshResolutionFactor);
}

function computeHexDensityLocal(row, col) {
  const noise1 = fract(Math.sin(row * 12.9898 + col * 78.233 + meshSeed * 0.001) * 43758.5453);
  const noise2 = fract(Math.sin((row + 17) * 24.132 + (col - 9) * 53.771 + meshSeed * 0.0007) * 12731.743);
  const blended = (noise1 * 0.65) + (noise2 * 0.35);
  const density = Math.min(1, Math.max(0, blended * (0.45 + meshTrafficIntensity * 1.35)));
  return density;
}

async function fetchMeshDensities(cells) {
  try {
    const res = await fetch(`${API}/mesh/density`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cells })
    });
    const payload = await res.json();
    if (typeof payload.intensity === 'number') meshTrafficIntensity = payload.intensity;
    if (typeof payload.seed === 'number') meshSeed = payload.seed;

    const mapByKey = new Map();
    for (const d of payload.densities || []) {
      mapByKey.set(`${d.row}:${d.col}`, d.density);
    }
    return mapByKey;
  } catch (_) {
    return null;
  }
}

function buildHexVertices(centerLat, centerLon, radiusLat, radiusLon) {
  const vertices = [];
  for (let i = 0; i < 6; i++) {
    const angle = ((60 * i) - 30) * Math.PI / 180;
    vertices.push([
      centerLat + radiusLat * Math.sin(angle),
      centerLon + radiusLon * Math.cos(angle)
    ]);
  }
  return vertices;
}

function getNeighborDeltas(isOddRow) {
  if (isOddRow) {
    return [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]];
  }
  return [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]];
}

async function refreshHexMesh() {
  if (!map || !hexLayer) return;

  const renderToken = ++meshRenderVersion;
  hexLayer.clearLayers();
  hexCells = [];
  hexCellById = new Map();

  const zoom = map.getZoom();
  const b = map.getBounds();
  const centerLat = map.getCenter().lat;

  const radiusLat = getHexSizeDegForZoom(zoom);
  const lonAdjust = Math.max(0.2, Math.cos(centerLat * Math.PI / 180));
  const radiusLon = radiusLat / lonAdjust;

  const stepX = Math.sqrt(3) * radiusLon;
  const stepY = 1.5 * radiusLat;

  const rowStart = Math.floor((b.getSouth() - (3 * radiusLat)) / stepY);
  const rowEnd = Math.ceil((b.getNorth() + (3 * radiusLat)) / stepY);

  const skeletonCells = [];

  for (let row = rowStart; row <= rowEnd; row++) {
    const centerY = row * stepY;
    const offsetX = (row & 1) ? (stepX / 2) : 0;
    const colStart = Math.floor((b.getWest() - (3 * radiusLon) - offsetX) / stepX);
    const colEnd = Math.ceil((b.getEast() + (3 * radiusLon) - offsetX) / stepX);

    for (let col = colStart; col <= colEnd; col++) {
      const centerX = col * stepX + offsetX;
      const id = `${row}:${col}`;
      skeletonCells.push({
        id,
        row,
        col,
        lat: centerY,
        lon: centerX
      });
    }
  }

  const densityMap = await fetchMeshDensities(skeletonCells.map(c => ({ row: c.row, col: c.col })));
  if (renderToken !== meshRenderVersion) return;

  for (const c of skeletonCells) {
      const density = densityMap ? (densityMap.get(c.id) ?? computeHexDensityLocal(c.row, c.col)) : computeHexDensityLocal(c.row, c.col);
      const lineOpacity = 0.08 + (density * 0.24);
      const fillOpacity = 0.025 + (density * 0.10);
      const fillRed = Math.round(120 + density * 120);
      const fillGreen = Math.round(210 - density * 90);
      const fillBlue = Math.round(240 - density * 160);

      const polygon = L.polygon(buildHexVertices(c.lat, c.lon, radiusLat, radiusLon), {
        color: `rgba(255,255,255,${lineOpacity.toFixed(3)})`,
        weight: 1,
        fillColor: `rgb(${fillRed},${fillGreen},${fillBlue})`,
        fillOpacity: fillOpacity
      }).addTo(hexLayer);

      polygon.on('click', () => {
        const trafficPercent = Math.round(density * 100);
        showToast(`Hex density: ${trafficPercent}%`, 'info');
      });

      const cell = {
        id: c.id,
        row: c.row,
        col: c.col,
        lat: c.lat,
        lon: c.lon,
        density,
        neighbors: [],
        layer: polygon
      };

      hexCells.push(cell);
      hexCellById.set(c.id, cell);
  }

  for (const cell of hexCells) {
    const deltas = getNeighborDeltas(Boolean(cell.row & 1));
    for (const [dr, dc] of deltas) {
      const nId = `${cell.row + dr}:${cell.col + dc}`;
      if (hexCellById.has(nId)) cell.neighbors.push(nId);
    }
  }

  highlightHexRoute(activeHexRoute);
}

function setHexResolution(rawValue) {
  const pct = Number(rawValue);
  meshResolutionFactor = Math.max(0.6, Math.min(1.8, pct / 100));
  const val = document.getElementById('mesh-res-val');
  if (val) val.textContent = `${meshResolutionFactor.toFixed(2)}x`;
  refreshHexMesh();
}

function findNearestHexCell(lat, lon) {
  if (!hexCells.length) return null;
  let best = null;
  let minDist = Infinity;
  for (const c of hexCells) {
    const d = haversineDist(lat, lon, c.lat, c.lon);
    if (d < minDist) {
      minDist = d;
      best = c;
    }
  }
  return best;
}

function reconstructHexPath(prev, srcId, dstId) {
  const path = [];
  let cur = dstId;
  while (cur) {
    path.unshift(cur);
    if (cur === srcId) break;
    cur = prev[cur] || null;
  }
  if (!path.length || path[0] !== srcId) return [];
  return path;
}

function getHexHopCost(fromCell, toCell, cellPenalty = {}) {
  const hopKm = haversineDist(fromCell.lat, fromCell.lon, toCell.lat, toCell.lon);
  const penalty = cellPenalty[toCell.id] || 0;
  const trafficCost = 1 + (toCell.density * 2.6) + (penalty * 0.9);
  return {
    hopKm,
    weighted: hopKm * trafficCost
  };
}

function summarizeHexPath(pathIds) {
  let weightedDistance = 0;
  let rawDistance = 0;
  let avgDensity = 0;

  if (pathIds.length > 1) {
    for (let i = 0; i < pathIds.length - 1; i++) {
      const a = hexCellById.get(pathIds[i]);
      const b = hexCellById.get(pathIds[i + 1]);
      if (!a || !b) continue;
      const hop = getHexHopCost(a, b);
      rawDistance += hop.hopKm;
      weightedDistance += hop.weighted;
      avgDensity += b.density;
    }
    avgDensity = avgDensity / (pathIds.length - 1);
  }

  return { weightedDistance, rawDistance, avgDensity };
}

function runHexPathSearch(srcCell, dstCell, algorithm, cellPenalty = {}) {
  const start = performance.now();
  const algo = (algorithm || 'dijkstra').toLowerCase();

  const prev = {};
  const visited = new Set();
  const visitedOrder = [];
  const heuristic = (a, b) => haversineDist(a.lat, a.lon, b.lat, b.lon);

  if (algo === 'bfs' || algo === 'dfs') {
    const seen = new Set([srcCell.id]);
    const frontier = [srcCell.id];

    while (frontier.length) {
      const currentId = algo === 'bfs' ? frontier.shift() : frontier.pop();
      if (!currentId || visited.has(currentId)) continue;

      visited.add(currentId);
      visitedOrder.push(currentId);

      if (currentId === dstCell.id) break;

      const current = hexCellById.get(currentId);
      if (!current) continue;

      const neighbors = current.neighbors
        .filter(id => !seen.has(id))
        .sort((a, b) => {
          const ca = hexCellById.get(a);
          const cb = hexCellById.get(b);
          if (!ca || !cb) return 0;
          return (ca.density + (cellPenalty[a] || 0)) - (cb.density + (cellPenalty[b] || 0));
        });

      const ordered = algo === 'dfs' ? [...neighbors].reverse() : neighbors;
      for (const nId of ordered) {
        seen.add(nId);
        if (prev[nId] === undefined) prev[nId] = currentId;
        frontier.push(nId);
      }
    }

    const pathIds = reconstructHexPath(prev, srcCell.id, dstCell.id);
    const computationMs = performance.now() - start;
    const summary = summarizeHexPath(pathIds);

    return {
      found: pathIds.length > 0,
      pathIds,
      weightedDistance: summary.weightedDistance,
      rawDistance: summary.rawDistance,
      avgDensity: summary.avgDensity,
      computationMs,
      visitedCount: visitedOrder.length,
      visitedOrder,
      algorithm: algo
    };
  }

  const dist = {};
  for (const c of hexCells) dist[c.id] = Infinity;
  dist[srcCell.id] = 0;

  const open = [{ id: srcCell.id, g: 0, f: 0 }];

  while (open.length) {
    open.sort((x, y) => x.f - y.f);
    const current = open.shift();
    if (!current || visited.has(current.id)) continue;

    visited.add(current.id);
    visitedOrder.push(current.id);

    if (current.id === dstCell.id) break;

    const cell = hexCellById.get(current.id);
    if (!cell) continue;

    for (const nId of cell.neighbors) {
      if (visited.has(nId)) continue;
      const neighbor = hexCellById.get(nId);
      if (!neighbor) continue;

      const hop = getHexHopCost(cell, neighbor, cellPenalty);
      const nextG = dist[current.id] + hop.weighted;

      if (nextG < dist[nId]) {
        dist[nId] = nextG;
        prev[nId] = current.id;

        const h = algo === 'astar' ? heuristic(neighbor, dstCell) : 0;
        open.push({ id: nId, g: nextG, f: nextG + h });
      }
    }
  }

  const pathIds = reconstructHexPath(prev, srcCell.id, dstCell.id);
  const computationMs = performance.now() - start;
  const summary = summarizeHexPath(pathIds);

  return {
    found: pathIds.length > 0,
    pathIds,
    weightedDistance: summary.weightedDistance,
    rawDistance: summary.rawDistance,
    avgDensity: summary.avgDensity,
    computationMs,
    visitedCount: visitedOrder.length,
    visitedOrder,
    algorithm: algo
  };
}

function highlightHexRoute(pathIds) {
  activeHexRoute = Array.isArray(pathIds) ? pathIds : [];
  if (!hexCells.length) return;

  const onPath = new Set(activeHexRoute);
  for (const cell of hexCells) {
    if (!cell.layer) continue;
    if (onPath.has(cell.id)) {
      cell.layer.setStyle({
        color: 'rgba(0,0,0,0.85)',
        weight: 2,
        fillOpacity: 0.25
      });
    } else {
      const density = cell.density;
      cell.layer.setStyle({
        color: `rgba(255,255,255,${(0.08 + (density * 0.24)).toFixed(3)})`,
        weight: 1,
        fillOpacity: 0.025 + (density * 0.10)
      });
    }
  }
}

function hashText32(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function toTitleCase(value) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

function createSyntheticLocation(query) {
  const q = query.trim();
  if (!q) return null;

  const demo = getDemoGraph();
  const lower = q.toLowerCase();

  let match = demo.nodes.find(n => n.id.toLowerCase() === lower);
  if (!match) {
    match = demo.nodes.find(n => n.name.toLowerCase() === lower);
  }
  if (!match) {
    match = demo.nodes.find(n => n.name.toLowerCase().includes(lower) || lower.includes(n.name.toLowerCase()));
  }

  if (match) {
    return {
      lat: match.lat,
      lon: match.lon,
      label: match.name,
      raw: { synthetic: false, matchedNode: match.id, query: q }
    };
  }

  const h1 = hashText32(lower + ':lat');
  const h2 = hashText32(lower + ':lon');

  const lat = -55 + ((h1 % 13000) / 100);
  const lon = -170 + ((h2 % 34000) / 100);

  return {
    lat,
    lon,
    label: `${toTitleCase(q)} (Synthetic)` ,
    raw: { synthetic: true, query: q }
  };
}

async function geocodeLocation(query) {
  const loc = createSyntheticLocation(query);
  if (!loc) throw new Error(`Could not resolve location: ${query}`);
  return loc;
}

function drawHexRoute(srcGeo, dstGeo, routeResult) {
  for (let e of edgeLines) map.removeLayer(e);
  for (let id in nodeMarkers) map.removeLayer(nodeMarkers[id]);
  edgeLines = [];
  nodeMarkers = {};
  bounds = L.latLngBounds();

  const coords = [[srcGeo.lat, srcGeo.lon]];
  for (const id of routeResult.pathIds) {
    const cell = hexCellById.get(id);
    if (cell) coords.push([cell.lat, cell.lon]);
  }
  coords.push([dstGeo.lat, dstGeo.lon]);

  coords.forEach(c => bounds.extend(c));

  edgeLines.push(L.polyline(coords, { color: '#ffffff', weight: 10, opacity: 0.55 }).addTo(map));
  edgeLines.push(L.polyline(coords, { color: '#000000', weight: 5, opacity: 0.95 }).addTo(map));

  const sM = L.circleMarker([srcGeo.lat, srcGeo.lon], {
    radius: 7, fillColor: 'rgba(124,244,160,0.8)', color: '#7cf4a0', weight: 2, fillOpacity: 1
  }).addTo(map);
  sM.bindTooltip(`<b>Source</b><br>${srcGeo.label}`, { direction: 'top' }).openTooltip();
  nodeMarkers['src'] = sM;

  const dM = L.circleMarker([dstGeo.lat, dstGeo.lon], {
    radius: 7, fillColor: 'rgba(255,107,53,0.8)', color: '#ff6b35', weight: 2, fillOpacity: 1
  }).addTo(map);
  dM.bindTooltip(`<b>Dest</b><br>${dstGeo.label}`, { direction: 'top' }).openTooltip();
  nodeMarkers['dst'] = dM;

  if (bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50] });
}

function renderHexRouteResult(srcGeo, dstGeo, routeResult, algo) {
  const resultEl = document.getElementById('route-result');
  if (!routeResult.found) {
    resultEl.innerHTML = `<div class="result-card error"><div class="badge badge-danger">NO PATH FOUND</div><p style="margin-top:10px;font-size:13px;color:var(--muted)">No valid hex path was found between these locations.</p></div>`;
    return;
  }

  const labels = {
    dijkstra: 'Dijkstra',
    astar: 'A*',
    bfs: 'BFT',
    dfs: 'DFT'
  };
  const estMin = (routeResult.weightedDistance / 42) * 60;
  resultEl.innerHTML = `<div class="result-card success">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <span class="badge badge-success">${labels[algo] || 'Route'} Â· HEX TRAFFIC ROUTING</span>
      <span style="font-size:11px;color:var(--muted);font-family:var(--font-mono)">${routeResult.computationMs.toFixed(3)}ms</span>
    </div>
    <div class="stat-grid">
      <div class="stat"><div class="stat-label">Geo Distance</div><div class="stat-value">${routeResult.rawDistance.toFixed(1)}<span class="stat-unit"> km</span></div></div>
      <div class="stat"><div class="stat-label">Traffic-Weighted</div><div class="stat-value">${routeResult.weightedDistance.toFixed(1)}<span class="stat-unit"> cost-km</span></div></div>
      <div class="stat"><div class="stat-label">Hex Hops</div><div class="stat-value">${Math.max(0, routeResult.pathIds.length - 1)}</div></div>
      <div class="stat"><div class="stat-label">Est. Time</div><div class="stat-value">${Math.round(estMin)}<span class="stat-unit"> min</span></div></div>
    </div>
    <div style="margin-top:10px;font-size:12px;color:var(--muted);line-height:1.6">
      Route computed on dynamic honeycomb mesh from <b>${srcGeo.label}</b> to <b>${dstGeo.label}</b>.
      Hex size shrinks continuously as you zoom in; darker/warmer hexes imply higher traffic penalty.
    </div>
  </div>`;
}


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// GRAPH LOADING
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Removed loadGraph since we use dynamic OSRM routing

function getDemoGraph() {
  const nodes = [
    {id:"NYC",name:"New York",lat:40.7128,lon:-74.0060,blocked:false},
    {id:"LAX",name:"Los Angeles",lat:34.0522,lon:-118.2437,blocked:false},
    {id:"CHI",name:"Chicago",lat:41.8781,lon:-87.6298,blocked:false},
    {id:"MEX",name:"Mexico City",lat:19.4326,lon:-99.1332,blocked:false},
    {id:"YYZ",name:"Toronto",lat:43.6510,lon:-79.3470,blocked:false},
    {id:"LON",name:"London",lat:51.5074,lon:-0.1278,blocked:false},
    {id:"PAR",name:"Paris",lat:48.8566,lon:2.3522,blocked:false},
    {id:"BER",name:"Berlin",lat:52.5200,lon:13.4050,blocked:false},
    {id:"MAD",name:"Madrid",lat:40.4168,lon:-3.7038,blocked:false},
    {id:"ROM",name:"Rome",lat:41.9028,lon:12.4964,blocked:false},
    {id:"MOW",name:"Moscow",lat:55.7558,lon:37.6173,blocked:false},
    {id:"CAI",name:"Cairo",lat:30.0444,lon:31.2357,blocked:false},
    {id:"JNB",name:"Johannesburg",lat:-26.2041,lon:28.0473,blocked:false},
    {id:"CPT",name:"Cape Town",lat:-33.9249,lon:18.4241,blocked:false},
    {id:"DXB",name:"Dubai",lat:25.2048,lon:55.2708,blocked:false},
    {id:"MUM",name:"Mumbai",lat:19.0760,lon:72.8777,blocked:false},
    {id:"DEL",name:"Delhi",lat:28.6139,lon:77.2090,blocked:false},
    {id:"PEK",name:"Beijing",lat:39.9042,lon:116.4074,blocked:false},
    {id:"SHA",name:"Shanghai",lat:31.2304,lon:121.4737,blocked:false},
    {id:"TYO",name:"Tokyo",lat:35.6762,lon:139.6503,blocked:false},
    {id:"SEO",name:"Seoul",lat:37.5665,lon:126.9780,blocked:false},
    {id:"SIN",name:"Singapore",lat:1.3521,lon:103.8198,blocked:false},
    {id:"BKK",name:"Bangkok",lat:13.7563,lon:100.5018,blocked:false},
    {id:"SYD",name:"Sydney",lat:-33.8688,lon:151.2093,blocked:false},
    {id:"MEL",name:"Melbourne",lat:-37.8136,lon:144.9631,blocked:false},
    {id:"GIG",name:"Rio de Janeiro",lat:-22.9068,lon:-43.1729,blocked:false},
    {id:"GRU",name:"Sao Paulo",lat:-23.5505,lon:-46.6333,blocked:false},
    {id:"EZE",name:"Buenos Aires",lat:-34.6037,lon:-58.3816,blocked:false},
    {id:"BOG",name:"Bogota",lat:4.7110,lon:-74.0721,blocked:false},
    {id:"LIM",name:"Lima",lat:-12.0464,lon:-77.0428,blocked:false}
  ];
  const edgeDefs = [
    ["NYC","CHI",1140],["NYC","YYZ",790],["CHI","LAX",3240],["LAX","MEX",2500],
    ["NYC","MEX",3360],["MEX","BOG",3160],["BOG","LIM",1880],["LIM","EZE",3140],
    ["BOG","GRU",4320],["GRU","GIG",430],["GRU","EZE",1700],["LON","PAR",344],
    ["PAR","MAD",1050],["PAR","BER",1050],["PAR","ROM",1420],["BER","ROM",1500],
    ["BER","MOW",1600],["LON","BER",930],["MAD","CAI",3350],["ROM","CAI",2130],
    ["CAI","DXB",2400],["CAI","JNB",6300],["JNB","CPT",1400],["DXB","MUM",1930],
    ["MOW","DEL",4340],["DXB","DEL",2200],["MUM","DEL",1400],["DEL","BKK",2900],
    ["BKK","SIN",1830],["SIN","SHA",3800],["DEL","PEK",3780],["PEK","SHA",1200],
    ["PEK","SEO",950],["SEO","TYO",1150],["SHA","TYO",1760],["SIN","SYD",6300],
    ["SYD","MEL",870],["NYC","LON",5570],["LAX","TYO",8800],["GIG","CPT",6050],
    ["MOW","PEK",5800],["YYZ","LON",5700],["EZE","CPT",6800]
  ];
  const edges = [];
  edgeDefs.forEach(([f,t,w]) => {
    edges.push({from:f, to:t, base_weight:w, weight:w, traffic_multiplier:1.0, road_name:"", blocked:false});
    edges.push({from:t, to:f, base_weight:w, weight:w, traffic_multiplier:1.0, road_name:"", blocked:false});
  });
  return {nodes, edges};
}

// Removed getDemoGraph and populateSelects

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MAP RENDER LOGIC
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function computeNodePositions() {
  updateMapLayer();
}

function updateMapLayer() {
  if (!graphData || !map) return;
  
  for (let e of edgeLines) map.removeLayer(e);
  for (let id in nodeMarkers) map.removeLayer(nodeMarkers[id]);
  edgeLines = [];
  nodeMarkers = {};
  bounds = L.latLngBounds();

  const drawnEdges = new Set();
  graphData.edges.forEach(edge => {
    const key = [edge.from, edge.to].sort().join('-');
    if (drawnEdges.has(key)) return;
    drawnEdges.add(key);

    const n1 = graphData.nodes.find(n => n.id === edge.from);
    const n2 = graphData.nodes.find(n => n.id === edge.to);
    if (!n1 || !n2) return;

    const isPathEdge = isEdgeOnPath(edge.from, edge.to);
    const isBlocked = edge.blocked;
    const hasTraffic = edge.traffic_multiplier > 1.2;

    let color = '#232b38';
    let weight = 2;
    let dashArray = '';
    let opacity = 0.9;

    if (isBlocked) {
      color = '#ff4560'; weight = 3; dashArray = '6, 6';
    } else if (isPathEdge) {
      color = '#000000'; weight = 6; opacity = 1.0;
    } else if (hasTraffic) {
      color = '#ffd166'; weight = 3; opacity = 0.5 + (edge.traffic_multiplier - 1) * 0.2;
    }

    // Outline glow for path
    if (isPathEdge) {
      edgeLines.push(L.polyline([[n1.lat, n1.lon], [n2.lat, n2.lon]], {
        color: '#ffffff', weight: 10, opacity: 0.4
      }).addTo(map));
    }

    const line = L.polyline([[n1.lat, n1.lon], [n2.lat, n2.lon]], {
      color, weight, dashArray, opacity
    }).addTo(map);

    if (isPathEdge) {
      const midLat = (n1.lat + n2.lat) / 2;
      const midLon = (n1.lon + n2.lon) / 2;
      const icon = L.divIcon({
        className: 'edge-label',
        html: `<div style="background:rgba(0,0,0,0.85);color:#ffffff;font-family:'IBM Plex Mono';font-size:10px;padding:2px 6px;border-radius:4px;width:max-content;border:1px solid rgba(255,255,255,0.3)">${edge.base_weight}</div>`,
        iconSize: [0, 0],
        iconAnchor: [10, 10]
      });
      edgeLines.push(L.marker([midLat, midLon], {icon}).addTo(map));
    }

    edgeLines.push(line);
  });

  graphData.nodes.forEach(node => {
    bounds.extend([node.lat, node.lon]);
    const isOnPath = currentPath.includes(node.id);
    const isVisited = visitedNodes.includes(node.id);
    const isSrc = currentPath[0] === node.id;
    const isDst = currentPath[currentPath.length-1] === node.id;
    const isBlocked = node.blocked;

    let fillColor = '#161b24', color = '#232b38';
    if (isBlocked) { fillColor = '#1a0a0e'; color = '#ff4560'; }
    else if (isSrc) { fillColor = 'rgba(124,244,160,0.4)'; color = '#7cf4a0'; }
    else if (isDst) { fillColor = 'rgba(255,107,53,0.4)'; color = '#ff6b35'; }
    else if (isOnPath) { fillColor = 'rgba(0,0,0,0.85)'; color = '#000000'; }
    else if (isVisited) { fillColor = 'rgba(179,136,255,0.4)'; color = 'rgba(179,136,255,1)'; }

    const marker = L.circleMarker([node.lat, node.lon], {
      radius: isOnPath ? 7 : 5,
      fillColor: fillColor,
      color: color,
      weight: isOnPath ? 3 : 2,
      fillOpacity: 1,
      opacity: 1
    }).addTo(map);

    marker.bindTooltip(`<b>${node.id}</b><br><span style="color:#6b7a90;font-size:10px">${node.name}</span>`, {
      permanent: true,
      direction: 'right',
      className: 'leaflet-custom-tooltip',
      offset: [10, 0]
    });

    marker.on('click', () => {
      const srcInput = document.getElementById('src-select');
      const dstInput = document.getElementById('dst-select');
      if (!srcInput.value) {
        srcInput.value = node.id;
        showToast(`Selected ${node.name} as Source`, 'success');
      } else if (!dstInput.value) {
        dstInput.value = node.id;
        showToast(`Selected ${node.name} as Destination`, 'success');
      } else {
        showNodeInfo(node);
      }
    });
    nodeMarkers[node.id] = marker;
  });
}

function isEdgeOnPath(a, b) {
  for (let i = 0; i < currentPath.length - 1; i++) {
    if ((currentPath[i] === a && currentPath[i+1] === b) ||
        (currentPath[i] === b && currentPath[i+1] === a)) return true;
  }
  return false;
}

function showNodeInfo(node) {
  const edges = graphData.edges.filter(e => e.from === node.id || e.to === node.id);
  const unique = [...new Map(edges.map(e => {
    const key = [e.from, e.to].sort().join('-');
    return [key, e];
  })).values()];
  const connections = unique.map(e => {
    const other = e.from === node.id ? e.to : e.from;
    const n = graphData.nodes.find(x=>x.id===other);
    return `${n?.name||other} (${e.base_weight}km)`;
  }).join(', ');
  showToast(`ðŸ“ ${node.name}
Connections: ${connections.substring(0,80)}`, 'info');
}

function zoomIn() { map.zoomIn(); }
function zoomOut() { map.zoomOut(); }
function resetView() { if(bounds && bounds.isValid()) map.fitBounds(bounds, {padding: [50, 50]}); }
let animationPaused = false;
function toggleAnimation() {
  animationPaused = !animationPaused;
  const btn = document.getElementById('anim-btn');
  btn.textContent = animationPaused ? 'â–¶' : 'â¸';
  btn.style.color = animationPaused ? 'var(--accent3)' : 'var(--text)';
  if (!animationPaused) {
    // Resume is handled naturally by the loop checking animationPaused
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ROUTE FINDING
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const ALGO_DESCRIPTIONS = {
  dijkstra: 'Dijkstra = weighted shortest path on hex traffic mesh',
  astar:    'A* Star = heuristic-guided weighted search on hex mesh',
  bfs:      'BFT = breadth-first hex traversal with low-density expansion preference',
  dfs:      'DFT = depth-first hex traversal with low-density expansion preference'
};

function setAlgo(algo) {
  selectedAlgo = algo;
  ['btn-dijk','btn-astar','btn-bfs','btn-dfs'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  const btnMap = { dijkstra:'btn-dijk', astar:'btn-astar', bfs:'btn-bfs', dfs:'btn-dfs' };
  const btn = document.getElementById(btnMap[algo]);
  if (btn) btn.classList.add('active');
  const desc = document.getElementById('algo-desc');
  if (desc) desc.textContent = ALGO_DESCRIPTIONS[algo] || '';
  const findText = document.getElementById('find-btn-text');
  if (findText) {
    if (algo === 'bfs') findText.textContent = 'ðŸ” RUN BFT ON HEX MESH';
    else if (algo === 'dfs') findText.textContent = 'ðŸ” RUN DFT ON HEX MESH';
    else findText.textContent = 'âš¡ FIND HEX TRAFFIC PATH';
  }
}

async function findRoute() {
  const src = document.getElementById('src-select').value.trim();
  const dst = document.getElementById('dst-select').value.trim();
  if (!src || !dst) { showToast('Please enter both locations', 'error'); return; }

  setLoading('find-btn', 'find-btn-text', true, 'ROUTING ON HEX MESH\u2026');

  try {
    if (!hexCells.length) refreshHexMesh();

    const [srcGeo, dstGeo] = await Promise.all([
      geocodeLocation(src),
      geocodeLocation(dst)
    ]);

    const srcCell = findNearestHexCell(srcGeo.lat, srcGeo.lon);
    const dstCell = findNearestHexCell(dstGeo.lat, dstGeo.lon);
    if (!srcCell || !dstCell) throw new Error('Unable to map locations into hex mesh. Try zooming out once.');

    const routeResult = runHexPathSearch(srcCell, dstCell, selectedAlgo);
    if (!routeResult.found) throw new Error('No mesh route found. Try a different zoom level or traffic setting.');

    highlightHexRoute(routeResult.pathIds);
    drawHexRoute(srcGeo, dstGeo, routeResult);
    renderHexRouteResult(srcGeo, dstGeo, routeResult, selectedAlgo);

  } catch(e) {
    document.getElementById('route-result').innerHTML = `<div class="result-card error"><div class="badge badge-danger">ERROR</div><p style="margin-top:10px;font-size:13px;color:var(--muted)">${e.message}</p></div>`;
  } finally {
    const label = selectedAlgo === 'bfs' ? '\ud83d\udd0d RUN BFT ON HEX MESH' : selectedAlgo === 'dfs' ? '\ud83d\udd0d RUN DFT ON HEX MESH' : '\u26a1 FIND HEX TRAFFIC PATH';
    setLoading('find-btn', 'find-btn-text', false, label);
  }
}

// Haversine distance in km between two lat/lon pairs
function haversineDist(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Legacy traversal methods were replaced by unified hex-density routing.


function drawRealRoute(srcP, dstP, route, fallback) {
  for (let e of edgeLines) map.removeLayer(e);
  for (let id in nodeMarkers) map.removeLayer(nodeMarkers[id]);
  edgeLines = []; nodeMarkers = {}; bounds = L.latLngBounds();
  
  // Clear graphData to prevent updateMapLayer from redrawing all cities
  graphData = null;
  
  const sc = [parseFloat(srcP.lat), parseFloat(srcP.lon)];
  const dc = [parseFloat(dstP.lat), parseFloat(dstP.lon)];

  if (!fallback && route) {
    // Build coords â€” always prepend source & append destination so path
    // visually connects from the user's chosen source all the way to destination.
    let coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
    coords.unshift(sc);   // ensure path starts exactly at source
    coords.push(dc);      // ensure path ends exactly at destination

    // White halo for contrast on light-coloured map tiles
    const halo = L.polyline(coords, { color: '#ffffff', weight: 11, opacity: 0.55 }).addTo(map);
    edgeLines.push(halo);
    // Bold black path on top
    const line = L.polyline(coords, { color: '#000000', weight: 6, opacity: 1.0 }).addTo(map);
    edgeLines.push(line);

    // Extend bounds to include every point on the route PLUS both endpoints
    coords.forEach(c => bounds.extend(c));
    bounds.extend(sc);
    bounds.extend(dc);
    
    const dist = (route.distance / 1000).toFixed(1);
    const mins = (route.duration / 60).toFixed(1);
    
    document.getElementById('route-result').innerHTML = `<div class="result-card success">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span class="badge badge-success">ðŸŒ GLOBAL ROUTING (OSRM)</span>
      </div>
      <div class="stat-grid">
        <div class="stat"><div class="stat-label">Driving Dist</div><div class="stat-value">${dist}<span class="stat-unit"> km</span></div></div>
        <div class="stat"><div class="stat-label">Est. Time</div><div class="stat-value">${mins}<span class="stat-unit"> min</span></div></div>
      </div>
      <p style="font-size:12px;color:var(--muted);margin-top:8px;">${srcP.name || srcP.display_name.split(',')[0]} â†’ ${dstP.name || dstP.display_name.split(',')[0]}</p>
    </div>`;
  } else {
    // No driving route â€” draw a flight path with dotted line source â†’ destination
    bounds.extend(sc);
    bounds.extend(dc);

    // Flight path styling: blue dotted line with glow effect
    const halo = L.polyline([sc, dc], { color: '#4dabf7', weight: 8, opacity: 0.3, dashArray: '12, 10' }).addTo(map);
    edgeLines.push(halo);
    // Main flight path: blue with larger dash pattern for flight appearance
    const line = L.polyline([sc, dc], { color: '#228be6', weight: 4, dashArray: '15, 12', opacity: 0.95, lineCap: 'round' }).addTo(map);
    edgeLines.push(line);

    // Add flight path arrow markers in the middle
    const midLat = (sc[0] + dc[0]) / 2;
    const midLon = (sc[1] + dc[1]) / 2;
    const flightIcon = L.divIcon({
      className: 'flight-marker',
      html: `<div style="font-size:14px;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.3));">âœˆï¸</div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });
    edgeLines.push(L.marker([midLat, midLon], { icon: flightIcon, interactive: false }).addTo(map));

    document.getElementById('route-result').innerHTML = `<div class="result-card warn" style="border-color:var(--warn)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span class="badge badge-warn" style="color:var(--warn)">âœˆï¸ DIRECT FLIGHT PATH</span>
      </div>
      <p style="font-size:12px;color:var(--muted);margin-bottom:8px;">No driving route found between these locations. Showing direct flight path with dotted line.</p>
    </div>`;
  }

  const sM = L.circleMarker(sc, { radius: 7, fillColor: 'rgba(124,244,160,0.8)', color: '#7cf4a0', weight: 2, fillOpacity: 1 }).addTo(map);
  sM.bindTooltip(`<b>Source</b><br>${srcP.name || srcP.display_name.split(',')[0]}`, {direction: 'top'}).openTooltip();
  nodeMarkers['src'] = sM;

  const dM = L.circleMarker(dc, { radius: 7, fillColor: 'rgba(255,107,53,0.8)', color: '#ff6b35', weight: 2, fillOpacity: 1 }).addTo(map);
  dM.bindTooltip(`<b>Dest</b><br>${dstP.name || dstP.display_name.split(',')[0]}`, {direction: 'top'}).openTooltip();
  nodeMarkers['dst'] = dM;

  map.fitBounds(bounds, {padding: [50, 50]});
}

function renderRouteResult(r) {
  const el = document.getElementById('route-result');
  if (!r.found) {
    el.innerHTML = `<div class="result-card error">
      <div class="badge badge-danger">NO PATH FOUND</div>
      <p style="margin-top:10px;font-size:13px;color:var(--muted)">No traversable path between these nodes. Check for road blocks.</p>
    </div>`;
    return;
  }
  const pathHtml = r.path.map((n, i) => {
    const cls = i === 0 ? 'src' : (i === r.path.length-1 ? 'dst' : '');
    const node = graphData?.nodes.find(x=>x.id===n);
    return `${i>0?'<span class="path-arrow">â†’</span>':''}<span class="path-node ${cls}">${node?.name||n}</span>`;
  }).join('');

  el.innerHTML = `<div class="result-card success">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <span class="badge badge-success">${r.algorithm} Â· PATH FOUND</span>
      <span style="font-size:11px;color:var(--muted);font-family:var(--font-mono)">${r.computation_ms?.toFixed(3)||'â€”'}ms</span>
    </div>
    <div class="stat-grid">
      <div class="stat"><div class="stat-label">Distance</div><div class="stat-value">${r.total_distance}<span class="stat-unit"> km</span></div></div>
      <div class="stat"><div class="stat-label">Est. Time</div><div class="stat-value">${Math.round(r.total_time_min||0)}<span class="stat-unit"> min</span></div></div>
      <div class="stat"><div class="stat-label">Nodes Visited</div><div class="stat-value">${r.visited_count||r.visited_order?.length||0}</div></div>
      <div class="stat"><div class="stat-label">Hops</div><div class="stat-value">${r.path.length - 1}</div></div>
    </div>
    <div class="path-display">
      <div class="section-title" style="margin-bottom:8px">Shortest Path</div>
      <div class="path-nodes">${pathHtml}</div>
    </div>
    <div class="section-title">Visited Order (${r.visited_order?.length||0} nodes)</div>
    <div class="visited-list">${(r.visited_order||[]).map(n=>{const nd=graphData?.nodes.find(x=>x.id===n);return nd?.name||n}).join(' â†’ ')}</div>
  </div>`;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// COMPARE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•


async function compareAlgos() {
  const src = document.getElementById('cmp-src').value.trim();
  const dst = document.getElementById('cmp-dst').value.trim();
  if (!src || !dst) { showToast('Enter source and destination', 'error'); return; }

  document.getElementById('compare-result').innerHTML =
    `<div class="empty-state"><div class="empty-state-icon pulse">âš™ï¸</div><div class="empty-state-text">Creating synthetic routing designâ€¦</div></div>`;

  try {
    if (!hexCells.length) refreshHexMesh();

    const [srcGeo, dstGeo] = await Promise.all([
      geocodeLocation(src),
      geocodeLocation(dst)
    ]);

    const srcCell = findNearestHexCell(srcGeo.lat, srcGeo.lon);
    const dstCell = findNearestHexCell(dstGeo.lat, dstGeo.lon);
    if (!srcCell || !dstCell) throw new Error('Could not map locations into the synthetic mesh.');
    if (srcCell.id === dstCell.id) throw new Error('Both locations map to the same hex cell. Try different inputs.');

    document.getElementById('compare-result').innerHTML =
      `<div class="empty-state"><div class="empty-state-icon pulse">âš™ï¸</div><div class="empty-state-text">Running all 4 hex algorithmsâ€¦</div></div>`;

    const cmpData = {
      dijkstra: runHexPathSearch(srcCell, dstCell, 'dijkstra'),
      astar: runHexPathSearch(srcCell, dstCell, 'astar'),
      bfs: runHexPathSearch(srcCell, dstCell, 'bfs'),
      dfs: runHexPathSearch(srcCell, dstCell, 'dfs')
    };

    const bestPath = ['dijkstra', 'astar', 'bfs', 'dfs']
      .map(k => cmpData[k])
      .filter(r => r.found)
      .sort((a, b) => a.weightedDistance - b.weightedDistance)[0];

    if (bestPath) {
      highlightHexRoute(bestPath.pathIds);
      drawHexRoute(srcGeo, dstGeo, bestPath);
    }

    // Render 4-column comparison
    const algos = [
      { key: 'dijkstra', label: 'Dijkstra',  color: 'var(--accent)',  note: 'Weighted shortest path on mesh' },
      { key: 'astar',    label: 'A* Star',   color: 'var(--accent4)', note: 'Weighted + heuristic guidance' },
      { key: 'bfs',      label: 'BFT',       color: '#7cf4a0',        note: 'Breadth-first with density ordering' },
      { key: 'dfs',      label: 'DFT',       color: '#ffd166',        note: 'Depth-first with density ordering' },
    ];

    const bestVisited = Math.min(...algos.map(a => cmpData[a.key]?.visited_count || Infinity));

    const cols = algos.map(a => {
      const d = cmpData[a.key] || {};
      const isBest = d.visitedCount === bestVisited;
      return `<div class="compare-item" style="border-color:${isBest ? a.color : 'var(--border)'}">
        <div class="compare-algo" style="color:${a.color}">${a.label}${isBest ? ' &#11088;' : ''}</div>
        <div style="font-size:9px;color:var(--muted);margin-bottom:8px">${a.note}</div>
        <div class="compare-stat"><div class="compare-stat-label">Distance</div>
          <div class="compare-stat-val" style="color:${a.color}">${d.found ? d.rawDistance.toFixed(1) + ' km' : 'No path'}</div></div>
        <div class="compare-stat"><div class="compare-stat-label">Weighted Cost</div>
          <div class="compare-stat-val">${d.found ? d.weightedDistance.toFixed(1) : 'â€”'}</div></div>
        <div class="compare-stat"><div class="compare-stat-label">Nodes Visited</div>
          <div class="compare-stat-val">${d.visitedCount ?? 'â€”'}</div></div>
        <div class="compare-stat"><div class="compare-stat-label">Compute Time</div>
          <div class="compare-stat-val">${d.computationMs?.toFixed(2) ?? 'â€”'}ms</div></div>
        <div class="compare-stat"><div class="compare-stat-label">Hops</div>
          <div class="compare-stat-val">${d.pathIds?.length ? d.pathIds.length - 1 : 'â€”'}</div></div>
      </div>`;
    }).join('');

    document.getElementById('compare-result').innerHTML = `<div class="result-card success">
      <div class="badge badge-success" style="margin-bottom:12px">â­ = fewest nodes explored</div>
      <div class="compare-row" style="grid-template-columns:1fr 1fr;gap:8px;display:grid">${cols}</div>
      <div style="margin-top:12px;font-size:11px;color:var(--muted);padding:10px;background:var(--surface3);border-radius:8px;border:1px solid var(--border);line-height:1.7">
        ðŸ’¡ All algorithms now run on synthetic honeycomb traffic design with no external API dependency.
      </div>
    </div>`;

  } catch(e) {
    document.getElementById('compare-result').innerHTML =
      `<div class="result-card error"><div class="badge badge-danger">ERROR</div><p style="margin-top:8px;font-size:12px;color:var(--muted)">${e.message}</p></div>`;
  }
}

let multiRealRoutes = [];

async function findMultiRoute() {
  const src = document.getElementById('multi-src').value.trim();
  const dst = document.getElementById('multi-dst').value.trim();
  const k   = parseInt(document.getElementById('multi-k').value) || 3;
  if (!src || !dst) { showToast('Enter source and destination', 'error'); return; }

  document.getElementById('multi-result').innerHTML =
    `<div class="empty-state"><div class="empty-state-icon pulse">ðŸ”</div><div class="empty-state-text">Searching alternative routesâ€¦</div></div>`;

  try {
    if (!hexCells.length) refreshHexMesh();

    const [srcGeo, dstGeo] = await Promise.all([
      geocodeLocation(src),
      geocodeLocation(dst)
    ]);

    const srcCell = findNearestHexCell(srcGeo.lat, srcGeo.lon);
    const dstCell = findNearestHexCell(dstGeo.lat, dstGeo.lon);
    if (!srcCell || !dstCell) throw new Error('Could not map locations into the synthetic mesh.');

    const algoCycle = ['dijkstra', 'astar', 'bfs', 'dfs'];
    const cellPenalty = {};
    const signatures = new Set();
    const routes = [];

    let attempt = 0;
    while (routes.length < k && attempt < k * 6) {
      const algo = algoCycle[attempt % algoCycle.length];
      const route = runHexPathSearch(srcCell, dstCell, algo, cellPenalty);
      attempt += 1;

      if (!route.found || !route.pathIds.length) continue;
      const sig = route.pathIds.join('|');
      if (signatures.has(sig)) {
        for (const id of route.pathIds.slice(1, -1)) {
          cellPenalty[id] = (cellPenalty[id] || 0) + 0.35;
        }
        continue;
      }

      signatures.add(sig);
      routes.push({
        pathIds: route.pathIds,
        dist: route.rawDistance.toFixed(1),
        time: Math.round((route.weightedDistance / 42) * 60),
        weighted: route.weightedDistance,
        algo,
        label: `${algo.toUpperCase()} Route #${routes.length + 1}`,
        srcGeo,
        dstGeo
      });

      for (const id of route.pathIds.slice(1, -1)) {
        cellPenalty[id] = (cellPenalty[id] || 0) + 0.85;
      }
    }

    if (!routes.length) throw new Error('No synthetic alternatives found.');
    multiRealRoutes = routes;

    selectedMultiRouteIdx = 0;
    renderMultiRoutesOSRM();
  } catch(e) {
    document.getElementById('multi-result').innerHTML =
      `<div class="result-card error"><div class="badge badge-danger">ERROR</div><p style="margin-top:10px;font-size:12px;color:var(--muted)">${e.message}</p></div>`;
  }
}

// Draws all routes on map â€” selected route is bold black, others are grey
function drawAllMultiRoutes() {
  for (let e of edgeLines) map.removeLayer(e);
  for (let id in nodeMarkers) map.removeLayer(nodeMarkers[id]);
  edgeLines = []; nodeMarkers = {}; bounds = L.latLngBounds();

  multiRealRoutes.forEach((r, i) => {
    const isSelected = i === selectedMultiRouteIdx;
    const coords = [[r.srcGeo.lat, r.srcGeo.lon]];
    for (const id of r.pathIds) {
      const cell = hexCellById.get(id);
      if (cell) coords.push([cell.lat, cell.lon]);
    }
    coords.push([r.dstGeo.lat, r.dstGeo.lon]);
    coords.forEach(c => bounds.extend(c));

    if (isSelected) {
      edgeLines.push(L.polyline(coords, { color: '#ffffff', weight: 12, opacity: 0.5 }).addTo(map));
      edgeLines.push(L.polyline(coords, { color: '#000000', weight: 6,  opacity: 1.0 }).addTo(map));
      highlightHexRoute(r.pathIds);
    } else {
      edgeLines.push(L.polyline(coords, { color: '#888888', weight: 4,  opacity: 0.5, dashArray: '6,4' }).addTo(map));
    }
  });

  // Source & destination markers (from selected route)
  if (multiRealRoutes.length > 0) {
    const sel = multiRealRoutes[selectedMultiRouteIdx];
    const srcCoord = [sel.srcGeo.lat, sel.srcGeo.lon];
    const dstCoord = [sel.dstGeo.lat, sel.dstGeo.lon];
    bounds.extend(srcCoord); bounds.extend(dstCoord);

    const sM = L.circleMarker(srcCoord, { radius: 9, fillColor: 'rgba(124,244,160,0.9)', color: '#7cf4a0', weight: 2, fillOpacity: 1 }).addTo(map);
    sM.bindTooltip(`<b>Source</b><br>${sel.srcGeo.label}`, { permanent: true, direction: 'top' });
    nodeMarkers['src'] = sM;

    const dM = L.circleMarker(dstCoord, { radius: 9, fillColor: 'rgba(255,107,53,0.9)', color: '#ff6b35', weight: 2, fillOpacity: 1 }).addTo(map);
    dM.bindTooltip(`<b>Dest</b><br>${sel.dstGeo.label}`, { permanent: true, direction: 'top' });
    nodeMarkers['dst'] = dM;
  }

  if (bounds.isValid()) map.fitBounds(bounds, { padding: [60, 60] });
}

function renderMultiRoutesOSRM() {
  const html = multiRealRoutes.map((r, i) => {
    const isSelected = i === selectedMultiRouteIdx;
    const distLabel  = `${r.dist} km`;
    const timeLabel  = `â± ${r.time} min Â· ${r.algo.toUpperCase()}`;
    return `<div class="route-option ${isSelected ? 'selected' : ''}" onclick="selectMultiRouteOSRM(${i})">
      <div class="route-option-header">
        <span class="route-rank">${r.label}</span>
        <span class="route-dist">${distLabel}</span>
      </div>
      <div style="margin-top:5px;font-size:11px;color:var(--muted);font-family:var(--font-mono)">${timeLabel}</div>
    </div>`;
  }).join('');

  document.getElementById('multi-result').innerHTML = `<div style="margin-top:8px">${html}
    <p style="font-size:11px;color:var(--muted);margin-top:10px;padding:8px;background:var(--surface3);border-radius:8px;border:1px solid var(--border)">
      ðŸ’¡ Alternatives are generated synthetically by re-running hex search with progressive density penalties.
    </p>
  </div>`;

  drawAllMultiRoutes();
}

function selectMultiRouteOSRM(idx) {
  selectedMultiRouteIdx = idx;
  renderMultiRoutesOSRM();
}


async function loadHistory() {
  const container = document.getElementById('history-list');
  container.innerHTML = '<div class="empty-state-text pulse">Loading history...</div>';
  try {
    const res = await fetch(`${API}/history`);
    const data = await res.json();
    if (!data.history || data.history.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">ðŸ“œ</div><div class="empty-state-text">No route history yet.</div></div>';
      return;
    }
    container.innerHTML = data.history.map(item => `
      <div class="history-item" onclick="loadHistoryItem('${item.timestamp}')">
        <div class="history-route">${item.source} &rarr; ${item.destination}</div>
        <div class="history-meta">${item.algorithm} Â· ${item.total_distance} km Â· ${item.timestamp}</div>
      </div>
    `).join('');
  } catch(e) {
    container.innerHTML = `<div class="empty-state-text error">${e.message}</div>`;
  }
}

async function simulateTraffic() {
  const intensity = document.getElementById('traffic-slider').value / 100;
  try {
    const res = await fetch(`${API}/traffic/simulate`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ intensity })
    });
    const data = await res.json();

    if (data.mesh) {
      meshTrafficIntensity = typeof data.mesh.intensity === 'number' ? data.mesh.intensity : intensity;
      if (typeof data.mesh.seed === 'number') meshSeed = data.mesh.seed;
    } else {
      meshTrafficIntensity = intensity;
    }

    const val = document.getElementById('traffic-val');
    if (val) val.textContent = `${Math.round(meshTrafficIntensity * 100)}%`;

    await refreshHexMesh();
    graphData = data.graph; // Update local graph data
    updateMapLayer();
    showToast('ðŸš¦ Traffic simulation applied with persisted mesh density profile', 'success');
  } catch(e) {
    showToast(`Traffic simulation failed: ${e.message}`, 'error');
  }
}

async function blockRoad() {
  const from = document.getElementById('block-from').value.trim();
  const to = document.getElementById('block-to').value.trim();
  if (!from || !to) { showToast('Enter both cities to block', 'error'); return; }
  try {
    const res = await fetch(`${API}/block`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ from, to })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    
    // Refresh graph from server to reflect block
    const gRes = await fetch(`${API}/graph`);
    graphData = await gRes.json();
    updateMapLayer();
    showToast(`ðŸš§ Road ${from} <-> ${to} blocked`, 'warn');
  } catch(e) {
    showToast(`Block failed: ${e.message}`, 'error');
  }
}

async function clearHistory() {
  try {
    await fetch(`${API}/history/clear`, { method: 'POST' });
    loadHistory();
    showToast('History cleared', 'info');
  } catch(e) { showToast('Clear failed', 'error'); }
}

async function resetConditions() {
  try {
    meshTrafficIntensity = 0.35;
    activeHexRoute = [];

    const resetRes = await fetch(`${API}/traffic/reset`, { method: 'POST' });
    const resetData = await resetRes.json();

    if (resetData.mesh) {
      meshTrafficIntensity = typeof resetData.mesh.intensity === 'number' ? resetData.mesh.intensity : 0.35;
      if (typeof resetData.mesh.seed === 'number') meshSeed = resetData.mesh.seed;
    }

    const slider = document.getElementById('traffic-slider');
    const val = document.getElementById('traffic-val');
    if (slider && val) {
      const pct = Math.round(meshTrafficIntensity * 100);
      slider.value = String(pct);
      val.textContent = `${pct}%`;
    }

    await refreshHexMesh();

    // Refresh graph
    const gRes = await fetch(`${API}/graph`);
    graphData = await gRes.json();
    updateMapLayer();
    showToast('â†º Network conditions reset to normal', 'success');
  } catch(e) { showToast('Reset failed', 'error'); }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// UI HELPERS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function showSection(name) {
  ['route','compare','multi','traffic','history'].forEach(s => {
    document.getElementById(`section-${s}`).classList.toggle('active', s===name);
  });
  document.querySelectorAll('.nav-btn').forEach((b,i) => {
    b.classList.toggle('active', ['route','compare','multi','traffic','history'][i]===name);
  });
  if (name === 'history') loadHistory();
}

function setLoading(btnId, textId, loading, text) {
  const btn = document.getElementById(btnId);
  const span = document.getElementById(textId);
  btn.disabled = loading;
  span.innerHTML = loading ? `<span class="loading-spinner"></span>${text}` : text;
}

function showToast(msg, type='info') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.style.whiteSpace = 'pre-line';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

