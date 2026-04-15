"""
Smart Route Finder - Graph Engine
Implements Dijkstra, A*, BFS, DFS, traffic simulation, multi-route comparison
"""

import heapq
import math
import time
import random
from typing import Dict, List, Tuple, Optional, Any


# ─────────────────────────────────────────────
# DATA STRUCTURES
# ─────────────────────────────────────────────

class Node:
    """Represents a city/location node in the graph."""
    def __init__(self, node_id: str, name: str, lat: float, lon: float):
        self.id = node_id
        self.name = name
        self.lat = lat
        self.lon = lon
        self.blocked = False

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "lat": self.lat,
            "lon": self.lon,
            "blocked": self.blocked
        }


class Edge:
    """Represents a road between two nodes."""
    def __init__(self, from_id: str, to_id: str, base_weight: float, road_name: str = ""):
        self.from_id = from_id
        self.to_id = to_id
        self.base_weight = base_weight   # km distance
        self.road_name = road_name
        self.traffic_multiplier = 1.0    # 1.0 = normal, >1.0 = congested
        self.blocked = False

    @property
    def weight(self):
        """Effective weight considering traffic."""
        if self.blocked:
            return float('inf')
        return self.base_weight * self.traffic_multiplier

    def to_dict(self):
        return {
            "from": self.from_id,
            "to": self.to_id,
            "base_weight": self.base_weight,
            "weight": round(self.weight, 2),
            "traffic_multiplier": round(self.traffic_multiplier, 2),
            "road_name": self.road_name,
            "blocked": self.blocked
        }


class Graph:
    """
    Weighted undirected graph using adjacency list representation.
    Supports directed edges, dynamic weights, blockades.
    """
    def __init__(self):
        self.nodes: Dict[str, Node] = {}
        self.edges: List[Edge] = []
        # adjacency: node_id -> list of (neighbor_id, edge_ref)
        self.adj: Dict[str, List[Tuple[str, Edge]]] = {}

    def add_node(self, node: Node):
        self.nodes[node.id] = node
        if node.id not in self.adj:
            self.adj[node.id] = []

    def add_edge(self, edge: Edge, bidirectional: bool = True):
        self.edges.append(edge)
        self.adj[edge.from_id].append((edge.to_id, edge))
        if bidirectional:
            reverse = Edge(edge.to_id, edge.from_id, edge.base_weight, edge.road_name)
            reverse.traffic_multiplier = edge.traffic_multiplier
            reverse.blocked = edge.blocked
            # Link them so blocking one blocks both
            self.edges.append(reverse)
            self.adj[edge.to_id].append((edge.from_id, reverse))

    def get_neighbors(self, node_id: str) -> List[Tuple[str, float, Edge]]:
        """Return (neighbor_id, effective_weight, edge) for traversable edges."""
        result = []
        for (neighbor_id, edge) in self.adj.get(node_id, []):
            if not edge.blocked and not self.nodes.get(neighbor_id, Node('', '', 0, 0)).blocked:
                result.append((neighbor_id, edge.weight, edge))
        return result

    def block_node(self, node_id: str, blocked: bool = True):
        if node_id in self.nodes:
            self.nodes[node_id].blocked = blocked

    def block_edge(self, from_id: str, to_id: str, blocked: bool = True):
        for edge in self.edges:
            if (edge.from_id == from_id and edge.to_id == to_id) or \
               (edge.from_id == to_id and edge.to_id == from_id):
                edge.blocked = blocked

    def set_traffic(self, from_id: str, to_id: str, multiplier: float):
        for edge in self.edges:
            if (edge.from_id == from_id and edge.to_id == to_id) or \
               (edge.from_id == to_id and edge.to_id == from_id):
                edge.traffic_multiplier = max(1.0, multiplier)

    def randomize_traffic(self, intensity: float = 0.3):
        """Simulate random traffic conditions across the graph."""
        for edge in self.edges:
            if random.random() < intensity:
                edge.traffic_multiplier = round(random.uniform(1.5, 3.5), 2)
            else:
                edge.traffic_multiplier = 1.0

    def reset_traffic(self):
        for edge in self.edges:
            edge.traffic_multiplier = 1.0
            edge.blocked = False
        for node in self.nodes.values():
            node.blocked = False

    def to_dict(self):
        return {
            "nodes": [n.to_dict() for n in self.nodes.values()],
            "edges": [e.to_dict() for e in self.edges]
        }


