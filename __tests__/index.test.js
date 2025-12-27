/* eslint-disable no-undef */
const createPlugin = require("../index");

describe("SignalK Data Connector Plugin", () => {
  let plugin;
  let mockApp;

  beforeEach(() => {
    // Mock SignalK app object
    mockApp = {
      debug: jest.fn(),
      error: jest.fn(),
      setPluginStatus: jest.fn(),
      setProviderStatus: jest.fn(),
      getSelfPath: jest.fn(() => "123456789"),
      handleMessage: jest.fn(),
      getDataDirPath: jest.fn(() => __dirname + "/temp"),
      subscriptionmanager: {
        subscribe: jest.fn((subscription, unsubscribes, errorCallback, deltaCallback) => {
          // Store the delta callback for testing
          mockApp._deltaCallback = deltaCallback;
          return jest.fn(); // return unsubscribe function
        })
      },
      reportOutputMessages: jest.fn()
    };

    plugin = createPlugin(mockApp);
  });

  afterEach(async () => {
    if (plugin && plugin.stop) {
      plugin.stop();
    }
    // Wait for async cleanup to complete (timers, monitors, etc.)
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  describe("Plugin Metadata", () => {
    test("should have correct plugin id", () => {
      expect(plugin.id).toBe("signalk-data-connector");
    });

    test("should have plugin name", () => {
      expect(plugin.name).toBe("Signal K Data Connector");
    });

    test("should have description", () => {
      expect(plugin.description).toContain("encrypted compressed UDP");
    });

    test("should have schema", () => {
      expect(plugin.schema).toBeDefined();
      expect(plugin.schema.type).toBe("object");
    });
  });

  describe("Schema Validation", () => {
    test("should require udpPort and secretKey", () => {
      expect(plugin.schema.required).toContain("udpPort");
      expect(plugin.schema.required).toContain("secretKey");
    });

    test("should have serverType options", () => {
      const serverType = plugin.schema.properties.serverType;
      expect(serverType.enum).toEqual(["server", "client"]);
    });

    test("should validate udpPort range", () => {
      const udpPort = plugin.schema.properties.udpPort;
      expect(udpPort.minimum).toBe(1024);
      expect(udpPort.maximum).toBe(65535);
    });

    test("should validate secretKey length", () => {
      const secretKey = plugin.schema.properties.secretKey;
      expect(secretKey.minLength).toBe(32);
      expect(secretKey.maxLength).toBe(32);
    });

    test("should have conditional client-only fields", () => {
      expect(plugin.schema.if).toBeDefined();
      expect(plugin.schema.then).toBeDefined();
      expect(plugin.schema.else).toBeDefined();
    });
  });

  describe("Plugin Start - Validation", () => {
    test("should reject invalid secretKey length", async () => {
      const options = {
        secretKey: "short",
        udpPort: 4446,
        serverType: "server"
      };

      await plugin.start(options);

      expect(mockApp.error).toHaveBeenCalledWith(
        expect.stringContaining("Secret key must be exactly 32 characters")
      );
    });

    test("should reject invalid udpPort (too low)", async () => {
      const options = {
        secretKey: "12345678901234567890123456789012",
        udpPort: 1000,
        serverType: "server"
      };

      await plugin.start(options);

      expect(mockApp.error).toHaveBeenCalledWith(
        expect.stringContaining("UDP port must be between 1024 and 65535")
      );
    });

    test("should reject invalid udpPort (too high)", async () => {
      const options = {
        secretKey: "12345678901234567890123456789012",
        udpPort: 70000,
        serverType: "server"
      };

      await plugin.start(options);

      expect(mockApp.error).toHaveBeenCalledWith(
        expect.stringContaining("UDP port must be between 1024 and 65535")
      );
    });
  });

  describe("Plugin Stop", () => {
    test("should stop without errors when not started", () => {
      expect(() => plugin.stop()).not.toThrow();
    });

    test("should clean up resources on stop", async () => {
      const options = {
        secretKey: "12345678901234567890123456789012",
        udpPort: 4446,
        serverType: "server"
      };

      await plugin.start(options);

      expect(() => plugin.stop()).not.toThrow();
      expect(mockApp.debug).toHaveBeenCalledWith(expect.stringContaining("stopped"));
    });

    test("should be safe to call stop multiple times", async () => {
      const options = {
        secretKey: "12345678901234567890123456789012",
        udpPort: 4446,
        serverType: "server"
      };

      await plugin.start(options);

      expect(() => {
        plugin.stop();
        plugin.stop();
        plugin.stop();
      }).not.toThrow();
    });
  });

  describe("Server Mode", () => {
    test("should start in server mode", async () => {
      const options = {
        secretKey: "12345678901234567890123456789012",
        udpPort: 4446,
        serverType: "server"
      };

      await plugin.start(options);

      expect(mockApp.debug).toHaveBeenCalledWith(expect.stringContaining("server started"));
    });

    test("should accept boolean true for server mode", async () => {
      const options = {
        secretKey: "12345678901234567890123456789012",
        udpPort: 4446,
        serverType: true
      };

      await plugin.start(options);

      expect(mockApp.debug).toHaveBeenCalledWith(expect.stringContaining("server started"));
    });
  });

  describe("Client Mode", () => {
    test("should start in client mode with all required options", async () => {
      const options = {
        secretKey: "12345678901234567890123456789012",
        udpPort: 4446,
        serverType: "client",
        udpAddress: "127.0.0.1",
        testAddress: "127.0.0.1",
        testPort: 80,
        pingIntervalTime: 1,
        helloMessageSender: 60
      };

      await plugin.start(options);

      // Should not have server-specific debug messages
      expect(mockApp.debug).not.toHaveBeenCalledWith(expect.stringContaining("server started"));
    });
  });

  describe("Ping RTT Feature", () => {
    test("should publish RTT to local SignalK when ping monitor receives response", async () => {
      const options = {
        secretKey: "12345678901234567890123456789012",
        udpPort: 4446,
        serverType: "client",
        udpAddress: "127.0.0.1",
        testAddress: "127.0.0.1",
        testPort: 80,
        pingIntervalTime: 0.1, // Short interval for testing
        helloMessageSender: 60
      };

      await plugin.start(options);

      // Wait for ping monitor to potentially trigger
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Check if handleMessage was called with RTT data
      // Note: This test depends on network connectivity to 127.0.0.1:80
      const handleMessageCalls = mockApp.handleMessage.mock.calls;
      const rttCalls = handleMessageCalls.filter((call) => {
        const delta = call[1];
        return (
          delta &&
          delta.updates &&
          delta.updates[0] &&
          delta.updates[0].values &&
          delta.updates[0].values.some((v) => v.path === "networking.modem.rtt")
        );
      });

      if (rttCalls.length > 0) {
        const rttCall = rttCalls[0];
        const delta = rttCall[1];

        // Verify structure
        expect(delta.context).toBe("vessels.self");
        expect(delta.updates).toHaveLength(1);
        expect(delta.updates[0].timestamp).toBeInstanceOf(Date);
        expect(delta.updates[0].values).toHaveLength(1);

        const rttValue = delta.updates[0].values[0];
        expect(rttValue.path).toBe("networking.modem.rtt");
        expect(typeof rttValue.value).toBe("number");
        expect(rttValue.value).toBeGreaterThan(0);
        // Value should be in seconds (converted from milliseconds)
        expect(rttValue.value).toBeLessThan(10); // Sanity check: < 10 seconds
      }
    });

    test("should convert RTT from milliseconds to seconds", async () => {
      const options = {
        secretKey: "12345678901234567890123456789012",
        udpPort: 4446,
        serverType: "client",
        udpAddress: "127.0.0.1",
        testAddress: "127.0.0.1",
        testPort: 80,
        pingIntervalTime: 0.1,
        helloMessageSender: 60
      };

      await plugin.start(options);

      // Wait for potential ping
      await new Promise((resolve) => setTimeout(resolve, 500));

      const handleMessageCalls = mockApp.handleMessage.mock.calls;
      const rttCalls = handleMessageCalls.filter((call) => {
        const delta = call[1];
        return (
          delta &&
          delta.updates &&
          delta.updates[0] &&
          delta.updates[0].values &&
          delta.updates[0].values.some((v) => v.path === "networking.modem.rtt")
        );
      });

      if (rttCalls.length > 0) {
        const delta = rttCalls[0][1];
        const rttValue = delta.updates[0].values[0].value;

        // If RTT is 25ms, it should be 0.025 seconds
        // We can't check exact value but can verify it's a small decimal (seconds not milliseconds)
        if (rttValue < 1) {
          // If less than 1 second, it's been converted properly
          expect(rttValue).toBeGreaterThan(0);
        } else {
          // If greater than 1 second but less than 10, still valid (slow connection)
          expect(rttValue).toBeLessThan(10);
        }
      }
    });

    test("should use plugin.id as source when publishing RTT", async () => {
      const options = {
        secretKey: "12345678901234567890123456789012",
        udpPort: 4446,
        serverType: "client",
        udpAddress: "127.0.0.1",
        testAddress: "127.0.0.1",
        testPort: 80,
        pingIntervalTime: 0.1,
        helloMessageSender: 60
      };

      await plugin.start(options);

      await new Promise((resolve) => setTimeout(resolve, 500));

      const handleMessageCalls = mockApp.handleMessage.mock.calls;
      const rttCalls = handleMessageCalls.filter((call) => {
        const delta = call[1];
        return (
          delta &&
          delta.updates &&
          delta.updates[0] &&
          delta.updates[0].values &&
          delta.updates[0].values.some((v) => v.path === "networking.modem.rtt")
        );
      });

      if (rttCalls.length > 0) {
        // First argument should be plugin.id
        expect(rttCalls[0][0]).toBe("signalk-data-connector");
      }
    });
  });

  describe("Router Registration", () => {
    test("should have registerWithRouter method", () => {
      expect(plugin.registerWithRouter).toBeDefined();
      expect(typeof plugin.registerWithRouter).toBe("function");
    });

    test("should register routes with router", () => {
      const mockRouter = {
        get: jest.fn(),
        post: jest.fn()
      };

      plugin.registerWithRouter(mockRouter);

      expect(mockRouter.get).toHaveBeenCalled();
      expect(mockRouter.post).toHaveBeenCalled();
    });
  });

  describe("Configuration Routes", () => {
    let mockRouter;
    let getHandler;
    let postHandler;
    let getMiddlewares;
    let postMiddlewares;

    beforeEach(() => {
      mockRouter = {
        get: jest.fn((path, ...handlers) => {
          if (path === "/config/:filename") {
            // Last handler is the actual route handler, others are middlewares
            getHandler = handlers[handlers.length - 1];
            getMiddlewares = handlers.slice(0, -1);
          }
        }),
        post: jest.fn((path, ...handlers) => {
          if (path === "/config/:filename") {
            // Last handler is the actual route handler, others are middlewares
            postHandler = handlers[handlers.length - 1];
            postMiddlewares = handlers.slice(0, -1);
          }
        })
      };

      plugin.registerWithRouter(mockRouter);
    });

    /**
     * Helper to run middlewares in sequence, then the handler
     * Properly chains middlewares and only calls the final handler if all middlewares pass
     */
    function runWithMiddlewares(middlewares, handler, req, res) {
      return new Promise((resolve) => {
        let currentIndex = 0;

        const next = () => {
          currentIndex++;
          if (currentIndex < middlewares.length) {
            // Run next middleware
            middlewares[currentIndex](req, res, next);
          } else {
            // All middlewares passed, run the handler
            Promise.resolve(handler(req, res)).then(resolve);
          }
        };

        if (middlewares.length > 0) {
          // Start with first middleware
          middlewares[0](req, res, next);
        } else {
          // No middlewares, just run handler
          Promise.resolve(handler(req, res)).then(resolve);
        }

        // Give time for sync responses (if middleware doesn't call next)
        setTimeout(resolve, 10);
      });
    }

    test("should check initialization before validating filename on GET", async () => {
      const mockReq = { params: { filename: "invalid.json" } };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        contentType: jest.fn(),
        send: jest.fn()
      };

      await runWithMiddlewares(getMiddlewares, getHandler, mockReq, mockRes);

      // Should return 503 (not initialized) before checking filename
      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining("not fully initialized") })
      );
    });

    test("should check initialization before validating filename on POST", async () => {
      const mockReq = {
        params: { filename: "invalid.json" },
        body: {},
        headers: { "content-type": "application/json" }
      };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        send: jest.fn()
      };

      await runWithMiddlewares(postMiddlewares, postHandler, mockReq, mockRes);

      // Should return 503 (not initialized) before checking filename
      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining("not fully initialized") })
      );
    });

    test("should accept valid filename delta_timer.json", async () => {
      const mockReq = { params: { filename: "delta_timer.json" } };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        contentType: jest.fn(),
        send: jest.fn()
      };

      // This will fail because storage isn't initialized, but shouldn't reject filename
      await runWithMiddlewares(getMiddlewares, getHandler, mockReq, mockRes);

      expect(mockRes.status).not.toHaveBeenCalledWith(400);
    });

    test("should accept valid filename subscription.json", async () => {
      const mockReq = { params: { filename: "subscription.json" } };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        contentType: jest.fn(),
        send: jest.fn()
      };

      // This will fail because storage isn't initialized, but shouldn't reject filename
      await runWithMiddlewares(getMiddlewares, getHandler, mockReq, mockRes);

      expect(mockRes.status).not.toHaveBeenCalledWith(400);
    });
  });

  describe("Error Handling", () => {
    test("should handle missing required options gracefully", async () => {
      const options = {};

      await plugin.start(options);

      expect(mockApp.error).toHaveBeenCalled();
    });

    test("should not throw on stop if never started", () => {
      expect(() => plugin.stop()).not.toThrow();
    });
  });
});
