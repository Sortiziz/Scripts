/**
 * data.js
 *
 * This file validates and transforms the graph data.
 * The validateGraphData function checks that, for each edge,
 * the source and target IP addresses belong to the expected subnet.
 *
 * For example, if an edge has weight "192.168.18.0/30",
 * the source and target IPs should compute to the network "192.168.18.0".
 * If not, a warning is issued.
 */

export function validateGraphData(data) {
    data.edges.forEach(edge => {
      const weight = edge.data.weight;
      if (!weight) return; // No subnet defined; skip validation
  
      // Expected subnet and prefix, e.g. "192.168.18.0/30"
      const [expectedNetwork, prefixStr] = weight.split('/');
      const prefix = parseInt(prefixStr, 10);
      if (!expectedNetwork || isNaN(prefix)) return; // Invalid weight format
  
      // Expect the edge to contain sourceIP and targetIP properties.
      if (!edge.data.sourceIP || !edge.data.targetIP) return;
      
      // Remove any subnet mask annotation from the IP strings.
      const srcIP = edge.data.sourceIP.split('/')[0];
      const dstIP = edge.data.targetIP.split('/')[0];
  
      // Calculate the network addresses for source and target.
      const calculatedSrcNetwork = getNetworkAddress(srcIP, prefix);
      const calculatedDstNetwork = getNetworkAddress(dstIP, prefix);
  
      // Warn if either source or target does not belong to the expected network.
      if (calculatedSrcNetwork !== expectedNetwork || calculatedDstNetwork !== expectedNetwork) {
        console.warn(
          `IPs no están en la subred especificada para el enlace ${edge.data.source} -> ${edge.data.target}. ` +
          `Subred esperada: ${expectedNetwork}/${prefix}, IP fuente: ${edge.data.sourceIP} (red: ${calculatedSrcNetwork}), ` +
          `IP destino: ${edge.data.targetIP} (red: ${calculatedDstNetwork})`
        );
      }
    });
  }
  
  /**
   * Converts an IP address to a 32-bit integer.
   */
  function ipToInt(ip) {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0);
  }
  
  /**
   * Returns the netmask as an unsigned 32-bit integer given a prefix.
   */
  function getNetmask(prefix) {
    return prefix === 0 ? 0 : (~((1 << (32 - prefix)) - 1)) >>> 0;
  }
  
  /**
   * Returns the network address for a given IP and prefix.
   */
  function getNetworkAddress(ip, prefix) {
    const ipInt = ipToInt(ip);
    const mask = getNetmask(prefix);
    const networkInt = ipInt & mask;
    return [
      (networkInt >>> 24) & 0xFF,
      (networkInt >>> 16) & 0xFF,
      (networkInt >>> 8) & 0xFF,
      networkInt & 0xFF
    ].join('.');
  }