import axios from "axios";
import loginService from "./loginService";

vi.mock("axios", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

describe("loginService", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // Validates: HN-044
  it("login posts credentials and returns data", async () => {
    const mockResponse = { data: { username: "user" } };
    axios.post.mockResolvedValue(mockResponse);

    const result = await loginService.login({
      username: "user",
      password: "pass",
    });

    expect(axios.post).toHaveBeenCalledWith(expect.stringContaining("login"), {
      username: "user",
      password: "pass",
    });
    expect(result).toEqual({ username: "user" });
  });

  // Validates: HN-044
  it("login propagates errors", async () => {
    axios.post.mockRejectedValue(new Error("Network error"));

    await expect(
      loginService.login({ username: "user", password: "pass" })
    ).rejects.toThrow("Network error");
  });

  // Validates: HN-021
  it("logout posts and returns data", async () => {
    axios.post.mockResolvedValue({ data: { success: true } });

    const result = await loginService.logout();

    expect(axios.post).toHaveBeenCalledWith(expect.stringContaining("logout"));
    expect(result).toEqual({ success: true });
  });

  // Validates: HN-040
  it("getMe fetches current user", async () => {
    axios.get.mockResolvedValue({ data: { username: "testuser" } });

    const result = await loginService.getMe();

    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining("me"));
    expect(result).toEqual({ username: "testuser" });
  });
});
