import "./styles.css";

// Constants
const DELTA_TIMER_MIN = 100;
const DELTA_TIMER_MAX = 10000;
const NOTIFICATION_TIMEOUT = 4000;
const METRICS_REFRESH_INTERVAL = 5000; // 5 seconds

class DataConnectorConfig {
  constructor() {
    this.deltaTimerConfig = null;
    this.subscriptionConfig = null;
    this.isServerMode = false;
    this.metricsInterval = null;
    this.init();
  }

  async init() {
    try {
      await this.checkServerMode();
      if (this.isServerMode) {
        this.showServerModeUI();
        await this.loadMetrics(); // Load metrics for server mode
        this.startMetricsRefresh(); // Start auto-refresh
      } else {
        await this.loadConfigurations();
        this.setupEventListeners();
        this.updateUI();
        this.updateStatus();
        await this.loadMetrics(); // Load metrics for client mode
        this.startMetricsRefresh(); // Start auto-refresh
      }
    } catch (error) {
      console.error("Initialization error:", error);
      this.showNotification("Failed to initialize application: " + error.message, "error");
    }
  }

  async checkServerMode() {
    try {
      // Try to access the configuration API
      const response = await fetch("/plugins/signalk-data-connector/config/delta_timer.json");
      this.isServerMode = !response.ok && (response.status === 404 || response.status === 405);
    } catch (error) {
      // If fetch fails completely, assume server mode
      this.isServerMode = true;
    }
  }

  async loadConfigurations() {
    try {
      // Load delta timer configuration
      const deltaResponse = await fetch("/plugins/signalk-data-connector/config/delta_timer.json");
      this.deltaTimerConfig = await deltaResponse.json();

      // Load subscription configuration
      const subResponse = await fetch("/plugins/signalk-data-connector/config/subscription.json");
      this.subscriptionConfig = await subResponse.json();
    } catch (error) {
      this.showNotification("Error loading configurations: " + error.message, "error");
    }
  }

  setupEventListeners() {
    // Delta timer save button
    document.getElementById("saveDeltaTimer").addEventListener("click", () => {
      this.saveDeltaTimer();
    });

    // Subscription save button
    document.getElementById("saveSubscription").addEventListener("click", () => {
      this.saveSubscription();
    });

    // Add path button
    document.getElementById("addPath").addEventListener("click", () => {
      this.addPathItem();
    });

    // JSON editor sync
    document.getElementById("subscriptionJson").addEventListener("input", () => {
      this.syncFromJson();
    });

    // Context input change
    document.getElementById("context").addEventListener("input", () => {
      this.updateJsonFromForm();
    });
  }

  updateUI() {
    // Update delta timer input
    if (this.deltaTimerConfig && this.deltaTimerConfig.deltaTimer) {
      document.getElementById("deltaTimer").value = this.deltaTimerConfig.deltaTimer;
    }

    // Update subscription configuration
    if (this.subscriptionConfig) {
      document.getElementById("context").value = this.subscriptionConfig.context || "*";

      // Clear existing paths
      document.getElementById("pathsList").innerHTML = "";

      // Add subscription paths
      if (this.subscriptionConfig.subscribe && Array.isArray(this.subscriptionConfig.subscribe)) {
        this.subscriptionConfig.subscribe.forEach((sub) => {
          this.addPathItem(sub.path);
        });
      }

      // Update JSON editor
      document.getElementById("subscriptionJson").value = JSON.stringify(
        this.subscriptionConfig,
        null,
        2
      );
    }
  }

  addPathItem(path = "") {
    const pathsList = document.getElementById("pathsList");
    const pathItem = document.createElement("div");
    pathItem.className = "path-item";

    // Create elements safely to prevent XSS
    const input = document.createElement("input");
    input.type = "text";
    input.value = path; // Safe: value property is automatically escaped
    input.placeholder = "navigation.position";
    input.className = "path-input";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-danger";
    button.textContent = "Remove";

    // Add event listeners
    input.addEventListener("input", () => {
      this.updateJsonFromForm();
    });

    button.addEventListener("click", () => {
      pathItem.remove();
      this.updateJsonFromForm();
    });

    pathItem.appendChild(input);
    pathItem.appendChild(button);
    pathsList.appendChild(pathItem);
    this.updateJsonFromForm();
  }

