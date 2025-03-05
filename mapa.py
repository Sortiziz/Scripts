import json
import networkx as nx
import matplotlib.pyplot as plt
from matplotlib.patches import Ellipse, Rectangle

# Cargar datos desde bgp_graph.json
with open('bgp_graph.json', 'r') as file:
    data = json.load(file)

# Validación básica de datos (similar a validateGraphData en tu código)
def validate_graph_data(data):
    if not data or not isinstance(data.get('nodes'), list) or not isinstance(data.get('edges'), list):
        raise ValueError("Formato de bgp_graph.json inválido: nodos o enlaces faltantes")
    node_ids = {node['data']['id'] for node in data['nodes']}
    for edge in data['edges']:
        source, target = edge['data']['source'], edge['data']['target']
        if source not in node_ids or target not in node_ids:
            raise ValueError(f"Enlace inválido: {source} o {target} no existen")
        source_node = next((n for n in data['nodes'] if n['data']['id'] == source), None)
        target_node = next((n for n in data['nodes'] if n['data']['id'] == target), None)
        if source_node and 'interfaces' in source_node['data'] and edge['data']['sourceInterface'] not in source_node['data']['interfaces']:
            raise ValueError(f"Interfaz {edge['data']['sourceInterface']} no encontrada en {source}")
        if target_node and 'interfaces' in target_node['data'] and edge['data']['targetInterface'] not in target_node['data']['interfaces']:
            raise ValueError(f"Interfaz {edge['data']['targetInterface']} no encontrada en {target}")
    return True

# Generar nodos de interfaz (similar a generateInterfaceNodes)
def generate_interface_nodes(nodes):
    interface_nodes = []
    for node in nodes:
        if 'interfaces' in node['data']:
            router_id = node['data']['id']
            parent = node['data'].get('parent')
            for intf_name, ip in node['data']['interfaces'].items():
                intf_id = f"{router_id}_{intf_name}"
                interface_nodes.append({
                    'id': intf_id,
                    'label': intf_name,
                    'type': 'interface',
                    'router': router_id,
                    'ip': ip,
                    'parent': parent
                })
    return interface_nodes

# Transformar enlaces (similar a transformEdges)
def transform_edges(edges, interface_nodes):
    transformed_edges = []
    interface_ids = {node['id'] for node in interface_nodes}
    for edge in edges:
        source = edge['data']['source']
        target = edge['data']['target']
        source_intf = f"{source}_{edge['data']['sourceInterface']}"
        target_intf = f"{target}_{edge['data']['targetInterface']}"
        weight = edge['data']['weight']
        if source_intf in interface_ids and target_intf in interface_ids:
            transformed_edges.append((source_intf, target_intf, {'weight': weight, 'color': '#000'}))
    return transformed_edges

# Añadir enlaces jerárquicos (similar a addHierarchicalEdges)
def add_hierarchical_edges(nodes, edges):
    hierarchical_edges = []
    for node in nodes:
        if 'parent' in node['data'] and node['data'].get('type') != 'interface':
            hierarchical_edges.append((node['data']['parent'], node['data']['id'], {'type': 'hierarchical', 'invisible': True}))
        if node['data'].get('type') == 'interface' and 'router' in node['data']:
            hierarchical_edges.append((node['data']['router'], node['data']['id'], {'type': 'router-interface', 'invisible': False}))
    return edges + hierarchical_edges

# Cargar datos guardados (simulación básica, sin localStorage)
def load_data(nodes, interface_nodes):
    all_nodes = nodes + interface_nodes
    for node in all_nodes:
        node['position'] = {'x': None, 'y': None}  # Posiciones aleatorias o manuales en el layout
        node['color'] = node.get('color', '#FFA500' if node['data'].get('type') == 'interface' else 
                                '#00FF00' if 'parent' in node['data'] else '#ddd')
    return all_nodes

