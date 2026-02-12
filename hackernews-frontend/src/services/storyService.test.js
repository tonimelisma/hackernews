import axios from "axios";
import storyService from "./storyService";

vi.mock("axios", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

describe("storyService", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("getAll fetches stories with timespan", async () => {
    const mockData = { data: [{ id: 1, title: "Story" }] };
    axios.get.mockResolvedValue(mockData);

    const result = await storyService.getAll("Week");

    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining("stories?timespan=Week")
    );
    expect(result).toEqual(mockData);
  });

  it("getAll fetches without timespan when not provided", async () => {
    const mockData = { data: [] };
    axios.get.mockResolvedValue(mockData);

    await storyService.getAll();

    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining("stories"));
    expect(axios.get).toHaveBeenCalledWith(
      expect.not.stringContaining("timespan")
    );
  });

  it("getHidden fetches hidden stories", async () => {
    const mockData = { data: [1, 2, 3] };
    axios.get.mockResolvedValue(mockData);

    const result = await storyService.getHidden();

    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining("hidden")
    );
    expect(result).toEqual(mockData);
  });

  it("addHidden posts hidden story ID", async () => {
    axios.post.mockResolvedValue({ data: { hidden: 123 } });

    await storyService.addHidden(123);

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("hidden"),
      { hidden: 123 }
    );
  });
});