  updateJsonFromForm() {
    const context = document.getElementById("context").value || "*";
    const pathInputs = document.querySelectorAll(".path-input");
    const subscribe = Array.from(pathInputs)
      .map((input) => ({ path: input.value }))
      .filter((sub) => sub.path.trim() !== "");

    const config = {
      context: context,
      subscribe: subscribe
    };

    document.getElementById("subscriptionJson").value = JSON.stringify(config, null, 2);
  }

  syncFromJson() {
    try {
      const jsonText = document.getElementById("subscriptionJson").value;
      const config = JSON.parse(jsonText);

      // Update context
      document.getElementById("context").value = config.context || "*";

      // Update paths
      const pathsList = document.getElementById("pathsList");
      pathsList.innerHTML = "";

      if (config.subscribe && Array.isArray(config.subscribe)) {
        config.subscribe.forEach((sub) => {
          this.addPathItem(sub.path || "");
        });
      }
    } catch (error) {
      // Invalid JSON, don't update form
      console.warn("Invalid JSON in editor:", error.message);
    }
  }

  async saveDeltaTimer() {
    const deltaTimer = parseInt(document.getElementById("deltaTimer").value);

    if (isNaN(deltaTimer) || deltaTimer < DELTA_TIMER_MIN || deltaTimer > DELTA_TIMER_MAX) {
      this.showNotification(
        `Delta timer must be between ${DELTA_TIMER_MIN} and ${DELTA_TIMER_MAX} milliseconds`,
        "error"
      );
      return;
    }

    const config = { deltaTimer: deltaTimer };

    try {
      const response = await fetch("/plugins/signalk-data-connector/config/delta_timer.json", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(config)
      });

      if (response.ok) {
        this.deltaTimerConfig = config;
        this.showNotification("Delta timer configuration saved successfully!", "success");
        this.updateStatus();
      } else {
        throw new Error("Failed to save configuration");
      }
    } catch (error) {
      this.showNotification("Error saving delta timer: " + error.message, "error");
    }
  }

  async saveSubscription() {
    try {
      const jsonText = document.getElementById("subscriptionJson").value;
      const config = JSON.parse(jsonText);

      // Validate configuration
      if (!config.context) {
        throw new Error("Context is required");
      }

      if (!config.subscribe || !Array.isArray(config.subscribe)) {
        throw new Error("Subscribe array is required");
      }

      const response = await fetch("/plugins/signalk-data-connector/config/subscription.json", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(config)
      });

      if (response.ok) {
        this.subscriptionConfig = config;
        this.showNotification("Subscription configuration saved successfully!", "success");
        this.updateStatus();
      } else {
        throw new Error("Failed to save configuration");
      }
    } catch (error) {
      this.showNotification("Error saving subscription: " + error.message, "error");
    }
  }

  async loadMetrics() {
    try {
      const response = await fetch("/plugins/signalk-data-connector/metrics");
      if (response.ok) {
        const metrics = await response.json();
        this.updateMetricsDisplay(metrics);
      }
    } catch (error) {
      console.error("Error loading metrics:", error.message);
    }
  }

  startMetricsRefresh() {
    // Clear any existing interval
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    // Refresh metrics every 5 seconds
    this.metricsInterval = setInterval(() => {
      this.loadMetrics();
    }, METRICS_REFRESH_INTERVAL);
  }

  updateMetricsDisplay(metrics) {
    const metricsDiv = document.getElementById("metrics");
    if (!metricsDiv) {
      return;
    }

    const hasErrors = metrics.stats.udpSendErrors > 0 ||
                      metrics.stats.compressionErrors > 0 ||
                      metrics.stats.encryptionErrors > 0 ||
                      metrics.stats.subscriptionErrors > 0;

    let metricsHtml = `
      <h4>📊 Performance Metrics</h4>
      <div class="metrics-grid">
        <div class="metric-item">
          <div class="metric-label">Uptime</div>
          <div class="metric-value">${metrics.uptime.formatted}</div>
        </div>
        <div class="metric-item">
          <div class="metric-label">Mode</div>
          <div class="metric-value">${metrics.mode === "server" ? "🖥️ Server" : "📱 Client"}</div>
        </div>
        <div class="metric-item ${metrics.status.readyToSend ? "success" : "error"}">
          <div class="metric-label">Status</div>
          <div class="metric-value">${metrics.status.readyToSend ? "✓ Ready" : "✗ Not Ready"}</div>
        </div>
        ${metrics.mode === "client" ? `
        <div class="metric-item">
          <div class="metric-label">Buffered Deltas</div>
          <div class="metric-value">${metrics.status.deltasBuffered}</div>
        </div>
        ` : ""}
      </div>

      <div class="metrics-stats">
        <h5>Transmission Statistics</h5>
        <div class="stats-grid">
          ${metrics.mode === "client" ? `
          <div class="stat-item">
            <span class="stat-label">Deltas Sent:</span>
            <span class="stat-value">${metrics.stats.deltasSent.toLocaleString()}</span>
          </div>
          ` : ""}
          ${metrics.mode === "server" ? `
          <div class="stat-item">
            <span class="stat-label">Deltas Received:</span>
            <span class="stat-value">${metrics.stats.deltasReceived.toLocaleString()}</span>
          </div>
          ` : ""}
          ${metrics.mode === "client" ? `
          <div class="stat-item ${metrics.stats.udpSendErrors > 0 ? "error" : ""}">
            <span class="stat-label">UDP Send Errors:</span>
            <span class="stat-value">${metrics.stats.udpSendErrors}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">UDP Retries:</span>
            <span class="stat-value">${metrics.stats.udpRetries}</span>
          </div>
          ` : ""}
          <div class="stat-item ${metrics.stats.compressionErrors > 0 ? "error" : ""}">
            <span class="stat-label">Compression Errors:</span>
            <span class="stat-value">${metrics.stats.compressionErrors}</span>
          </div>
          <div class="stat-item ${metrics.stats.encryptionErrors > 0 ? "error" : ""}">
            <span class="stat-label">Encryption Errors:</span>
            <span class="stat-value">${metrics.stats.encryptionErrors}</span>
          </div>
          ${metrics.mode === "client" ? `
          <div class="stat-item ${metrics.stats.subscriptionErrors > 0 ? "error" : ""}">
            <span class="stat-label">Subscription Errors:</span>
            <span class="stat-value">${metrics.stats.subscriptionErrors}</span>
          </div>
          ` : ""}
        </div>
      </div>
    `;

    if (metrics.lastError) {
      const timeAgo = metrics.lastError.timeAgo;
      const timeAgoStr = timeAgo < 60000
        ? `${Math.floor(timeAgo / 1000)}s ago`
        : `${Math.floor(timeAgo / 60000)}m ago`;

      metricsHtml += `
        <div class="metrics-error">
          <h5>⚠️ Last Error</h5>
          <div class="error-message">${this.escapeHtml(metrics.lastError.message)}</div>
          <div class="error-time">Occurred ${timeAgoStr}</div>
        </div>
      `;
    } else if (!hasErrors) {
      metricsHtml += `
        <div class="metrics-success">
          <div class="success-message">✓ No errors detected</div>
        </div>
      `;
    }

    metricsDiv.innerHTML = metricsHtml;
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  updateStatus() {
    const statusDiv = document.getElementById("status");
    let statusHtml = "<h4>Configuration Status</h4>";

    // Delta timer status
    if (this.deltaTimerConfig) {
      statusHtml += `
                <div class="status-item">
                    <strong>Delta Timer:</strong> ${this.deltaTimerConfig.deltaTimer}ms
                    <span class="status-indicator success">✓ Configured</span>
                </div>
            `;
    } else {
      statusHtml += `
                <div class="status-item">
                    <strong>Delta Timer:</strong> 
                    <span class="status-indicator warning">⚠ Not configured</span>
                </div>
            `;
    }

    // Subscription status
    if (this.subscriptionConfig && this.subscriptionConfig.subscribe) {
      const pathCount = this.subscriptionConfig.subscribe.length;
      statusHtml += `
                <div class="status-item">
                    <strong>Subscriptions:</strong> ${pathCount} path(s) configured
                    <span class="status-indicator success">✓ Configured</span>
                </div>
                <div class="status-details">
                    <strong>Context:</strong> ${this.subscriptionConfig.context}<br>
                    <strong>Paths:</strong> ${this.subscriptionConfig.subscribe.map((s) => s.path).join(", ")}
                </div>
            `;
    } else {
      statusHtml += `
                <div class="status-item">
                    <strong>Subscriptions:</strong> 
                    <span class="status-indicator warning">⚠ Not configured</span>
                </div>
            `;
    }

    statusDiv.innerHTML = statusHtml;
  }

  showServerModeUI() {
    const container = document.querySelector(".container");
    container.innerHTML = `
            <div class="config-section">
                <div class="card server-mode-card">
                    <div class="card-header">
                        <h2>🖥️ Server Mode Active</h2>
                        <p>This plugin is running in Server Mode</p>
                    </div>
                    <div class="card-content">
                        <div class="server-mode-info">
                            <h3>Server Mode Information</h3>
                            <p>This SignalK Data Connector instance is configured to <strong>receive encrypted data</strong> from client devices.</p>
                            
                            <div class="info-grid">
                                <div class="info-item">
                                    <h4>🔧 Configuration</h4>
                                    <p>Server mode configuration is managed through the SignalK server plugin settings. No additional webapp configuration is required.</p>
                                </div>
                                
                                <div class="info-item">
                                    <h4>📡 Network</h4>
                                    <p>The server is listening for encrypted UDP data transmissions from client devices on the configured port.</p>
                                </div>
                                
                                <div class="info-item">
                                    <h4>🔐 Security</h4>
                                    <p>All incoming data is automatically decrypted using the configured secret key and integrated into the SignalK data stream.</p>
                                </div>
                                
                                <div class="info-item">
                                    <h4>📊 Data Flow</h4>
                                    <p><strong>Client Devices → Server (This Instance) → SignalK Data Stream</strong></p>
                                </div>
                            </div>

                            <div class="server-status">
                                <h4>Current Status</h4>
                                <div class="status-indicator success">✓ Server is active and listening for client connections</div>
                            </div>

                            <div id="metrics" class="metrics-section"></div>

                            <div class="configuration-note">
                                <h4>💡 Need to Configure?</h4>
                                <p>To modify server settings (UDP port, encryption key, etc.), use the SignalK server's plugin configuration interface:</p>
                                <ol>
                                    <li>Go to SignalK Admin Panel</li>
                                    <li>Navigate to Plugin Config</li>
                                    <li>Find "Signal K Data Connector"</li>
                                    <li>Adjust settings as needed</li>
                                </ol>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
  }

  showNotification(message, type = "success") {
    const notification = document.getElementById("notification");
    notification.textContent = message;
    notification.className = `notification ${type} show`;

    setTimeout(() => {
      notification.classList.remove("show");
    }, NOTIFICATION_TIMEOUT);
  }
}

// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  window.dataConnectorConfig = new DataConnectorConfig();
});

// Clean up metrics refresh interval when page is hidden or unloaded
document.addEventListener("visibilitychange", () => {
  if (document.hidden && window.dataConnectorConfig && window.dataConnectorConfig.metricsInterval) {
    clearInterval(window.dataConnectorConfig.metricsInterval);
    window.dataConnectorConfig.metricsInterval = null;
  } else if (!document.hidden && window.dataConnectorConfig && !window.dataConnectorConfig.metricsInterval) {
    // Restart metrics refresh when page becomes visible again
    window.dataConnectorConfig.startMetricsRefresh();
  }
});

window.addEventListener("beforeunload", () => {
  if (window.dataConnectorConfig && window.dataConnectorConfig.metricsInterval) {
    clearInterval(window.dataConnectorConfig.metricsInterval);
    window.dataConnectorConfig.metricsInterval = null;
  }
});

// Export for global access
export default DataConnectorConfig;
