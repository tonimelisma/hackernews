describe("util/config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("exports limitResults", () => {
    const config = require("../../util/config");
    expect(config.limitResults).toBe(500);
  });
});
