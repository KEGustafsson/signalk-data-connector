import React, { useState, useEffect, useCallback } from "react";
import Form from "@rjsf/core";
import validator from "@rjsf/validator-ajv8";

// Base schema properties shared between server and client modes
const baseProperties = {
  serverType: {
    type: "string",
    title: "Operation Mode",
    description: "Select Server to receive data, or Client to send data",
    default: "client",
    enum: ["server", "client"],
    enumNames: ["Server Mode - Receive Data", "Client Mode - Send Data"]
  },
  udpPort: {
    type: "number",
    title: "UDP Port",
    description: "UDP port for data transmission (must match on both ends)",
    default: 4446,
    minimum: 1024,
    maximum: 65535
  },
  secretKey: {
    type: "string",
    title: "Encryption Key",
    description: "32-character secret key (must match on both ends)",
    minLength: 32,
    maxLength: 32
  },
  useMsgpack: {
    type: "boolean",
    title: "Use MessagePack",
    description: "Binary serialization for smaller payloads (must match on both ends)",
    default: false
  },
  usePathDictionary: {
    type: "boolean",
    title: "Use Path Dictionary",
    description: "Encode paths as numeric IDs for bandwidth savings (must match on both ends)",
    default: false
  }
};

// Client-only properties
const clientProperties = {
  udpAddress: {
    type: "string",
    title: "Server Address",
    description: "IP address or hostname of the SignalK server",
    default: "127.0.0.1"
  },
  helloMessageSender: {
    type: "integer",
    title: "Heartbeat Interval (seconds)",
    description: "How often to send heartbeat messages",
    default: 60,
    minimum: 10,
    maximum: 3600
  },
  testAddress: {
    type: "string",
    title: "Connectivity Test Address",
    description: "Address to ping for network testing (e.g., 8.8.8.8)",
    default: "127.0.0.1"
  },
  testPort: {
    type: "number",
    title: "Connectivity Test Port",
    description: "Port for connectivity test (80, 443, 53)",
    default: 80,
    minimum: 1,
    maximum: 65535
  },
  pingIntervalTime: {
    type: "number",
    title: "Check Interval (minutes)",
    description: "How often to test network connectivity",
    default: 1,
    minimum: 0.1,
    maximum: 60
  }
};

// Generate schema based on current mode
function getSchema(isClientMode) {
  const properties = { ...baseProperties };
  const required = ["serverType", "udpPort", "secretKey"];

  if (isClientMode) {
    // Add client-only properties
    Object.assign(properties, clientProperties);
    required.push("udpAddress", "testAddress", "testPort");
  }

  return {
    type: "object",
    title: "SignalK Data Connector",
    description: "Configure encrypted UDP data transmission between SignalK units",
    required,
    properties
  };
}

// UI Schema for field ordering and styling
const uiSchema = {
  "ui:order": [
    "serverType",
    "udpPort",
    "secretKey",
    "useMsgpack",
    "usePathDictionary",
    "udpAddress",
    "helloMessageSender",
    "testAddress",
    "testPort",
    "pingIntervalTime"
  ],
  secretKey: {
    "ui:widget": "password",
    "ui:help": "Must be exactly 32 characters long"
  },
  serverType: {
    "ui:widget": "select"
  }
};

/**
 * Custom configuration panel for SignalK Data Connector plugin
 * Uses RJSF to render a dynamic form that adapts based on serverType selection
 */
function PluginConfigurationPanel({ configuration, save }) {
  // Track form data state
  const [formData, setFormData] = useState(configuration || {});

  // Determine if we're in client mode
  const isClientMode = formData.serverType !== "server";

  // Generate schema based on current mode
  const schema = getSchema(isClientMode);

  // Update form data when configuration prop changes
  useEffect(() => {
    if (configuration) {
      setFormData(configuration);
    }
  }, [configuration]);

  // Handle form changes
  const handleChange = useCallback(({ formData: newFormData }) => {
    setFormData(newFormData);
  }, []);

  // Handle form submission
  const handleSubmit = useCallback(({ formData: submittedData }) => {
    // Clean up client-only fields when in server mode
    const cleanedData = { ...submittedData };
    if (cleanedData.serverType === "server") {
      delete cleanedData.udpAddress;
      delete cleanedData.helloMessageSender;
      delete cleanedData.testAddress;
      delete cleanedData.testPort;
      delete cleanedData.pingIntervalTime;
    }

    // Call the save function provided by SignalK
    if (save) {
      save(cleanedData);
    }
  }, [save]);

  // Handle errors
  const handleError = useCallback((errors) => {
    console.error("Form validation errors:", errors);
  }, []);

  return (
    <div className="signalk-data-connector-config">
      <Form
        schema={schema}
        uiSchema={uiSchema}
        formData={formData}
        validator={validator}
        onChange={handleChange}
        onSubmit={handleSubmit}
        onError={handleError}
        liveValidate={false}
      />
      <style>{`
        .signalk-data-connector-config {
          max-width: 600px;
          margin: 0 auto;
        }
        .signalk-data-connector-config .form-group {
          margin-bottom: 1rem;
        }
        .signalk-data-connector-config label {
          font-weight: 600;
          margin-bottom: 0.25rem;
          display: block;
        }
        .signalk-data-connector-config .help-block {
          font-size: 0.85rem;
          color: #666;
          margin-top: 0.25rem;
        }
        .signalk-data-connector-config input,
        .signalk-data-connector-config select {
          width: 100%;
          padding: 0.5rem;
          border: 1px solid #ccc;
          border-radius: 4px;
          font-size: 1rem;
        }
        .signalk-data-connector-config input[type="checkbox"] {
          width: auto;
        }
        .signalk-data-connector-config .btn-info {
          background-color: #17a2b8;
          border-color: #17a2b8;
          color: white;
          padding: 0.5rem 1rem;
          border-radius: 4px;
          cursor: pointer;
          font-size: 1rem;
        }
        .signalk-data-connector-config .btn-info:hover {
          background-color: #138496;
          border-color: #117a8b;
        }
        .signalk-data-connector-config .text-danger {
          color: #dc3545;
          font-size: 0.85rem;
        }
      `}</style>
    </div>
  );
}

export default PluginConfigurationPanel;