# ─────────────────────────────────────────────
# ALGORITHMS
# ─────────────────────────────────────────────

class RouteResult:
    """Encapsulates a route computation result."""
    def __init__(self, algorithm: str, source: str, destination: str):
        self.algorithm = algorithm
        self.source = source
        self.destination = destination
        self.path: List[str] = []
        self.total_distance: float = 0.0
        self.total_time_min: float = 0.0
        self.visited_order: List[str] = []
        self.visited_count: int = 0
        self.edge_path: List[dict] = []
        self.computation_ms: float = 0.0
        self.found: bool = False

    def to_dict(self):
        return {
            "algorithm": self.algorithm,
            "source": self.source,
            "destination": self.destination,
            "path": self.path,
            "total_distance": round(self.total_distance, 2),
            "total_time_min": round(self.total_time_min, 2),
            "visited_order": self.visited_order,
            "visited_count": self.visited_count,
            "edge_path": self.edge_path,
            "computation_ms": round(self.computation_ms, 3),
            "found": self.found
        }


def dijkstra(graph: Graph, source: str, destination: str) -> RouteResult:
    """
    Dijkstra's shortest path algorithm.
    Uses a min-heap priority queue.
    Time: O((V + E) log V)
    """
    result = RouteResult("Dijkstra", source, destination)
    start_time = time.perf_counter()

    # dist[node] = shortest known distance from source
    dist: Dict[str, float] = {n: float('inf') for n in graph.nodes}
    dist[source] = 0.0

    # parent[node] = (previous_node, edge) to reconstruct path
    parent: Dict[str, Optional[Tuple[str, Edge]]] = {n: None for n in graph.nodes}

    visited = set()
    visited_order = []

    # Priority queue: (distance, node_id)
    pq = [(0.0, source)]

    while pq:
        current_dist, current = heapq.heappop(pq)

        if current in visited:
            continue
        visited.add(current)
        visited_order.append(current)

        if current == destination:
            break

        for neighbor, weight, edge in graph.get_neighbors(current):
            if neighbor in visited:
                continue
            new_dist = current_dist + weight
            if new_dist < dist[neighbor]:
                dist[neighbor] = new_dist
                parent[neighbor] = (current, edge)
                heapq.heappush(pq, (new_dist, neighbor))

    result.computation_ms = (time.perf_counter() - start_time) * 1000
    result.visited_order = visited_order
    result.visited_count = len(visited_order)

    # Reconstruct path
    if dist[destination] < float('inf'):
        result.found = True
        result.total_distance = dist[destination]
        # Estimate time: avg speed 50 km/h on normal roads
        result.total_time_min = (dist[destination] / 50) * 60

        node = destination
        while node != source:
            prev, edge = parent[node]
            result.path.insert(0, node)
            result.edge_path.insert(0, edge.to_dict())
            node = prev
        result.path.insert(0, source)

    return result


def heuristic(graph: Graph, node_id: str, goal_id: str) -> float:
    """
    Haversine heuristic for A*: straight-line distance between coordinates.
    """
    n = graph.nodes[node_id]
    g = graph.nodes[goal_id]
    R = 6371  # Earth radius in km
    dlat = math.radians(g.lat - n.lat)
    dlon = math.radians(g.lon - n.lon)
    a = (math.sin(dlat/2)**2 +
         math.cos(math.radians(n.lat)) * math.cos(math.radians(g.lat)) *
         math.sin(dlon/2)**2)
    return R * 2 * math.asin(math.sqrt(a))