# Crear y dibujar el grafo
def draw_bgp_topology():
    # Validar datos
    validate_graph_data(data)
    
    # Generar nodos e interfaces
    interface_nodes = generate_interface_nodes(data['nodes'])
    all_nodes = load_data(data['nodes'], interface_nodes)
    
    # Transformar y añadir enlaces
    transformed_edges = transform_edges(data['edges'], interface_nodes)
    all_edges = add_hierarchical_edges(all_nodes, transformed_edges)
    
    # Crear grafo dirigido con NetworkX
    G = nx.DiGraph()
    
    # Añadir nodos con atributos (tipo, color, posición)
    for node in all_nodes:
        node_id = node['id']
        node_type = node['data'].get('type', 'router' if 'parent' in node['data'] else 'as')
        G.add_node(node_id, type=node_type, color=node['color'], label=node['data']['label'])
    
    # Añadir enlaces
    for source, target, attrs in all_edges:
        G.add_edge(source, target, **attrs)
    
    # Posicionar nodos manualmente (simulando jerarquía)
    pos = {}
    for node in all_nodes:
        if node['data'].get('type') == 'interface':
            router_pos = pos.get(node['data']['router'], (0, 0))
            pos[node['id']] = (router_pos[0] + 20 * (len(pos) % 2 - 0.5), router_pos[1] + 20 * (len(pos) // 2 - 0.5))
        elif 'parent' in node['data']:
            as_pos = pos.get(node['data']['parent'], (0, 0))
            pos[node['id']] = (as_pos[0] + 100 * (len(pos) % 2 - 0.5), as_pos[1] + 100 * (len(pos) // 2 - 0.5))
        else:
            pos[node['id']] = (200 * (len(pos) % 3 - 1), 200 * (len(pos) // 3 - 1))
    
    # Dibujar grafo con Matplotlib
    plt.figure(figsize=(12, 8))
    
    # Nodos: AS (rectángulos grises), routers (elipses verdes), interfaces (elipses naranjas)
    for node, (x, y) in pos.items():
        node_data = G.nodes[node]
        if node_data['type'] == 'as':
            rect = Rectangle((x - 30, y - 30), 60, 60, facecolor='#ddd', edgecolor='black', linewidth=2, linestyle='dashed')
            plt.gca().add_patch(rect)
            plt.text(x, y, node_data['label'], ha='center', va='center', fontsize=12)
        elif node_data['type'] == 'router':
            ellipse = Ellipse((x, y), 60, 60, facecolor='#00FF00', edgecolor='black', linewidth=2)
            plt.gca().add_patch(ellipse)
            plt.text(x, y, node_data['label'], ha='center', va='center', fontsize=12)
        elif node_data['type'] == 'interface':
            ellipse = Ellipse((x, y), 40, 40, facecolor='#FFA500', edgecolor='black', linewidth=1)
            plt.gca().add_patch(ellipse)
            plt.text(x, y, node_data['label'], ha='center', va='center', fontsize=10)
    
    # Enlaces (líneas negras con etiquetas de subred y hosts)
    for source, target, attrs in G.edges(data=True):
        if attrs.get('type') not in ['hierarchical', 'router-interface'] or not attrs.get('invisible', False):
            source_pos = pos[source]
            target_pos = pos[target]
            plt.plot([source_pos[0], target_pos[0]], [source_pos[1], target_pos[1]], 'k-', lw=3)
            if 'weight' in attrs:
                mid_x = (source_pos[0] + target_pos[0]) / 2
                mid_y = (source_pos[1] + target_pos[1]) / 2
                source_ip = next(n for n in all_nodes if n['id'] == source)['data']['ip']
                target_ip = next(n for n in all_nodes if n['id'] == target)['data']['ip']
                label = f"{attrs['weight']} (.{getHostNumber(source_ip)}, .{getHostNumber(target_ip)})"
                plt.text(mid_x, mid_y, label, ha='center', va='center', fontsize=10, bbox=dict(facecolor='white', alpha=0.9, edgecolor='none', pad=3))
    
    # Ajustar límites y mostrar
    plt.axis('equal')  # Mantener proporciones
    plt.title("Topología de Red BGP")
    plt.gca().set_aspect('equal', adjustable='box')
    plt.axis('off')  # Ocultar ejes
    plt.show()

if __name__ == "__main__":
    try:
        draw_bgp_topology()
    except Exception as e:
        print(f"Error: {e}")
