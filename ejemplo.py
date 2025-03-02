import warnings
warnings.filterwarnings("ignore", category=DeprecationWarning)

import networkx as nx
import matplotlib.pyplot as plt
from matplotlib.widgets import Slider
import numpy as np
from typing import Dict
import tkinter as tk
from tkinter import messagebox

class BGPMap:
    def __init__(self):
        self.G = nx.DiGraph()
        self.pos = None  # Posiciones iniciales de los nodos
        # Información adicional para cada dispositivo (puedes personalizarla)
        self.device_info = {
            "PE1": "Router PE1\nIP: 10.11.11.11\nAS: 65001\nModelo: Cisco ASR 9000",
            "PE2": "Router PE2\nIP: 10.33.33.33\nAS: 65002\nModelo: Juniper MX960",
            "CE1": "Router CE1\nIP: 192.168.1.1\nAS: 65003\nModelo: Dell PowerConnect",
            "PE3": "Router PE3\nIP: 10.22.22.22\nAS: 65004\nModelo: Nokia 7750 SR",
            "ISP": "Router ISP\nIP: 10.22.22.22\nAS: 1000\nModelo: Huawei NE40E"
        }
        self.dragging_node = None
        self.last_pos = None
        self.click_time = None  # Para rastrear el tiempo del clic

    def add_router(self, router_id: str, label: str = None, icon_path: str = None):
        """Añade un router al mapa con una etiqueta y ruta opcional a un icono"""
        self.G.add_node(router_id, label=label if label else router_id, icon=icon_path)

    def add_route(self, source: str, destination: str, attributes: Dict = None):
        """Añade una ruta BGP entre dos routers"""
        # Usamos un peso numérico (1) para el layout, y mantenemos las etiquetas CIDR separadas
        default_attrs = {'layout_weight': 1}  # Peso numérico para spring_layout
        if attributes:
            default_attrs.update(attributes)
        self.G.add_edge(source, destination, **default_attrs)

    def show_device_info(self, node):
        """Muestra información del dispositivo en una ventana emergente"""
        info = self.device_info.get(node, f"No hay información disponible para {node}")
        root = tk.Tk()
        root.withdraw()  # Ocultar la ventana principal de tkinter
        messagebox.showinfo("Información del Dispositivo", info)
        root.destroy()

    def draw_map(self, output_file: str = None):
        """Dibuja el mapa de rutas BGP con interactividad para mover y mostrar info de nodos"""
        # Usar spring_layout con el peso numérico 'layout_weight'
        self.pos = nx.spring_layout(self.G, weight='layout_weight', seed=42)  # Usar el peso numérico

        fig, ax = plt.subplots(figsize=(12, 8))
        plt.subplots_adjust(bottom=0.25)  # Ajustar para el slider

        # Dibujar nodos como iconos (simulando routers)
        for node, (x, y) in self.pos.items():
            label = self.G.nodes[node]['label']
            # Usar un círculo verde para simular routers como en tu imagen
            router = plt.Circle((x, y), 0.05, color='lightgreen', alpha=0.8)
            ax.add_patch(router)
            ax.text(x, y, label, fontsize=8, ha='center', va='center')

        # Dibujar aristas (rutas) con flechas
        nx.draw_networkx_edges(self.G, self.pos, ax=ax, edge_color='gray', 
                             arrows=True, arrowsize=20, width=1.5)

        # Añadir etiquetas de las rutas (interfaces CIDR como en tu imagen)
        edge_labels = {(u, v): d.get('weight', '') for u, v, d in self.G.edges(data=True)}
        nx.draw_networkx_edge_labels(self.G, self.pos, edge_labels=edge_labels, font_size=8)

        # Configurar el título y diseño
        plt.title("Mapa de Rutas BGP", pad=20)
        ax.set_xlim(-1.1, 1.1)
        ax.set_ylim(-1.1, 1.1)
        ax.axis('off')

        def on_press(event):
            """Detecta cuando se presiona un nodo (para mover o mostrar info)"""
            for node, (x, y) in self.pos.items():
                if np.sqrt((event.xdata - x)**2 + (event.ydata - y)**2) < 0.1:
                    self.dragging_node = node
                    self.last_pos = (event.xdata, event.ydata)
                    self.click_time = plt.get_current_fig_manager().canvas.manager.window.event_time()  # Tiempo del clic
                    # Esperamos un breve período para ver si es un clic o un arrastre
                    fig.canvas.start_event_loop(0.2)  # Espera 0.2 segundos
                    if self.dragging_node and not self.last_pos:  # Si no se movió, es un clic simple
                        self.show_device_info(node)
                    break

        def on_release(event):
            """Detecta cuando se suelta el nodo"""
            if self.dragging_node and self.last_pos:
                self.dragging_node = None
                self.last_pos = None
                self.click_time = None

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
                for node, (x, y) in self.pos.items():
                    label = self.G.nodes[node]['label']
                    router = plt.Circle((x, y), 0.05, color='lightgreen', alpha=0.8)
                    ax.add_patch(router)
                    ax.text(x, y, label, fontsize=8, ha='center', va='center')
                
                nx.draw_networkx_edges(self.G, self.pos, ax=ax, edge_color='gray', 
                                     arrows=True, arrowsize=20, width=1.5)
                nx.draw_networkx_edge_labels(self.G, self.pos, edge_labels=edge_labels, font_size=8)
                ax.set_xlim(-1.1, 1.1)
                ax.set_ylim(-1.1, 1.1)
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

    # Añadir routers (similares a tu imagen)
    bgp_map.add_router("PE1", "PE1 (10.11.11.11)")
    bgp_map.add_router("PE2", "PE2 (10.33.33.33)")
    bgp_map.add_router("CE1", "CE1")
    bgp_map.add_router("PE3", "PE3")
    bgp_map.add_router("ISP", "ISP (AS 1000)")

    # Añadir rutas con atributos (interfaces como en tu imagen)
    bgp_map.add_route("PE1", "PE2", {"weight": "10.5.5.0/24"})
    bgp_map.add_route("PE1", "CE1", {"weight": "10.1.1.0/24"})
    bgp_map.add_route("PE2", "PE3", {"weight": "10.2.2.0/24"})
    bgp_map.add_route("PE2", "ISP", {"weight": "10.4.4.0/24"})
    bgp_map.add_route("ISP", "PE1", {"weight": "10.3.3.0/24"})

    # Dibujar el mapa
    bgp_map.draw_map("bgp_map_interactive.png")

if __name__ == "__main__":
    main()