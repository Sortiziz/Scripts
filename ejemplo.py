import warnings
warnings.filterwarnings("ignore", category=DeprecationWarning)

import networkx as nx
import matplotlib.pyplot as plt
from matplotlib.widgets import Slider
import numpy as np
from typing import Dict
import tkinter as tk
from tkinter import messagebox
import time

class BGPMap:
    def __init__(self):
        self.G = nx.DiGraph()
        self.pos = None  # Posiciones iniciales de los nodos
        # Información adicional para cada dispositivo (puedes personalizarla)
        self.device_info = {
            "R1": "Router R1\nIP: 1.1.1.0/24\nAS: 100\nModelo: Cisco Router",
            "R2": "Router R2\nIP: 2.2.2.0/24\nAS: 200\nModelo: Juniper Router",
            "R3": "Router R3\nIP: 3.3.3.0/24\nAS: 200\nModelo: Nokia Router",
            "R4": "Router R4\nIP: 4.4.4.0/24\nAS: 300\nModelo: Huawei Router",
            "R5": "Router R5\nIP: 5.5.5.0/24\nAS: 400\nModelo: Dell Router"
        }
        self.dragging_node = None
        self.last_pos = None
        self.last_click_time = None  # Para rastrear el tiempo del último clic
        self.click_count = 0  # Contador de clics para detectar doble clic
        # Mapeo de routers a AS para los círculos
        self.as_groups = {
            100: ["R1"],
            200: ["R2", "R3"],
            300: ["R4"],
            400: ["R5"]
        }
        self.node_size = 0.1  # Tamaño inicial de los iconos de los routers

    def add_router(self, router_id: str, label: str = None, icon_path: str = None, as_number: int = None):
        """Añade un router al mapa con una etiqueta, ruta opcional a un icono y número de AS"""
        self.G.add_node(router_id, label=label if label else router_id, icon=icon_path, as_number=as_number)

    def add_route(self, source: str, destination: str, source_ip: str = None, dest_ip: str = None, attributes: Dict = None):
        """Añade una ruta BGP entre dos routers con las direcciones IP de las interfaces de origen y destino"""
        # Usamos un peso numérico (1) para el layout, y mantenemos las etiquetas CIDR separadas
        default_attrs = {'layout_weight': 1}  # Peso numérico para spring_layout
        if attributes:
            default_attrs.update(attributes)
        # Guardar las IPs específicas de origen y destino en los atributos de la arista
        if source_ip and dest_ip:
            default_attrs['source_ip'] = source_ip
            default_attrs['dest_ip'] = dest_ip
        self.G.add_edge(source, destination, **default_attrs)

    def show_device_info(self, node):
        """Muestra información del dispositivo en una ventana emergente"""
        info = self.device_info.get(node, f"No hay información disponible para {node}")
        root = tk.Tk()
        root.withdraw()  # Ocultar la ventana principal de tkinter
        messagebox.showinfo("Información del Dispositivo", info)
        root.destroy()

    def is_double_click(self, current_time):
        """Verifica si es un doble clic basado en el tiempo entre clics"""
        if self.last_click_time:
            time_diff = current_time - self.last_click_time
            if time_diff < 0.5:  # Umbral de 0.5 segundos para un doble clic
                self.click_count += 1
                if self.click_count >= 2:
                    self.click_count = 0
                    self.last_click_time = None
                    return True
            else:
                self.click_count = 1
        else:
            self.click_count = 1
        self.last_click_time = current_time
        return False

    def draw_map(self, output_file: str = None):
        """Dibuja el mapa de rutas BGP con interactividad, círculos de interfaces, AS y slider para tamaño"""
        # Usar spring_layout con el peso numérico 'layout_weight'
        self.pos = nx.spring_layout(self.G, weight='layout_weight', seed=42)  # Usar el peso numérico

        fig, ax = plt.subplots(figsize=(12, 8))
        plt.subplots_adjust(bottom=0.25)  # Ajustar para el slider

        # Dibujar círculos para los AS (ovalados)
        for as_number, routers in self.as_groups.items():
            as_pos = np.mean([self.pos[r] for r in routers], axis=0)
            as_circle = plt.Circle(as_pos, 0.3, fill=False, color='black', linestyle='--', alpha=0.5)
            ax.add_patch(as_circle)
            ax.text(as_pos[0], as_pos[1], f"AS {as_number}", fontsize=10, ha='center', va='center')

        # Dibujar nodos como iconos (simulando routers)
        for node, (x, y) in self.pos.items():
            label = self.G.nodes[node]['label']
            # Usar un círculo verde más grande para simular routers
            router = plt.Circle((x, y), self.node_size, color='lightgreen', alpha=0.8)
            ax.add_patch(router)
            # Posicionar la etiqueta del router encima del nodo para evitar solapamiento
            ax.text(x, y + self.node_size + 0.05, label, fontsize=8, ha='center', va='bottom')

        # Dibujar aristas (rutas) con flechas y círculos rojos en los extremos de las líneas
        for u, v, d in self.G.edges(data=True):
            source_pos = self.pos[u]
            target_pos = self.pos[v]
            # Dibujar la arista
            nx.draw_networkx_edges(self.G, self.pos, edgelist=[(u, v)], ax=ax, edge_color='gray', 
                                 arrows=True, arrowsize=20, width=1.5)
            
            # Extraer el último octeto de las direcciones IP de origen y destino
            source_ip = d.get('source_ip', '')
            dest_ip = d.get('dest_ip', '')
            if source_ip and '/' in source_ip:
                source_last_octet = source_ip.split('/')[0].split('.')[-1]  # Último octeto del origen
            else:
                source_last_octet = 'N/A'
            if dest_ip and '/' in dest_ip:
                dest_last_octet = dest_ip.split('/')[0].split('.')[-1]  # Último octeto del destino
            else:
                dest_last_octet = 'N/A'
            
            # Calcular las posiciones exactas en los extremos de la arista (a lo largo de la línea)
            edge = np.array([target_pos[0] - source_pos[0], target_pos[1] - source_pos[1]])
            edge_length = np.sqrt(edge[0]**2 + edge[1]**2)
            if edge_length > 0:  # Evitar división por cero
                edge_normalized = edge / edge_length
                # Posicionar los círculos rojos a una distancia fija desde el centro del nodo hacia el extremo
                interface_radius = 0.05
                source_interface_pos = (
                    source_pos[0] + edge_normalized[0] * (self.node_size + interface_radius),
                    source_pos[1] + edge_normalized[1] * (self.node_size + interface_radius)
                )
                target_interface_pos = (
                    target_pos[0] - edge_normalized[0] * (self.node_size + interface_radius),
                    target_pos[1] - edge_normalized[1] * (self.node_size + interface_radius)
                )
            else:
                source_interface_pos = source_pos
                target_interface_pos = target_pos
            
            # Dibujar círculo rojo en el origen (source) con su último octeto
            source_circle = plt.Circle(source_interface_pos, 0.02, color='red', alpha=0.8)
            ax.add_patch(source_circle)
            # Posicionar la etiqueta de la interfaz más cerca del círculo rojo y más abajo para evitar solapamiento
            ax.text(source_interface_pos[0], source_interface_pos[1] - 0.03, source_last_octet, fontsize=8, ha='center', va='top')
            
            # Dibujar círculo rojo en el destino (target) con su último octeto
            target_circle = plt.Circle(target_interface_pos, 0.02, color='red', alpha=0.8)
            ax.add_patch(target_circle)
            ax.text(target_interface_pos[0], target_interface_pos[1] - 0.03, dest_last_octet, fontsize=8, ha='center', va='top')

        # Añadir etiquetas de las rutas (interfaces CIDR como en tu imagen)
        self.edge_labels = {(u, v): d.get('weight', '') for u, v, d in self.G.edges(data=True)}
        nx.draw_networkx_edge_labels(self.G, self.pos, edge_labels=self.edge_labels, font_size=8)

        # Configurar el título y diseño
        plt.title("Mapa de Rutas BGP", pad=20)
        ax.set_xlim(-1.5, 1.5)  # Ajustar límites para que quepan los círculos de AS
        ax.set_ylim(-1.5, 1.5)
        ax.axis('off')

        # Añadir slider para ajustar el tamaño de los nodos
        node_size_ax = plt.axes([0.25, 0.1, 0.65, 0.03])
        node_size_slider = Slider(node_size_ax, 'Tamaño Nodos', 0.05, 0.2, valinit=self.node_size)

        def update(val):
            self.node_size = val
            ax.clear()
            # Redibujar todo con el nuevo tamaño
            # Dibujar círculos para los AS
            for as_number, routers in self.as_groups.items():
                as_pos = np.mean([self.pos[r] for r in routers], axis=0)
                as_circle = plt.Circle(as_pos, 0.3, fill=False, color='black', linestyle='--', alpha=0.5)
                ax.add_patch(as_circle)
                ax.text(as_pos[0], as_pos[1], f"AS {as_number}", fontsize=10, ha='center', va='center')
            
            # Dibujar nodos
            for node, (x, y) in self.pos.items():
                label = self.G.nodes[node]['label']
                router = plt.Circle((x, y), self.node_size, color='lightgreen', alpha=0.8)
                ax.add_patch(router)
                ax.text(x, y + self.node_size + 0.05, label, fontsize=8, ha='center', va='bottom')
            
            # Dibujar aristas y círculos rojos en los extremos
            for u, v, d in self.G.edges(data=True):
                source_pos = self.pos[u]
                target_pos = self.pos[v]
                nx.draw_networkx_edges(self.G, self.pos, edgelist=[(u, v)], ax=ax, edge_color='gray', 
                                     arrows=True, arrowsize=20, width=1.5)
                source_ip = d.get('source_ip', '')
                dest_ip = d.get('dest_ip', '')
                if source_ip and '/' in source_ip:
                    source_last_octet = source_ip.split('/')[0].split('.')[-1]  # Último octeto del origen
                else:
                    source_last_octet = 'N/A'
                if dest_ip and '/' in dest_ip:
                    dest_last_octet = dest_ip.split('/')[0].split('.')[-1]  # Último octeto del destino
                else:
                    dest_last_octet = 'N/A'
                
                edge = np.array([target_pos[0] - source_pos[0], target_pos[1] - source_pos[1]])
                edge_length = np.sqrt(edge[0]**2 + edge[1]**2)
                if edge_length > 0:
                    edge_normalized = edge / edge_length
                    interface_radius = 0.05
                    source_interface_pos = (
                        source_pos[0] + edge_normalized[0] * (self.node_size + interface_radius),
                        source_pos[1] + edge_normalized[1] * (self.node_size + interface_radius)
                    )
                    target_interface_pos = (
                        target_pos[0] - edge_normalized[0] * (self.node_size + interface_radius),
                        target_pos[1] - edge_normalized[1] * (self.node_size + interface_radius)
                    )
                else:
                    source_interface_pos = source_pos
                    target_interface_pos = target_pos
                
                source_circle = plt.Circle(source_interface_pos, 0.02, color='red', alpha=0.8)
                ax.add_patch(source_circle)
                ax.text(source_interface_pos[0], source_interface_pos[1] - 0.03, source_last_octet, fontsize=8, ha='center', va='top')
                
                target_circle = plt.Circle(target_interface_pos, 0.02, color='red', alpha=0.8)
                ax.add_patch(target_circle)
                ax.text(target_interface_pos[0], target_interface_pos[1] - 0.03, dest_last_octet, fontsize=8, ha='center', va='top')

            # Añadir etiquetas de las rutas (asegurándonos de usar self.edge_labels)
            nx.draw_networkx_edge_labels(self.G, self.pos, edge_labels=self.edge_labels, font_size=8)
            
            ax.set_xlim(-1.5, 1.5)
            ax.set_ylim(-1.5, 1.5)
            ax.axis('off')
            fig.canvas.draw()

        node_size_slider.on_changed(update)

        def on_press(event):
            """Detecta cuando se presiona un nodo (para mover o mostrar info)"""
            for node, (x, y) in self.pos.items():
                if np.sqrt((event.xdata - x)**2 + (event.ydata - y)**2) < self.node_size:
                    if event.button == 1:  # Botón izquierdo del ratón
                        current_time = time.time()  # Usar time.time() en lugar de event_time
                        if self.is_double_click(current_time):
                            self.show_device_info(node)
                        else:
                            self.dragging_node = node
                            self.last_pos = (event.xdata, event.ydata)
                    break

        def on_release(event):
            """Detecta cuando se suelta el nodo"""
            self.dragging_node = None
            self.last_pos = None

        def on_motion(event):
            """Actualiza la posición del nodo mientras se arrastra"""
            if self.dragging_node and event.xdata and event.ydata and self.last_pos:
                dx = event.xdata - self.last_pos[0]
                dy = event.ydata - self.last_pos[1]
                self.pos[self.dragging_node][0] += dx
                self.pos[self.dragging_node][1] += dy
                self.last_pos = (event.xdata, event.ydata)
                
                # Redibujar todo
                ax.clear()
                # Dibujar círculos para los AS
                for as_number, routers in self.as_groups.items():
                    as_pos = np.mean([self.pos[r] for r in routers], axis=0)
                    as_circle = plt.Circle(as_pos, 0.3, fill=False, color='black', linestyle='--', alpha=0.5)
                    ax.add_patch(as_circle)
                    ax.text(as_pos[0], as_pos[1], f"AS {as_number}", fontsize=10, ha='center', va='center')
                
                # Dibujar nodos
                for node, (x, y) in self.pos.items():
                    label = self.G.nodes[node]['label']
                    router = plt.Circle((x, y), self.node_size, color='lightgreen', alpha=0.8)
                    ax.add_patch(router)
                    ax.text(x, y + self.node_size + 0.05, label, fontsize=8, ha='center', va='bottom')
                
                # Dibujar aristas y círculos rojos en los extremos
                for u, v, d in self.G.edges(data=True):
                    source_pos = self.pos[u]
                    target_pos = self.pos[v]
                    nx.draw_networkx_edges(self.G, self.pos, edgelist=[(u, v)], ax=ax, edge_color='gray', 
                                         arrows=True, arrowsize=20, width=1.5)
                    source_ip = d.get('source_ip', '')
                    dest_ip = d.get('dest_ip', '')
                    if source_ip and '/' in source_ip:
                        source_last_octet = source_ip.split('/')[0].split('.')[-1]  # Último octeto del origen
                    else:
                        source_last_octet = 'N/A'
                    if dest_ip and '/' in dest_ip:
                        dest_last_octet = dest_ip.split('/')[0].split('.')[-1]  # Último octeto del destino
                    else:
                        dest_last_octet = 'N/A'
                    
                    edge = np.array([target_pos[0] - source_pos[0], target_pos[1] - source_pos[1]])
                    edge_length = np.sqrt(edge[0]**2 + edge[1]**2)
                    if edge_length > 0:
                        edge_normalized = edge / edge_length
                        interface_radius = 0.05
                        source_interface_pos = (
                            source_pos[0] + edge_normalized[0] * (self.node_size + interface_radius),
                            source_pos[1] + edge_normalized[1] * (self.node_size + interface_radius)
                        )
                        target_interface_pos = (
                            target_pos[0] - edge_normalized[0] * (self.node_size + interface_radius),
                            target_pos[1] - edge_normalized[1] * (self.node_size + interface_radius)
                        )
                    else:
                        source_interface_pos = source_pos
                        target_interface_pos = target_pos
                    
                    source_circle = plt.Circle(source_interface_pos, 0.02, color='red', alpha=0.8)
                    ax.add_patch(source_circle)
                    ax.text(source_interface_pos[0], source_interface_pos[1] - 0.03, source_last_octet, fontsize=8, ha='center', va='top')
                    
                    target_circle = plt.Circle(target_interface_pos, 0.02, color='red', alpha=0.8)
                    ax.add_patch(target_circle)
                    ax.text(target_interface_pos[0], target_interface_pos[1] - 0.03, dest_last_octet, fontsize=8, ha='center', va='top')

                # Añadir etiquetas de las rutas (asegurándonos de usar self.edge_labels y recalcular posiciones)
                self.edge_labels = {(u, v): d.get('weight', '') for u, v, d in self.G.edges(data=True)}
                nx.draw_networkx_edge_labels(self.G, self.pos, edge_labels=self.edge_labels, font_size=8)
                
                ax.set_xlim(-1.5, 1.5)
                ax.set_ylim(-1.5, 1.5)
                ax.axis('off')
                fig.canvas.draw()

        # Conectar eventos
        fig.canvas.mpl_connect('button_press_event', on_press)
        fig.canvas.mpl_connect('button_release_event', on_release)
        fig.canvas.mpl_connect('motion_notify_event', on_motion)

        # Mostrar la figura
        plt.show()

        if output_file:
            plt.savefig(output_file)
        plt.close()

