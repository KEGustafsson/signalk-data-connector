/**
 * Configuration Panel Entry Point
 * This file bootstraps the React-based configuration panel for SignalK
 */
import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import PluginConfigurationPanel from "./PluginConfigurationPanel";

const API_BASE_PATH = "/plugins/signalk-data-connector";

/**
 * Wrapper component that handles API communication
 */
function ConfigPanelApp() {
  const [configuration, setConfiguration] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null);

  // Load configuration on mount
  useEffect(() => {
    async function loadConfig() {
      try {
        const response = await fetch(`${API_BASE_PATH}/plugin-config`);
        if (!response.ok) {
          throw new Error(`Failed to load configuration: ${response.statusText}`);
        }
        const data = await response.json();
        if (data.success) {
          setConfiguration(data.configuration);
        } else {
          throw new Error(data.error || "Failed to load configuration");
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadConfig();
  }, []);

  // Save configuration handler
  const handleSave = useCallback(async (newConfig) => {
    setSaveStatus({ type: "saving", message: "Saving configuration..." });

    try {
      const response = await fetch(`${API_BASE_PATH}/plugin-config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(newConfig)
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setConfiguration(newConfig);
        setSaveStatus({
          type: "success",
          message: data.message || "Configuration saved successfully!"
        });

        // Clear success message after 5 seconds
        setTimeout(() => setSaveStatus(null), 5000);
      } else {
        throw new Error(data.error || "Failed to save configuration");
      }
    } catch (err) {
      setSaveStatus({
        type: "error",
        message: `Error: ${err.message}`
      });
    }
  }, []);

  if (loading) {
    return (
      <div className="config-loading">
        <p>Loading configuration...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="config-error">
        <h3>Error Loading Configuration</h3>
        <p>{error}</p>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  return (
    <div className="config-panel-wrapper">
      {saveStatus && (
        <div className={`save-status ${saveStatus.type}`}>
          {saveStatus.message}
        </div>
      )}
      <PluginConfigurationPanel
        configuration={configuration}
        save={handleSave}
      />
      <style>{`
        .config-panel-wrapper {
          position: relative;
        }
        .config-loading,
        .config-error {
          text-align: center;
          padding: 40px;
        }
        .config-error {
          color: #dc3545;
        }
        .config-error button {
          margin-top: 10px;
          padding: 8px 16px;
          background-color: #17a2b8;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
        .save-status {
          padding: 12px 20px;
          border-radius: 4px;
          margin-bottom: 20px;
          text-align: center;
        }
        .save-status.saving {
          background-color: #fff3cd;
          color: #856404;
          border: 1px solid #ffc107;
        }
        .save-status.success {
          background-color: #d4edda;
          color: #155724;
          border: 1px solid #28a745;
        }
        .save-status.error {
          background-color: #f8d7da;
          color: #721c24;
          border: 1px solid #dc3545;
        }
      `}</style>
    </div>
  );
}

// Configuration page initialization
function initConfigPanel() {
  const container = document.getElementById("plugin-config-root");
  if (!container) {
    console.error("Config panel root element not found");
    return;
  }

  const root = createRoot(container);
  root.render(<ConfigPanelApp />);
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initConfigPanel);
} else {
  initConfigPanel();
}

// Export for module bundlers
export { PluginConfigurationPanel, ConfigPanelApp };
export default initConfigPanel;
