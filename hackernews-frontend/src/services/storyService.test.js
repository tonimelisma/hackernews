import axios from "axios";
import storyService from "./storyService";

jest.mock("axios");

describe("storyService", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("getAll fetches stories with timespan", async () => {
    const mockData = { data: [{ id: 1, title: "Story" }] };
    axios.get.mockResolvedValue(mockData);

    const result = await storyService.getAll("Week");

    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining("get?timespan=Week")
    );
    expect(result).toEqual(mockData);
  });

  it("getAll fetches without timespan when not provided", async () => {
    const mockData = { data: [] };
    axios.get.mockResolvedValue(mockData);

    await storyService.getAll();

    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining("get"));
    expect(axios.get).toHaveBeenCalledWith(
      expect.not.stringContaining("timespan")
    );
  });

  it("getHidden sends auth header", async () => {
    const mockData = { data: [1, 2, 3] };
    axios.get.mockResolvedValue(mockData);

    const result = await storyService.getHidden("my-token");

    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining("hidden"),
      { headers: { Authorization: "bearer my-token" } }
    );
    expect(result).toEqual(mockData);
  });

  it("addHidden posts with auth header", async () => {
    axios.post.mockResolvedValue({ data: { hidden: 123 } });

    await storyService.addHidden(123, "my-token");

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("hidden"),
      { hidden: 123 },
      { headers: { Authorization: "bearer my-token" } }
    );
  });
});
