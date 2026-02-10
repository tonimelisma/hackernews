const { unknownEndpoint, errorHandler } = require("../../util/middleware");

describe("middleware", () => {
  describe("unknownEndpoint", () => {
    it("responds with 404 and error message", () => {
      const req = {};
      const res = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      };
      const next = jest.fn();

      unknownEndpoint(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.send).toHaveBeenCalledWith({ error: "unknown endpoint " });
    });
  });

  describe("errorHandler", () => {
    it("responds with 500 and error message, then calls next", () => {
      jest.spyOn(console, "log").mockImplementation(() => {});

      const error = new Error("test error");
      const req = {};
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      errorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: "test error" });
      expect(next).toHaveBeenCalledWith(error);

      console.log.mockRestore();
    });

    it("logs the error to console", () => {
      const consoleSpy = jest
        .spyOn(console, "log")
        .mockImplementation(() => {});

      const error = new Error("logged error");
      const req = {};
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      errorHandler(error, req, res, next);

      expect(consoleSpy).toHaveBeenCalledWith("error! ", error);

      consoleSpy.mockRestore();
    });
  });
});