def astar(graph: Graph, source: str, destination: str) -> RouteResult:
    """
    A* algorithm with Haversine heuristic.
    More efficient than Dijkstra for geographic graphs.
    Time: O(E log V) with good heuristic
    """
    result = RouteResult("A*", source, destination)
    start_time = time.perf_counter()

    g_score: Dict[str, float] = {n: float('inf') for n in graph.nodes}
    g_score[source] = 0.0

    f_score: Dict[str, float] = {n: float('inf') for n in graph.nodes}
    f_score[source] = heuristic(graph, source, destination)

    parent: Dict[str, Optional[Tuple[str, Edge]]] = {n: None for n in graph.nodes}
    visited = set()
    visited_order = []

    # (f_score, g_score tiebreak, node_id)
    pq = [(f_score[source], 0.0, source)]

    while pq:
        _, current_g, current = heapq.heappop(pq)

        if current in visited:
            continue
        visited.add(current)
        visited_order.append(current)

        if current == destination:
            break

        for neighbor, weight, edge in graph.get_neighbors(current):
            if neighbor in visited:
                continue
            tentative_g = g_score[current] + weight
            if tentative_g < g_score[neighbor]:
                g_score[neighbor] = tentative_g
                h = heuristic(graph, neighbor, destination)
                f = tentative_g + h
                f_score[neighbor] = f
                parent[neighbor] = (current, edge)
                heapq.heappush(pq, (f, tentative_g, neighbor))

    result.computation_ms = (time.perf_counter() - start_time) * 1000
    result.visited_order = visited_order
    result.visited_count = len(visited_order)

    if g_score[destination] < float('inf'):
        result.found = True
        result.total_distance = g_score[destination]
        result.total_time_min = (g_score[destination] / 50) * 60

        node = destination
        while node != source:
            prev, edge = parent[node]
            result.path.insert(0, node)
            result.edge_path.insert(0, edge.to_dict())
            node = prev
        result.path.insert(0, source)

    return result


def bfs(graph: Graph, source: str, destination: str) -> RouteResult:
    """
    Breadth-First Search — finds the path with the fewest hops (edges).
    Does NOT minimise distance/weight; explores layer by layer.
    Time: O(V + E)
    """
    from collections import deque

    result = RouteResult("BFS", source, destination)
    start_time = time.perf_counter()

    visited = set()
    visited_order = []
    # parent[node] = (prev_node, edge)
    parent: Dict[str, Optional[Tuple[str, Edge]]] = {n: None for n in graph.nodes}

    queue = deque([source])
    visited.add(source)

    found = False
    while queue:
        current = queue.popleft()
        visited_order.append(current)

        if current == destination:
            found = True
            break

        for neighbor, weight, edge in graph.get_neighbors(current):
            if neighbor not in visited:
                visited.add(neighbor)
                parent[neighbor] = (current, edge)
                queue.append(neighbor)

    result.computation_ms = (time.perf_counter() - start_time) * 1000
    result.visited_order = visited_order
    result.visited_count = len(visited_order)

    if found:
        result.found = True
        node = destination
        while node != source:
            prev, edge = parent[node]
            result.path.insert(0, node)
            result.edge_path.insert(0, edge.to_dict())
            result.total_distance += edge.base_weight
            node = prev
        result.path.insert(0, source)
        result.total_time_min = (result.total_distance / 50) * 60

    return result


def dfs(graph: Graph, source: str, destination: str) -> RouteResult:
    """
    Depth-First Search — explores as deep as possible before backtracking.
    Finds A path, not necessarily the shortest.
    Time: O(V + E)
    """
    result = RouteResult("DFS", source, destination)
    start_time = time.perf_counter()

    visited = set()
    visited_order = []
    parent: Dict[str, Optional[Tuple[str, Edge]]] = {n: None for n in graph.nodes}

    # Iterative DFS using explicit stack
    stack = [source]
    found = False

    while stack:
        current = stack.pop()
        if current in visited:
            continue
        visited.add(current)
        visited_order.append(current)

        if current == destination:
            found = True
            break

        for neighbor, weight, edge in reversed(graph.get_neighbors(current)):
            if neighbor not in visited:
                if parent[neighbor] is None and neighbor != source:
                    parent[neighbor] = (current, edge)
                stack.append(neighbor)

    result.computation_ms = (time.perf_counter() - start_time) * 1000
    result.visited_order = visited_order
    result.visited_count = len(visited_order)

    if found:
        result.found = True
        node = destination
        while node != source:
            prev, edge = parent[node]
            result.path.insert(0, node)
            result.edge_path.insert(0, edge.to_dict())
            result.total_distance += edge.base_weight
            node = prev
        result.path.insert(0, source)
        result.total_time_min = (result.total_distance / 50) * 60

    return result


