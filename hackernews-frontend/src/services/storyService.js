import axios from "axios";
const baseUrl = "/api/v1/";

const getAll = (timespan) => {
  return timespan
    ? axios.get(baseUrl + `stories?timespan=${timespan}`)
    : axios.get(baseUrl + `stories`);
};

const getHidden = () => {
  return axios.get(baseUrl + "hidden");
};

const addHidden = (hidden) => {
  return axios.post(baseUrl + "hidden", { hidden });
};

const storyServices = { getAll, getHidden, addHidden };

export default storyServices;
