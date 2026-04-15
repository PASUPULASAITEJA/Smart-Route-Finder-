# Smart Route Finder: Hex-Mesh Globe Routing Engine

<pre>
  _____                      _      ____             _        _____ _           _           
 / ____|                    | |    |  _ \           | |      / ____| |         | |          
| (___  _ __ ___   __ _ _ __| |_   | |_) | ___  _ __| |_ ___| (___ | |__   ___ | |_ ___ _ __
 \___ \| '_ ` _ \ / _` | '__| __|  |  _ < / _ \| '__| __/ _ \\___ \| '_ \ / _ \| __/ _ \ '__|
 ____) | | | | | | (_| | |  | |_   | |_) | (_) | |  | ||  __/____) | | | | (_) | ||  __/ |   
|_____/|_| |_| |_|\__,_|_|   \__|  |____/ \___/|_|   \__\___|_____/|_| |_|\___/ \__\___|_|   
</pre>

![Python](https://img.shields.io/badge/Python-3.8+-2b5b84)
![Flask](https://img.shields.io/badge/Flask-API-1f2937)
![Leaflet](https://img.shields.io/badge/Leaflet-2D_Map-2f9e44)
![Cesium](https://img.shields.io/badge/Cesium-3D_Globe-0ea5e9)
![Algorithms](https://img.shields.io/badge/Algorithms-Dijkstra%20A*%20BFS%20DFS-c2410c)

This project is a hybrid routing engine over a world map and a 3D globe.

Current runtime behavior:
- Route tab: real-road calibration via Nominatim geocoding + OSRM driving route.
- Compare and Multi-Route tabs: synthetic hex-mesh routing using Dijkstra, A*, BFS, DFS.
- Traffic and mesh controls: deterministic per-cell density simulation.
- 3D globe: Cesium rendering of the same mesh core with automatic fallback to 2D if 3D fails.

---

## 1) Core Mathematical Model

### 1.1 Hex Edge Scale (Exact Current Runtime)

Base edge target is piecewise by zoom level in the frontend runtime:

| Zoom range | Base edge target (meters) |
|---|---:|
| $z \le 2$ | 300000 |
| $(2,3]$ | 180000 |
| $(3,4]$ | 120000 |
| $(4,5]$ | 80000 |
| $(5,6]$ | 50000 |
| $(6,7]$ | 30000 |
| $(7,8]$ | 20000 |
| $(8,9]$ | 12000 |
| $(9,10]$ | 7000 |
| $(10,11]$ | 4000 |
| $(11,12]$ | 2400 |
| $(12,13]$ | 1400 |
| $(13,14]$ | 800 |
| $(14,15]$ | 450 |
| $(15,16]$ | 250 |
| $(16,17]$ | 140 |
| $z > 17$ | 90 |

Refined edge length is:

$$
s = \max\left(50,\frac{s_{base}(z)}{\max(0.6,r)}\right)
$$

where $r$ is the refinement factor.

### 1.2 Density Simulation Per Hex

For hex index $(row, col)$, a deterministic blend produces density:

$$
n_1 = \mathrm{fract}(\sin(12.9898\,row + 78.233\,col + 0.001\,seed)\cdot 43758.5453)
$$

$$
n_2 = \mathrm{fract}(\sin(24.132\,(row+17) + 53.771\,(col-9) + 0.0007\,seed)\cdot 12731.743)
$$

$$
b = 0.65n_1 + 0.35n_2
$$

$$
\rho = \mathrm{clamp}\left(b\cdot(0.45 + 1.35I), 0, 1\right)
$$

where $I$ is traffic intensity.

### 1.3 Geographic Hex Height Mapping

Each hex on the globe is rendered at:

$$
h = h_{min} + \rho(h_{max} - h_{min}),\quad h_{min}=50\text{m},\;h_{max}=100\text{m}
$$

### 1.4 Weighted Hop Cost for Routing

For a hop from hex $u$ to hex $v$:

$$
d_{uv} = \text{haversine}(u,v)\;[\text{km}]
$$

$$
c_{traffic}(v) = 1 + 2.6\rho_v + 0.9p_v
$$

$$
w_{uv} = d_{uv}\cdot c_{traffic}(v)
$$

where $p_v$ is dynamic penalty used for alternative routes.

---

## 2) Algorithms and Working Method

Note: these algorithms power the synthetic hex mesh workflows (Compare, Multi-Route, Traffic analysis). The Route tab uses live OSRM road routing after geocoding user inputs.

| Algorithm | Objective | Score/Rule | Working Method in This Model |
|---|---|---|---|
| Dijkstra | Minimum weighted cost | $g(v)$ only | Expands lowest cumulative $\sum w_{uv}$ over simulated-density mesh |
| A* | Faster optimal search | $f(v)=g(v)+h(v)$ | Uses weighted cost + haversine heuristic toward destination |
| BFS (BFT) | Breadth-first traversal | FIFO frontier | Traverses by levels; neighbors are density-prioritized |
| DFS (DFT) | Depth-first traversal | LIFO frontier | Dives along density-prioritized branches first |

### Dijkstra

$$
g(v) = \min_{P:s\to v}\sum_{(i,j)\in P} w_{ij}
$$

### A*

$$
f(v)=g(v)+h(v),\quad h(v)=\text{haversine}(v, goal)
$$

### BFS / DFS in Hex Mesh

- BFS uses queue expansion with low-density ordering for tie preference.
- DFS uses stack expansion with low-density ordering for branch preference.

---

## 3) Color System Used in Architecture and Math Narrative

| Semantic | Color |
|---|---|
| API layer | `#1d4ed8` |
| Mesh simulation | `#059669` |
| Routing core | `#b45309` |
| 2D rendering | `#7c3aed` |
| 3D rendering | `#0f766e` |
| State and persistence | `#374151` |

---

## 4) Architecture Diagram (Presentation Grade)

```mermaid
flowchart LR
    U["User Inputs<br/>Source / Destination / Algorithm / Seed / Refinement"] --> FE["Frontend Controller<br/>app.js"]

    FE --> NOM["Nominatim<br/>Geocoding"]
    FE --> OSRM["OSRM<br/>Driving Route"]
    OSRM --> R2D["Leaflet 2D Renderer"]
    OSRM --> R3D["Cesium 3D Renderer<br/>Route Arc"]

    FE --> MESH["Hex Mesh Builder<br/>Global Row/Col Window"]
    FE --> API["Flask API<br/>app.py"]
    API --> CFG["/api/mesh/config"]
    API --> DEN["/api/mesh/density"]
    API --> HIST["/api/history"]
    CFG --> ENGINE["SmartRouter<br/>graph_engine.py"]
    DEN --> ENGINE
    ENGINE --> SIM["Density Simulator<br/>seed + intensity + pattern"]
    MESH --> SIM
    SIM --> CELLS["Hex Cells<br/>(simulatedDensity, geoHeightMeters)"]
    CELLS --> SEARCH["Search Core<br/>Dijkstra / A* / BFS / DFS"]
    SEARCH --> ROUTE["Route Result<br/>pathIds + metrics"]
    ROUTE --> R2D
    ROUTE --> R3D
    CELLS --> R3D

    classDef frontend fill:#ede9fe,stroke:#7c3aed,stroke-width:2,color:#1f1147
    classDef api fill:#dbeafe,stroke:#1d4ed8,stroke-width:2,color:#102a56
    classDef sim fill:#dcfce7,stroke:#059669,stroke-width:2,color:#052e1d
    classDef algo fill:#ffedd5,stroke:#b45309,stroke-width:2,color:#431407
    classDef render fill:#ccfbf1,stroke:#0f766e,stroke-width:2,color:#042f2e
    classDef state fill:#f3f4f6,stroke:#374151,stroke-width:2,color:#111827

    class FE,MESH frontend
    class NOM,OSRM api
    class API,CFG,DEN,HIST api
    class ENGINE,SIM,CELLS sim
    class SEARCH,ROUTE algo
    class R2D,R3D render
    class U state
```

---

## 5) Workflow Diagram: Animation + Route Lifecycle

```mermaid
sequenceDiagram
    participant UI as UI Panel
    participant FE as Frontend Engine
    participant API as Flask API
    participant NOM as Nominatim
    participant OSRM as OSRM
    participant SIM as Density Simulator
    participant ALG as Search Core
    participant V2D as Leaflet 2D
    participant V3D as Cesium 3D

    UI->>FE: enter source and destination
    FE->>NOM: geocode input text
    NOM-->>FE: coordinates

    alt Route tab (real road mode)
        FE->>OSRM: request driving route
        OSRM-->>FE: geometry + distance + duration
        FE->>V2D: draw calibrated road route
        FE->>V3D: draw globe route arc
    else Compare/Multi/Traffic (hex mesh mode)
        FE->>API: POST /api/mesh/config
        FE->>API: POST /api/mesh/density(cells, zoom, edge_m)
        API->>SIM: compute deterministic densities
        SIM-->>FE: density map
        FE->>ALG: run selected algorithm on hex graph
        ALG-->>FE: pathIds + weighted metrics
        FE->>V2D: draw mesh route and metrics
        FE->>V3D: draw mesh + route overlays
    end

    V3D->>V3D: adaptive LOD refresh
```

---

## 6) State Diagram: 3D Presentation Mode

```mermaid
stateDiagram-v2
    [*] --> Init
    Init --> Try3D: enable3DFirstView()
    Try3D --> View3D: 3D init success
    Try3D --> View2D: 3D init failure

    View3D --> LockedIndia: stationary India view
    LockedIndia --> LockedIndia: renderGlobeHexMesh(LOD)
    LockedIndia --> View2D: 3D runtime failure

    View2D --> View3D: user retries 3D
```

---

## 7) Aesthetic ASCII Architecture Sketch

```text
                   +------------------------------+
                   |         USER CONTROLS        |
                   | src dst algo seed refine mode|
                   +---------------+--------------+
                                   |
                                   v
                      +------------+------------+
                      |     FRONTEND app.js     |
                      | mesh build + rendering  |
                      +-----+--------------+----+
                            |              |
                density req |              | route render
                            v              v
                  +---------+--------+   +------------------+
                  |   FLASK API      |   |  LEAFLET (2D)    |
                  |     app.py       |   +------------------+
                  +---------+--------+
                            |
                            v
                  +---------+----------------------+
                  | SmartRouter / graph_engine.py  |
                  | deterministic density + search |
                  +---------+----------------------+
                            |
                            v
                  +---------+----------------------+
                  | HEX CELLS: rho + geoHeight(m) |
                  +---------+----------------------+
                            |
                            v
                  +---------+----------------------+
                  |  CESIUM (3D) India-locked     |
                  |  globe mesh + route arcs      |
                  +--------------------------------+
```

---

## 8) API Surface

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/graph` | GET | Base graph data |
| `/api/route` | POST | Single algorithm route |
| `/api/compare` | POST | Parallel algorithm comparison |
| `/api/multi-route` | POST | Alternative routes |
| `/api/mesh/config` | GET/POST | Persist/retrieve seed/intensity/pattern/refinement |
| `/api/mesh/density` | POST | Deterministic density map for requested cells |
| `/api/traffic/simulate` | POST | Traffic condition simulation |
| `/api/traffic/reset` | POST | Reset simulation conditions |
| `/api/block` | POST | Block edge/road |
| `/api/history` | GET | Route history |
| `/api/history/clear` | POST | Clear route history |

---

## 9) Project Layout

```text
path finder/
|-- app.py
|-- graph_engine.py
|-- app.js
|-- styles.css
|-- index.html
`-- README.md
```

---

## 10) Run and Present

```bash
python app.py
```

Open:

```text
http://127.0.0.1:5000
```

Presentation flow:
- Route tab: enter source/destination and show calibrated real driving route.
- Compare/Multi tabs: show hex-mesh algorithm behavior (Dijkstra/A*/BFS/DFS).
- Traffic tab: demonstrate density and height coupling per hex.
- 3D: show stationary India-focused globe mesh with adaptive LOD and automatic 2D fallback on 3D failure.

---

## 11) Algorithm Complexity Reference

| Algorithm | Typical Complexity | Notes |
|---|---|---|
| Dijkstra | $O((V+E)\log V)$ | With priority queue |
| A* | Depends on heuristic quality | Best practical runtime with strong heuristic |
| BFS | $O(V+E)$ | Unweighted breadth expansion |
| DFS | $O(V+E)$ | Depth-first traversal |

---

## 12) Author

PASUPULASAITEJA