def main():
    # Crear instancia del mapa BGP
    bgp_map = BGPMap()

    # Añadir routers con sus respectivos AS
    bgp_map.add_router("R1", "R1 (1.1.1.0/24)", as_number=100)
    bgp_map.add_router("R2", "R2 (2.2.2.0/24)", as_number=200)
    bgp_map.add_router("R3", "R3 (3.3.3.0/24)", as_number=200)
    bgp_map.add_router("R4", "R4 (4.4.4.0/24)", as_number=300)
    bgp_map.add_router("R5", "R5 (5.5.5.0/24)", as_number=400)

    # Añadir rutas con atributos (interfaces como en tu imagen, especificando IPs de origen y destino)
    bgp_map.add_route("R1", "R2", source_ip="10.12.12.1/24", dest_ip="10.12.12.2/24", attributes={"weight": "10.12.12.0/24"})
    bgp_map.add_route("R2", "R1", source_ip="10.12.12.2/24", dest_ip="10.12.12.1/24", attributes={"weight": "10.12.12.0/24"})
    bgp_map.add_route("R2", "R3", source_ip="10.23.23.2/24", dest_ip="10.23.23.3/24", attributes={"weight": "10.23.23.0/24"})
    bgp_map.add_route("R3", "R2", source_ip="10.23.23.3/24", dest_ip="10.23.23.2/24", attributes={"weight": "10.23.23.0/24"})
    bgp_map.add_route("R2", "R4", source_ip="10.24.24.2/24", dest_ip="10.24.24.4/24", attributes={"weight": "10.24.24.0/24"})
    bgp_map.add_route("R4", "R2", source_ip="10.24.24.4/24", dest_ip="10.24.24.2/24", attributes={"weight": "10.24.24.0/24"})
    bgp_map.add_route("R3", "R5", source_ip="10.35.35.3/24", dest_ip="10.35.35.5/24", attributes={"weight": "10.35.35.0/24"})
    bgp_map.add_route("R5", "R3", source_ip="10.35.35.5/24", dest_ip="10.35.35.3/24", attributes={"weight": "10.35.35.0/24"})

    # Dibujar el mapa
    bgp_map.draw_map("bgp_map_interactive.png")

if __name__ == "__main__":
    main()