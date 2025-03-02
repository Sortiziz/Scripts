import json
from typing import Dict

class BGPMap:
    def __init__(self):
        self.nodes = []
        self.edges = []
        self.device_info = {
            "R1": "Router R1\nIP: 1.1.1.0/24\nAS: 100\nModelo: Cisco Router",
            "R2": "Router R2\nIP: 2.2.2.0/24\nAS: 200\nModelo: Juniper Router",
            "R3": "Router R3\nIP: 3.3.3.0/24\nAS: 200\nModelo: Nokia Router",
            "R4": "Router R4\nIP: 4.4.4.0/24\nAS: 300\nModelo: Huawei Router",
            "R5": "Router R5\nIP: 5.5.5.0/24\nAS: 400\nModelo: Dell Router"
        }
        self.as_groups = {
            100: ["R1"],
            200: ["R2", "R3"],
            300: ["R4"],
            400: ["R5"]
        }

    def add_router(self, router_id: str, label: str, as_number: int, x: float = None, y: float = None):
        self.nodes.append({
            "data": {"id": router_id, "label": label, "as": as_number},
            "position": {"x": x, "y": y} if x is not None and y is not None else None
        })

    def add_route(self, source: str, destination: str, source_ip: str, dest_ip: str, weight: str):
        self.edges.append({
            "data": {
                "id": f"{source}-{destination}",
                "source": source,
                "target": destination,
                "weight": weight,
                "source_ip": source_ip,
                "dest_ip": dest_ip
            }
        })

    def save_to_json(self, filename: str):
        graph_data = {"nodes": self.nodes, "edges": self.edges}
        with open(filename, 'w') as f:
            json.dump(graph_data, f, indent=4)

def main():
    bgp_map = BGPMap()

    # Añadir routers con posiciones iniciales más espaciadas para un layout consistente
    bgp_map.add_router("R1", "R1 (1.1.1.0/24)", 100, x=200, y=200)
    bgp_map.add_router("R2", "R2 (2.2.2.0/24)", 200, x=400, y=300)
    bgp_map.add_router("R3", "R3 (3.3.3.0/24)", 200, x=400, y=500)
    bgp_map.add_router("R4", "R4 (4.4.4.0/24)", 300, x=600, y=300)
    bgp_map.add_router("R5", "R5 (5.5.5.0/24)", 400, x=600, y=500)

    # Añadir rutas con atributos (interfaces como en tu imagen, especificando IPs de origen y destino)
    bgp_map.add_route("R1", "R2", "10.12.12.1/24", "10.12.12.2/24", "10.12.12.0/24")
    bgp_map.add_route("R2", "R1", "10.12.12.2/24", "10.12.12.1/24", "10.12.12.0/24")
    bgp_map.add_route("R2", "R3", "10.23.23.2/24", "10.23.23.3/24", "10.23.23.0/24")
    bgp_map.add_route("R3", "R2", "10.23.23.3/24", "10.23.23.2/24", "10.23.23.0/24")
    bgp_map.add_route("R2", "R4", "10.24.24.2/24", "10.24.24.4/24", "10.24.24.0/24")
    bgp_map.add_route("R4", "R2", "10.24.24.4/24", "10.24.24.2/24", "10.24.24.0/24")
    bgp_map.add_route("R3", "R5", "10.35.35.3/24", "10.35.35.5/24", "10.35.35.0/24")
    bgp_map.add_route("R5", "R3", "10.35.35.5/24", "10.35.35.3/24", "10.35.35.0/24")

    # Guardar el grafo en un archivo JSON
    bgp_map.save_to_json("bgp_graph.json")

if __name__ == "__main__":
    main()