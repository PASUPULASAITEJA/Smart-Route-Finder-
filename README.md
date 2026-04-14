# Smart Route Finder

A web-based route finding application that visualizes paths between global cities using multiple graph algorithms. Features real-time map visualization, traffic simulation, and algorithm comparison.

![Smart Route Finder](https://img.shields.io/badge/version-1.0-blue)
![Flask](https://img.shields.io/badge/Flask-2.0-green)
![Leaflet](https://img.shields.io/badge/Leaflet-1.9-green)

## Features

- **Route Finding Algorithms**
  - Dijkstra - Guaranteed shortest weighted path
  - A* Star - Heuristic-based pathfinding
  - BFT (Breadth-First Traversal) - Fewest hops
  - DFT (Depth-First Traversal) - Quick path exploration

- **Map Visualization**
  - Interactive Leaflet.js world map
  - Real-time route drawing
  - Flight path visualization (dotted lines when no road exists)
  - Source (green) and destination (orange) markers

- **Additional Features**
  - Multi-route comparison (up to 3 alternative routes)
  - Traffic simulation with dynamic congestion
  - Road blockade simulation
  - Route history tracking
  - Algorithm performance metrics

## Tech Stack

- **Backend**: Python, Flask
- **Frontend**: HTML, CSS, JavaScript
- **Map**: Leaflet.js with OpenStreetMap tiles
- **Routing**: OSRM (Open Source Routing Machine) API
- **Geocoding**: Nominatim API

## Installation

### Prerequisites
- Python 3.8+
- pip

### Setup

1. Clone the repository:
```bash
git clone https://github.com/PASUPULASAITEJA/Smart-Route-Finder-.git
cd Smart-Route-Finder-
```

2. (Optional) Install flask-cors for CORS support:
```bash
pip install flask-cors
```

3. Run the application:
```bash
python app.py
```

4. Open browser and navigate to:
```
http://127.0.0.1:5000
```

## Usage

### Finding a Route
1. Enter source location (e.g., "New York", "Paris, France")
2. Enter destination location
3. Select algorithm (Dijkstra, A*, BFT, or DFT)
4. Click "Find Path"

### Route Types
- **Road Route**: Solid black line when driving path exists
- **Flight Path**: Blue dotted line when no road route available

### Algorithm Comparison
Use the "Compare" tab to run all algorithms simultaneously and compare:
- Path distance
- Computation time
- Nodes visited
- Number of hops

### Multi-Route
Use the "Multi-Route" tab to find up to 3 alternative paths between locations.

### Traffic Simulation
Use the "Traffic" tab to:
- Simulate random traffic conditions
- Block specific roads
- Reset network conditions

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/graph` | GET | Get full graph data |
| `/api/nodes` | GET | Get list of all nodes |
| `/api/route` | POST | Find route between two nodes |
| `/api/compare` | POST | Compare all algorithms |
| `/api/multi-route` | POST | Find k-shortest paths |
| `/api/traffic/simulate` | POST | Simulate traffic |
| `/api/traffic/reset` | POST | Reset traffic conditions |
| `/api/block` | POST | Block a road |
| `/api/history` | GET | Get route history |

## Project Structure

```
Smart-Route-Finder/
├── app.py              # Flask REST API
├── graph_engine.py     # Graph algorithms and data structures
├── index.html          # Frontend UI
├── README.md           # Project documentation
└── __pycache__/        # Python cache
```

## Graph Data

The application includes a built-in graph of 30 major global cities with:
- North America: NYC, LAX, CHI, MEX, YYZ
- South America: BOG, LIM, EZE, GRU, GIG
- Europe: LON, PAR, BER, MAD, ROM, MOW
- Africa: CAI, JNB, CPT
- Middle East & India: DXB, MUM, DEL
- Asia: PEK, SHA, TYO, SEO, SIN, BKK
- Oceania: SYD, MEL

## Algorithm Details

### Dijkstra
- **Time Complexity**: O((V + E) log V)
- **Use Case**: Guaranteed shortest path in weighted graphs
- **Characteristics**: Explores all nodes uniformly

### A* (A-Star)
- **Time Complexity**: O(E)
- **Use Case**: Faster pathfinding with heuristic
- **Characteristics**: Uses distance heuristic to prioritize nodes

### BFS (Breadth-First Search)
- **Time Complexity**: O(V + E)
- **Use Case**: Finding path with fewest hops
- **Characteristics**: Explores level by level

### DFS (Depth-First Search)
- **Time Complexity**: O(V + E)
- **Use Case**: Quick path exploration
- **Characteristics**: Dives deep before backtracking

## External APIs

- **OSRM**: For real-world road routing
- **Nominatim**: For geocoding location names to coordinates

## Browser Compatibility

- Chrome/Edge (recommended)
- Firefox
- Safari

## License

This project is open source and available under the MIT License.

## Author

PASUPULASAITEJA

## Acknowledgments

- OpenStreetMap contributors
- OSRM project
- Leaflet.js team
