import axios from "axios";
import loginService from "./loginService";

jest.mock("axios");

describe("loginService", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("login posts credentials and returns data", async () => {
    const mockResponse = { data: { token: "abc123" } };
    axios.post.mockResolvedValue(mockResponse);

    const result = await loginService.login({
      goto: "news",
      acct: "user",
      pw: "pass",
    });

    expect(axios.post).toHaveBeenCalledWith(expect.stringContaining("login"), {
      goto: "news",
      acct: "user",
      pw: "pass",
    });
    expect(result).toEqual({ token: "abc123" });
  });

  it("login propagates errors", async () => {
    axios.post.mockRejectedValue(new Error("Network error"));

    await expect(
      loginService.login({ goto: "news", acct: "user", pw: "pass" })
    ).rejects.toThrow("Network error");
  });
});
