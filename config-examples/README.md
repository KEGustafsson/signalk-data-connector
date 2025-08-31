# Configuration Examples

This directory contains example configuration files. Copy these to the `config/` directory and modify as needed.

## Delta Timer Examples

### High Frequency (Real-time updates)
```json
{
  "deltaTimer": 100
}
```
Use for: Real-time displays, fast-changing data, low-latency applications

### Standard Frequency (Balanced)
```json
{
  "deltaTimer": 1000
}
```
Use for: Most applications, good balance of performance and bandwidth

### Low Frequency (Bandwidth optimized)
```json
{
  "deltaTimer": 5000
}
```
Use for: Slow connections, battery-powered devices, data logging

## Subscription Examples

### All Data (Complete vessel data)
```json
{
  "context": "*",
  "subscribe": [
    {
      "path": "*"
    }
  ]
}
```

### Navigation Only
```json
{
  "context": "vessels.self",
  "subscribe": [
    {
      "path": "navigation.position"
    },
    {
      "path": "navigation.speedOverGround"
    },
    {
      "path": "navigation.courseOverGround"
    },
    {
      "path": "navigation.headingTrue"
    }
  ]
}
```

### Engine Monitoring
```json
{
  "context": "vessels.self",
  "subscribe": [
    {
      "path": "propulsion.*.temperature"
    },
    {
      "path": "propulsion.*.oilPressure"
    },
    {
      "path": "propulsion.*.revolutions"
    },
    {
      "path": "propulsion.*.fuel.rate"
    }
  ]
}
```

### Environmental Data
```json
{
  "context": "vessels.self",
  "subscribe": [
    {
      "path": "environment.wind.*"
    },
    {
      "path": "environment.water.temperature"
    },
    {
      "path": "environment.depth.belowKeel"
    },
    {
      "path": "environment.current"
    }
  ]
}
```

### AIS Targets (Other vessels)
```json
{
  "context": "*",
  "subscribe": [
    {
      "path": "vessels.*.navigation.position"
    },
    {
      "path": "vessels.*.navigation.speedOverGround"
    },
    {
      "path": "vessels.*.navigation.courseOverGround"
    },
    {
      "path": "vessels.*.name"
    },
    {
      "path": "vessels.*.mmsi"
    }
  ]
}
```

### Custom Mixed Configuration
```json
{
  "context": "*",
  "subscribe": [
    {
      "path": "vessels.self.navigation.*"
    },
    {
      "path": "vessels.self.propulsion.main.temperature"
    },
    {
      "path": "vessels.self.environment.wind.*"
    },
    {
      "path": "vessels.*.navigation.position"
    }
  ]
}
```

## Performance Guidelines

### Path Wildcards
- `*` matches any single level
- Use specific paths when possible for better performance
- Wildcards can generate large amounts of data

### Context Selection
- `vessels.self` for own vessel data only
- `vessels.*` for all vessels
- `*` for all contexts (vessels, aircraft, etc.)

### Bandwidth Optimization
1. Use longer delta timers for better compression
2. Subscribe only to needed data paths
3. Consider data update frequency when setting timer
4. Monitor network usage and adjust accordingly

## Security Considerations

- Never commit actual configuration files with sensitive data
- Use different encryption keys for different installations
- Consider firewall rules for UDP ports
- Monitor for unauthorized access attempts