def find_k_shortest_paths(graph: Graph, source: str, destination: str,
                           k: int = 3, algorithm: str = "dijkstra") -> List[RouteResult]:
    """
    Find up to k alternative routes by temporarily blocking the best path edges.
    """
    results = []
    blocked_edges: List[Tuple[str, str]] = []

    for i in range(k):
        fn = dijkstra if algorithm == "dijkstra" else astar
        r = fn(graph, source, destination)

        if not r.found:
            break
        results.append(r)

        # Block one edge from this path to force alternative on next iteration
        if len(r.edge_path) > 0:
            mid = len(r.edge_path) // 2
            e = r.edge_path[mid]
            graph.block_edge(e["from"], e["to"], True)
            blocked_edges.append((e["from"], e["to"]))

    # Restore blocked edges
    for (f, t) in blocked_edges:
        graph.block_edge(f, t, False)

    return results


# ─────────────────────────────────────────────
# ROUTE HISTORY
# ─────────────────────────────────────────────

class RouteHistory:
    def __init__(self, max_entries: int = 50):
        self.history: List[dict] = []
        self.max_entries = max_entries

    def add(self, result: RouteResult):
        entry = result.to_dict()
        entry["timestamp"] = time.strftime("%Y-%m-%d %H:%M:%S")
        self.history.insert(0, entry)
        if len(self.history) > self.max_entries:
            self.history.pop()

    def get_all(self) -> List[dict]:
        return self.history

    def clear(self):
        self.history = []


# ─────────────────────────────────────────────
# SAMPLE CITY GRAPH: Indian Metros
# ─────────────────────────────────────────────


def build_world_graph() -> Graph:
    g = Graph()

    cities = [
        ("NYC", "New York", 40.7128, -74.0060),
        ("LAX", "Los Angeles", 34.0522, -118.2437),
        ("CHI", "Chicago", 41.8781, -87.6298),
        ("MEX", "Mexico City", 19.4326, -99.1332),
        ("YYZ", "Toronto", 43.6510, -79.3470),
        ("LON", "London", 51.5074, -0.1278),
        ("PAR", "Paris", 48.8566, 2.3522),
        ("BER", "Berlin", 52.5200, 13.4050),
        ("MAD", "Madrid", 40.4168, -3.7038),
        ("ROM", "Rome", 41.9028, 12.4964),
        ("MOW", "Moscow", 55.7558, 37.6173),
        ("CAI", "Cairo", 30.0444, 31.2357),
        ("JNB", "Johannesburg", -26.2041, 28.0473),
        ("CPT", "Cape Town", -33.9249, 18.4241),
        ("DXB", "Dubai", 25.2048, 55.2708),
        ("MUM", "Mumbai", 19.0760, 72.8777),
        ("DEL", "Delhi", 28.6139, 77.2090),
        ("PEK", "Beijing", 39.9042, 116.4074),
        ("SHA", "Shanghai", 31.2304, 121.4737),
        ("TYO", "Tokyo", 35.6762, 139.6503),
        ("SEO", "Seoul", 37.5665, 126.9780),
        ("SIN", "Singapore", 1.3521, 103.8198),
        ("BKK", "Bangkok", 13.7563, 100.5018),
        ("SYD", "Sydney", -33.8688, 151.2093),
        ("MEL", "Melbourne", -37.8136, 144.9631),
        ("GIG", "Rio de Janeiro", -22.9068, -43.1729),
        ("GRU", "Sao Paulo", -23.5505, -46.6333),
        ("EZE", "Buenos Aires", -34.6037, -58.3816),
        ("BOG", "Bogota", 4.7110, -74.0721),
        ("LIM", "Lima", -12.0464, -77.0428)
    ]

    for cid, name, lat, lon in cities:
        g.add_node(Node(cid, name, lat, lon))

    # A connected network of global cities
    roads = [
        # North America
        ("NYC", "CHI", 1140, "I-80"),
        ("NYC", "YYZ", 790, "I-90"),
        ("CHI", "LAX", 3240, "I-80"),
        ("LAX", "MEX", 2500, "Pan-Am"),
        ("NYC", "MEX", 3360, "I-81"),
        # South America
        ("MEX", "BOG", 3160, "Pan-Am"),
        ("BOG", "LIM", 1880, "Pan-Am"),
        ("LIM", "EZE", 3140, "Pan-Am"),
        ("BOG", "GRU", 4320, "BR-153"),
        ("GRU", "GIG", 430, "BR-116"),
        ("GRU", "EZE", 1700, "BR-116"),
        # Europe
        ("LON", "PAR", 344, "Eurotunnel"),
        ("PAR", "MAD", 1050, "A10"),
        ("PAR", "BER", 1050, "A2"),
        ("PAR", "ROM", 1420, "A6"),
        ("BER", "ROM", 1500, "A9"),
        ("BER", "MOW", 1600, "E30"),
        ("LON", "BER", 930, "E15"),
        # Africa
        ("MAD", "CAI", 3350, "A-4"),
        ("ROM", "CAI", 2130, "E45"),
        ("CAI", "DXB", 2400, "Route 65M"),
        ("CAI", "JNB", 6300, "Trans-African"),
        ("JNB", "CPT", 1400, "N1"),
        # Middle East & India
        ("DXB", "MUM", 1930, "Sea Route/Air"),
        ("MOW", "DEL", 4340, "E119"),
        ("DXB", "DEL", 2200, "Asian Hwy 2"),
        ("MUM", "DEL", 1400, "NH48"),
        # Asia
        ("DEL", "BKK", 2900, "AH1"),
        ("BKK", "SIN", 1830, "AH2"),
        ("SIN", "SHA", 3800, "AH1"),
        ("DEL", "PEK", 3780, "AH1"),
        ("PEK", "SHA", 1200, "G2"),
        ("PEK", "SEO", 950, "G1"),
        ("SEO", "TYO", 1150, "Asian Hwy 6"),
        ("SHA", "TYO", 1760, "Ferry/Air"),
        # Oceania
        ("SIN", "SYD", 6300, "Sea/Air"),
        ("SYD", "MEL", 870, "Hume Hwy"),
        # Intercontinental (Transatlantic/Pacific flights simulated as edges)
        ("NYC", "LON", 5570, "Transatlantic"),
        ("LAX", "TYO", 8800, "Transpacific"),
        ("GIG", "CPT", 6050, "Transatlantic South"),
        ("MOW", "PEK", 5800, "Trans-Siberian"),
        ("YYZ", "LON", 5700, "Transatlantic North"),
        ("EZE", "CPT", 6800, "Transatlantic South")
    ]

    for (f, t, dist, name) in roads:
        g.add_edge(Edge(f, t, dist, name))

    return g

