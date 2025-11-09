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

    beforeEach(() => {
      mockRouter = {
        get: jest.fn((path, handler) => {
          if (path === "/config/:filename") {
            getHandler = handler;
          }
        }),
        post: jest.fn((path, handler) => {
          if (path === "/config/:filename") {
            postHandler = handler;
          }
        })
      };

      plugin.registerWithRouter(mockRouter);
    });

    test("should check initialization before validating filename on GET", async () => {
      const mockReq = { params: { filename: "invalid.json" } };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        contentType: jest.fn(),
        send: jest.fn()
      };

      await getHandler(mockReq, mockRes);

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

      await postHandler(mockReq, mockRes);

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
      await getHandler(mockReq, mockRes);

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
      await getHandler(mockReq, mockRes);

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
