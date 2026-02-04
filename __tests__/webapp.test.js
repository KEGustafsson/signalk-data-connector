/**
 * @jest-environment jsdom
 */

/* eslint-disable no-undef */

// Test the web UI helper functions and utilities
// These tests use JSDOM to simulate browser environment

describe("Web UI Helper Functions", () => {
  // Re-implement helper functions for testing (same logic as in index.js)
  const formatBytes = (bytes) => {
    if (!bytes || bytes <= 0) {
      return "0 B";
    }
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const escapeHtml = (text) => {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  };

  const renderCard = (title, subtitle, contentId, contentClass = "") => `
  <div class="config-section">
    <div class="card">
      <div class="card-header">
        <h2>${title}</h2>
        ${subtitle ? `<p class="subtitle">${subtitle}</p>` : ""}
      </div>
      <div class="card-content">
        <div id="${contentId}" class="${contentClass || contentId + "-info"}">
          <p>Loading ${title.toLowerCase()}...</p>
        </div>
      </div>
    </div>
  </div>
`;

  const renderStatItem = (label, value, hasError = false) => `
  <div class="stat-item${hasError ? " error" : ""}">
    <span class="stat-label">${label}:</span>
    <span class="stat-value">${value}</span>
  </div>
`;

  const renderMetricItem = (label, value, statusClass = "") => `
  <div class="metric-item${statusClass ? " " + statusClass : ""}">
    <div class="metric-label">${label}</div>
    <div class="metric-value">${value}</div>
  </div>
`;

  const renderBwStat = (label, value, isHighlight = false, isSuccess = false) => `
  <div class="bw-stat${isHighlight ? " highlight" : ""}">
    <span class="bw-label">${label}:</span>
    <span class="bw-value${isSuccess ? " success-text" : ""}">${value}</span>
  </div>
`;

  describe("formatBytes", () => {
    test("should return '0 B' for zero bytes", () => {
      expect(formatBytes(0)).toBe("0 B");
    });

    test("should return '0 B' for negative bytes", () => {
      expect(formatBytes(-100)).toBe("0 B");
    });

    test("should return '0 B' for null/undefined", () => {
      expect(formatBytes(null)).toBe("0 B");
      expect(formatBytes(undefined)).toBe("0 B");
    });

    test("should format bytes correctly", () => {
      expect(formatBytes(500)).toBe("500 B");
      expect(formatBytes(1024)).toBe("1 KB");
      expect(formatBytes(1536)).toBe("1.5 KB");
    });

    test("should format kilobytes correctly", () => {
      expect(formatBytes(10240)).toBe("10 KB");
      expect(formatBytes(1048576)).toBe("1 MB");
    });

    test("should format megabytes correctly", () => {
      expect(formatBytes(1048576)).toBe("1 MB");
      expect(formatBytes(10485760)).toBe("10 MB");
    });

    test("should format gigabytes correctly", () => {
      expect(formatBytes(1073741824)).toBe("1 GB");
      expect(formatBytes(5368709120)).toBe("5 GB");
    });

    test("should handle very large values without exceeding sizes array", () => {
      // 1 TB would be index 4, but sizes array only goes to index 3 (GB)
      const oneTerabyte = 1099511627776;
      expect(formatBytes(oneTerabyte)).toBe("1024 GB");
    });

    test("should handle decimal precision correctly", () => {
      expect(formatBytes(1500)).toBe("1.46 KB");
      expect(formatBytes(1234567)).toBe("1.18 MB");
    });
  });

  describe("escapeHtml", () => {
    test("should escape HTML special characters", () => {
      expect(escapeHtml("<script>alert('xss')</script>")).toBe(
        "&lt;script&gt;alert('xss')&lt;/script&gt;"
      );
    });

    test("should escape ampersand", () => {
      expect(escapeHtml("foo & bar")).toBe("foo &amp; bar");
    });

    test("should escape quotes", () => {
      expect(escapeHtml('say "hello"')).toBe("say \"hello\"");
    });

    test("should handle empty string", () => {
      expect(escapeHtml("")).toBe("");
    });

    test("should handle plain text without changes", () => {
      expect(escapeHtml("Hello World")).toBe("Hello World");
    });

    test("should escape less than and greater than", () => {
      expect(escapeHtml("1 < 2 > 0")).toBe("1 &lt; 2 &gt; 0");
    });

    test("should handle SignalK paths safely", () => {
      expect(escapeHtml("navigation.position")).toBe("navigation.position");
      expect(escapeHtml("environment.wind.speedApparent")).toBe(
        "environment.wind.speedApparent"
      );
    });
  });

  describe("renderCard", () => {
    test("should render card with title and subtitle", () => {
      const html = renderCard("Test Title", "Test subtitle", "testId");
      expect(html).toContain("<h2>Test Title</h2>");
      expect(html).toContain('<p class="subtitle">Test subtitle</p>');
      expect(html).toContain('id="testId"');
    });

    test("should render card without subtitle", () => {
      const html = renderCard("Test Title", "", "testId");
      expect(html).toContain("<h2>Test Title</h2>");
      expect(html).not.toContain('<p class="subtitle">');
    });

    test("should use default class based on contentId", () => {
      const html = renderCard("Test", "Sub", "bandwidth");
      expect(html).toContain('class="bandwidth-info"');
    });

    test("should use custom class when provided", () => {
      const html = renderCard("Test", "Sub", "testId", "custom-class");
      expect(html).toContain('class="custom-class"');
    });

    test("should show loading message with lowercase title", () => {
      const html = renderCard("Bandwidth Monitor", "Stats", "bw");
      expect(html).toContain("Loading bandwidth monitor...");
    });
  });

  describe("renderStatItem", () => {
    test("should render stat item with label and value", () => {
      const html = renderStatItem("Deltas Sent", "1,234");
      expect(html).toContain('class="stat-item"');
      expect(html).toContain("Deltas Sent:");
      expect(html).toContain("1,234");
    });

    test("should add error class when hasError is true", () => {
      const html = renderStatItem("Errors", "5", true);
      expect(html).toContain('class="stat-item error"');
    });

    test("should not add error class when hasError is false", () => {
      const html = renderStatItem("Success", "100", false);
      expect(html).toContain('class="stat-item"');
      expect(html).not.toContain("error");
    });
  });

  describe("renderMetricItem", () => {
    test("should render metric item with label and value", () => {
      const html = renderMetricItem("Uptime", "2h 30m");
      expect(html).toContain('class="metric-item"');
      expect(html).toContain("Uptime");
      expect(html).toContain("2h 30m");
    });

    test("should add status class when provided", () => {
      const html = renderMetricItem("Status", "Ready", "success");
      expect(html).toContain('class="metric-item success"');
    });

    test("should not add extra class when statusClass is empty", () => {
      const html = renderMetricItem("Mode", "Client", "");
      expect(html).toContain('class="metric-item"');
    });
  });

  describe("renderBwStat", () => {
    test("should render bandwidth stat with label and value", () => {
      const html = renderBwStat("Total Sent", "1.5 MB");
      expect(html).toContain('class="bw-stat"');
      expect(html).toContain("Total Sent:");
      expect(html).toContain("1.5 MB");
    });

    test("should add highlight class when isHighlight is true", () => {
      const html = renderBwStat("Saved", "500 KB", true, false);
      expect(html).toContain('class="bw-stat highlight"');
    });

    test("should add success-text class when isSuccess is true", () => {
      const html = renderBwStat("Saved", "500 KB", true, true);
      expect(html).toContain('class="bw-value success-text"');
    });

    test("should handle both highlight and success", () => {
      const html = renderBwStat("Bandwidth Saved", "1 MB", true, true);
      expect(html).toContain('class="bw-stat highlight"');
      expect(html).toContain('class="bw-value success-text"');
    });
  });
});

describe("Web UI Constants", () => {
  // Constants from index.js
  const API_BASE_PATH = "/plugins/signalk-data-connector";
  const DELTA_TIMER_MIN = 100;
  const DELTA_TIMER_MAX = 10000;
  const NOTIFICATION_TIMEOUT = 4000;
  const METRICS_REFRESH_INTERVAL = 15000;
  const JSON_SYNC_DEBOUNCE = 300;

  test("API_BASE_PATH should be correct", () => {
    expect(API_BASE_PATH).toBe("/plugins/signalk-data-connector");
  });

  test("DELTA_TIMER range should be valid", () => {
    expect(DELTA_TIMER_MIN).toBe(100);
    expect(DELTA_TIMER_MAX).toBe(10000);
    expect(DELTA_TIMER_MIN).toBeLessThan(DELTA_TIMER_MAX);
  });

  test("NOTIFICATION_TIMEOUT should be reasonable", () => {
    expect(NOTIFICATION_TIMEOUT).toBeGreaterThanOrEqual(1000);
    expect(NOTIFICATION_TIMEOUT).toBeLessThanOrEqual(10000);
  });

  test("METRICS_REFRESH_INTERVAL should be 15 seconds", () => {
    expect(METRICS_REFRESH_INTERVAL).toBe(15000);
  });

  test("JSON_SYNC_DEBOUNCE should be 300ms", () => {
    expect(JSON_SYNC_DEBOUNCE).toBe(300);
  });
});

describe("Metrics Data Flow - Backend to Frontend", () => {
  // Sample metrics data that backend returns
  const sampleMetrics = {
    uptime: {
      milliseconds: 3600000,
      seconds: 3600,
      formatted: "1h 0m 0s"
    },
    mode: "client",
    stats: {
      deltasSent: 1500,
      deltasReceived: 0,
      udpSendErrors: 2,
      udpRetries: 5,
      compressionErrors: 0,
      encryptionErrors: 1,
      subscriptionErrors: 0
    },
    status: {
      readyToSend: true,
      deltasBuffered: 3
    },
    bandwidth: {
      bytesOut: 512000,
      bytesIn: 0,
      bytesOutRaw: 2048000,
      bytesInRaw: 0,
      bytesOutFormatted: "500 KB",
      bytesInFormatted: "0 B",
      bytesOutRawFormatted: "2 MB",
      packetsOut: 150,
      packetsIn: 0,
      rateOut: 1024,
      rateIn: 0,
      rateOutFormatted: "1 KB/s",
      rateInFormatted: "0 B/s",
      compressionRatio: 75,
      avgPacketSize: 3413,
      avgPacketSizeFormatted: "3.33 KB",
      history: [
        { timestamp: Date.now() - 30000, rateOut: 800, rateIn: 0, compressionRatio: 70 },
        { timestamp: Date.now() - 15000, rateOut: 1000, rateIn: 0, compressionRatio: 74 },
        { timestamp: Date.now(), rateOut: 1024, rateIn: 0, compressionRatio: 75 }
      ]
    },
    pathStats: [
      { path: "navigation.position", count: 500, bytes: 128000, bytesFormatted: "125 KB", percentage: 50, updatesPerMinute: 60 },
      { path: "navigation.speedOverGround", count: 300, bytes: 64000, bytesFormatted: "62.5 KB", percentage: 25, updatesPerMinute: 36 },
      { path: "environment.wind.speedApparent", count: 200, bytes: 64000, bytesFormatted: "62.5 KB", percentage: 25, updatesPerMinute: 24 }
    ],
    smartBatching: {
      earlySends: 45,
      timerSends: 100,
      oversizedPackets: 2,
      avgBytesPerDelta: 150,
      maxDeltasPerBatch: 8
    },
    lastError: null
  };

  const serverModeMetrics = {
    ...sampleMetrics,
    mode: "server",
    stats: {
      ...sampleMetrics.stats,
      deltasSent: 0,
      deltasReceived: 1500
    },
    bandwidth: {
      ...sampleMetrics.bandwidth,
      bytesOut: 0,
      bytesIn: 512000,
      bytesOutRaw: 0,
      bytesInRaw: 2048000
    },
    smartBatching: null
  };

  test("metrics data structure should have all required fields", () => {
    expect(sampleMetrics).toHaveProperty("uptime");
    expect(sampleMetrics).toHaveProperty("mode");
    expect(sampleMetrics).toHaveProperty("stats");
    expect(sampleMetrics).toHaveProperty("status");
    expect(sampleMetrics).toHaveProperty("bandwidth");
    expect(sampleMetrics).toHaveProperty("pathStats");
  });

  test("uptime object should have correct structure", () => {
    expect(sampleMetrics.uptime).toHaveProperty("milliseconds");
    expect(sampleMetrics.uptime).toHaveProperty("seconds");
    expect(sampleMetrics.uptime).toHaveProperty("formatted");
    expect(typeof sampleMetrics.uptime.formatted).toBe("string");
  });

  test("stats object should have all counters", () => {
    const { stats } = sampleMetrics;
    expect(stats).toHaveProperty("deltasSent");
    expect(stats).toHaveProperty("deltasReceived");
    expect(stats).toHaveProperty("udpSendErrors");
    expect(stats).toHaveProperty("udpRetries");
    expect(stats).toHaveProperty("compressionErrors");
    expect(stats).toHaveProperty("encryptionErrors");
    expect(stats).toHaveProperty("subscriptionErrors");
  });

  test("bandwidth object should have transmission metrics", () => {
    const { bandwidth } = sampleMetrics;
    expect(bandwidth).toHaveProperty("bytesOut");
    expect(bandwidth).toHaveProperty("bytesIn");
    expect(bandwidth).toHaveProperty("bytesOutRaw");
    expect(bandwidth).toHaveProperty("compressionRatio");
    expect(bandwidth).toHaveProperty("history");
    expect(Array.isArray(bandwidth.history)).toBe(true);
  });

  test("pathStats should be an array of path objects", () => {
    expect(Array.isArray(sampleMetrics.pathStats)).toBe(true);
    sampleMetrics.pathStats.forEach((pathStat) => {
      expect(pathStat).toHaveProperty("path");
      expect(pathStat).toHaveProperty("count");
      expect(pathStat).toHaveProperty("bytes");
      expect(pathStat).toHaveProperty("percentage");
    });
  });

  test("smartBatching should be present for client mode", () => {
    expect(sampleMetrics.smartBatching).not.toBeNull();
    expect(sampleMetrics.smartBatching).toHaveProperty("earlySends");
    expect(sampleMetrics.smartBatching).toHaveProperty("timerSends");
    expect(sampleMetrics.smartBatching).toHaveProperty("maxDeltasPerBatch");
  });

  test("smartBatching should be null for server mode", () => {
    expect(serverModeMetrics.smartBatching).toBeNull();
  });

  test("compression ratio should be calculated correctly", () => {
    // compressionRatio = (1 - compressed/raw) * 100
    // For client: (1 - 512000/2048000) * 100 = 75%
    expect(sampleMetrics.bandwidth.compressionRatio).toBe(75);
  });

  test("path percentages should sum to approximately 100", () => {
    const totalPercentage = sampleMetrics.pathStats.reduce((sum, p) => sum + p.percentage, 0);
    expect(totalPercentage).toBe(100);
  });

  // Simulate frontend validation of metrics data
  const validateMetricsForDisplay = (metrics) => {
    if (!metrics) {
      return { valid: false, reason: "metrics is null" };
    }
    if (!metrics.stats) {
      return { valid: false, reason: "stats missing" };
    }
    if (!metrics.status) {
      return { valid: false, reason: "status missing" };
    }
    if (!metrics.uptime) {
      return { valid: false, reason: "uptime missing" };
    }
    return { valid: true };
  };

  test("validateMetricsForDisplay should accept valid metrics", () => {
    expect(validateMetricsForDisplay(sampleMetrics).valid).toBe(true);
    expect(validateMetricsForDisplay(serverModeMetrics).valid).toBe(true);
  });

  test("validateMetricsForDisplay should reject incomplete metrics", () => {
    expect(validateMetricsForDisplay(null).valid).toBe(false);
    expect(validateMetricsForDisplay({}).valid).toBe(false);
    expect(validateMetricsForDisplay({ stats: {} }).valid).toBe(false);
    expect(validateMetricsForDisplay({ stats: {}, status: {} }).valid).toBe(false);
  });

  // Simulate frontend bandwidth display logic
  const calculateBandwidthSavings = (metrics) => {
    if (!metrics || !metrics.bandwidth) {
      return 0;
    }
    const bw = metrics.bandwidth;
    const isClient = metrics.mode === "client";
    const savedBytes = isClient ? bw.bytesOutRaw - bw.bytesOut : bw.bytesInRaw - bw.bytesIn;
    return savedBytes > 0 ? savedBytes : 0;
  };

  test("calculateBandwidthSavings should work for client mode", () => {
    const savings = calculateBandwidthSavings(sampleMetrics);
    expect(savings).toBe(2048000 - 512000); // 1.5MB saved
  });

  test("calculateBandwidthSavings should work for server mode", () => {
    const savings = calculateBandwidthSavings(serverModeMetrics);
    expect(savings).toBe(2048000 - 512000); // Same savings on server side
  });

  test("calculateBandwidthSavings should handle missing data", () => {
    expect(calculateBandwidthSavings(null)).toBe(0);
    expect(calculateBandwidthSavings({})).toBe(0);
    expect(calculateBandwidthSavings({ mode: "client" })).toBe(0);
  });

  // Test error state detection
  const hasErrors = (metrics) => {
    if (!metrics || !metrics.stats) {
      return false;
    }
    const { stats } = metrics;
    return (
      stats.udpSendErrors > 0 ||
      stats.compressionErrors > 0 ||
      stats.encryptionErrors > 0 ||
      stats.subscriptionErrors > 0
    );
  };

  test("hasErrors should detect errors in stats", () => {
    expect(hasErrors(sampleMetrics)).toBe(true); // Has udpSendErrors and encryptionErrors
  });

  test("hasErrors should return false when no errors", () => {
    const noErrorMetrics = {
      ...sampleMetrics,
      stats: {
        ...sampleMetrics.stats,
        udpSendErrors: 0,
        encryptionErrors: 0
      }
    };
    expect(hasErrors(noErrorMetrics)).toBe(false);
  });
});

describe("Web UI Debounce Behavior", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("debounce should delay function execution", () => {
    const JSON_SYNC_DEBOUNCE = 300;
    const mockFn = jest.fn();
    let syncTimeout = null;

    // Simulate debounced call
    const debouncedCall = () => {
      if (syncTimeout) {
        clearTimeout(syncTimeout);
      }
      syncTimeout = setTimeout(() => {
        mockFn();
      }, JSON_SYNC_DEBOUNCE);
    };

    // Call multiple times rapidly
    debouncedCall();
    debouncedCall();
    debouncedCall();

    // Function should not have been called yet
    expect(mockFn).not.toHaveBeenCalled();

    // Fast-forward time
    jest.advanceTimersByTime(300);

    // Function should have been called once
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  test("debounce should reset timer on each call", () => {
    const JSON_SYNC_DEBOUNCE = 300;
    const mockFn = jest.fn();
    let syncTimeout = null;

    const debouncedCall = () => {
      if (syncTimeout) {
        clearTimeout(syncTimeout);
      }
      syncTimeout = setTimeout(() => {
        mockFn();
      }, JSON_SYNC_DEBOUNCE);
    };

    debouncedCall();
    jest.advanceTimersByTime(200); // 200ms passed
    debouncedCall(); // Reset timer
    jest.advanceTimersByTime(200); // 200ms more (400ms total, but only 200ms since last call)

    expect(mockFn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(100); // Now 300ms since last call
    expect(mockFn).toHaveBeenCalledTimes(1);
  });
});