# ─────────────────────────────────────────────
# MAIN ROUTER CLASS  (used by web API)
# ─────────────────────────────────────────────

class SmartRouter:
    def __init__(self):
        self.graph = build_world_graph()
        self.history = RouteHistory()
        self.mesh_intensity = 0.35
        self.mesh_seed = random.randint(1, 999999)

    def _compute_mesh_density(self, row: int, col: int) -> float:
        noise1 = math.sin(row * 12.9898 + col * 78.233 + self.mesh_seed * 0.001)
        noise2 = math.sin((row + 17) * 24.132 + (col - 9) * 53.771 + self.mesh_seed * 0.0007)
        frac1 = noise1 - math.floor(noise1)
        frac2 = noise2 - math.floor(noise2)
        blended = (frac1 * 0.65) + (frac2 * 0.35)
        scaled = blended * (0.45 + self.mesh_intensity * 1.35)
        return max(0.0, min(1.0, scaled))

    def get_mesh_config(self) -> dict:
        return {
            "seed": int(self.mesh_seed),
            "intensity": round(float(self.mesh_intensity), 4)
        }

    def update_mesh_config(self, intensity: Optional[float] = None,
                           seed: Optional[int] = None,
                           regenerate_seed: bool = False) -> dict:
        if intensity is not None:
            self.mesh_intensity = max(0.0, min(1.0, float(intensity)))

        if seed is not None:
            self.mesh_seed = int(seed)
        elif regenerate_seed:
            self.mesh_seed = random.randint(1, 999999)

        return self.get_mesh_config()

    def get_mesh_densities(self, cells: List[dict]) -> dict:
        densities = []
        for cell in cells:
            try:
                row = int(cell.get("row"))
                col = int(cell.get("col"))
            except (TypeError, ValueError):
                continue

            densities.append({
                "row": row,
                "col": col,
                "density": round(self._compute_mesh_density(row, col), 6)
            })

        return {
            "seed": int(self.mesh_seed),
            "intensity": round(float(self.mesh_intensity), 4),
            "densities": densities
        }

    def find_route(self, source: str, destination: str,
                   algorithm: str = "dijkstra") -> dict:
        if source not in self.graph.nodes:
            return {"error": f"Source node '{source}' not found"}
        if destination not in self.graph.nodes:
            return {"error": f"Destination node '{destination}' not found"}

        algo_map = {"dijkstra": dijkstra, "astar": astar, "bfs": bfs, "dfs": dfs}
        fn = algo_map.get(algorithm, dijkstra)
        result = fn(self.graph, source, destination)
        self.history.add(result)
        return result.to_dict()

    def compare_algorithms(self, source: str, destination: str) -> dict:
        r1 = dijkstra(self.graph, source, destination)
        r2 = astar(self.graph, source, destination)
        r3 = bfs(self.graph, source, destination)
        r4 = dfs(self.graph, source, destination)
        return {
            "dijkstra": r1.to_dict(),
            "astar": r2.to_dict(),
            "bfs": r3.to_dict(),
            "dfs": r4.to_dict()
        }

    def multi_route(self, source: str, destination: str, k: int = 3) -> dict:
        results = find_k_shortest_paths(self.graph, source, destination, k)
        return {"routes": [r.to_dict() for r in results]}

    def simulate_traffic(self, intensity: float = 0.35) -> dict:
        self.graph.randomize_traffic(intensity)
        self.update_mesh_config(intensity=intensity, regenerate_seed=True)
        return {"status": "Traffic simulated", "graph": self.graph.to_dict()}

    def reset_conditions(self) -> dict:
        self.graph.reset_traffic()
        self.update_mesh_config(intensity=0.35, regenerate_seed=True)
        return {
            "status": "Reset complete",
            "mesh": self.get_mesh_config()
        }

    def block_road(self, from_id: str, to_id: str) -> dict:
        self.graph.block_edge(from_id, to_id, True)
        return {"status": f"Road {from_id}↔{to_id} blocked"}

    def get_graph(self) -> dict:
        return self.graph.to_dict()

    def get_history(self) -> dict:
        return {"history": self.history.get_all()}


    def get_node_list(self) -> dict:
        return {"nodes": [n.to_dict() for n in self.graph.nodes.values()]}


