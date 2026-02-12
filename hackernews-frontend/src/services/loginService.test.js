import axios from "axios";
import loginService from "./loginService";

vi.mock("axios", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

describe("loginService", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("login posts credentials and returns data", async () => {
    const mockResponse = { data: { username: "user" } };
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
    expect(result).toEqual({ username: "user" });
  });

  it("login propagates errors", async () => {
    axios.post.mockRejectedValue(new Error("Network error"));

    await expect(
      loginService.login({ goto: "news", acct: "user", pw: "pass" })
    ).rejects.toThrow("Network error");
  });

  it("logout posts and returns data", async () => {
    axios.post.mockResolvedValue({ data: { success: true } });

    const result = await loginService.logout();

    expect(axios.post).toHaveBeenCalledWith(expect.stringContaining("logout"));
    expect(result).toEqual({ success: true });
  });

  it("getMe fetches current user", async () => {
    axios.get.mockResolvedValue({ data: { username: "testuser" } });

    const result = await loginService.getMe();

    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining("me"));
    expect(result).toEqual({ username: "testuser" });
  });
});
