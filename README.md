# signalk-data-connector
Signal K server and client solutions for sending deltas over encrypted and compressed UDP channel.

Server configuration
- Server tick box selected
- UDP port
- Secure key (32 characters)

Client configuration
- Server tick box unselected
- UDP port (server UDP port)
- Secure key (32 characters)
- Destination UDP address (server address)
- Connectivity, address for connectivity test, e.g web server
- Connectivity, port for connectivity test, e.g. web server port
- Connectivity, testing interval time in minutes

# Data rate comparison betwwen Encrypted and Compressed UDP data transfer to WebSocket
![datarate](Doc/Datarate.png)
- ~30-40 deltas/sec, 120 paths 