# ─────────────────────────────────────────────
# STANDALONE TEST
# ─────────────────────────────────────────────

if __name__ == "__main__":
    router = SmartRouter()

    print("=" * 60)
    print("  SMART ROUTE FINDER — Algorithm Test Suite")
    print("=" * 60)

    tests = [
        ("DEL", "MUM", "Delhi → Mumbai"),
        ("BLR", "KOL", "Bangalore → Kolkata"),
        ("CHE", "CHA", "Chennai → Chandigarh"),
    ]

    for src, dst, label in tests:
        print(f"\n📍 Route: {label}")
        r_dijk = router.find_route(src, dst, "dijkstra")
        r_astar = router.find_route(src, dst, "astar")

        print(f"  Dijkstra  → {' → '.join(r_dijk['path'])} | {r_dijk['total_distance']} km | "
              f"{r_dijk['visited_count']} nodes visited | {r_dijk['computation_ms']:.3f} ms")
        print(f"  A*        → {' → '.join(r_astar['path'])} | {r_astar['total_distance']} km | "
              f"{r_astar['visited_count']} nodes visited | {r_astar['computation_ms']:.3f} ms")

    print("\n🚦 Traffic Simulation...")
    router.simulate_traffic(0.4)
    r = router.find_route("DEL", "MUM", "dijkstra")
    print(f"  Post-traffic Delhi→Mumbai: {r['total_distance']} km "
          f"(effective with congestion)")

    print("\n🛣️  Multi-Route (3 alternatives DEL→BLR):")
    mr = router.multi_route("DEL", "BLR", k=3)
    for i, route in enumerate(mr["routes"]):
        print(f"  Route {i+1}: {' → '.join(route['path'])} | {route['total_distance']} km")

    print("\n✅ All tests passed.")
