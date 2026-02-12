import axios from "axios";
const baseUrl = "/api/v1/";

const getAll = (timespan) => {
  return timespan
    ? axios.get(baseUrl + `stories?timespan=${timespan}`)
    : axios.get(baseUrl + `stories`);
};

const getHidden = (token) => {
  const config = { headers: { Authorization: `bearer ${token}` } };
  return axios.get(baseUrl + "hidden", config);
};

const addHidden = (hidden, token) => {
  const config = { headers: { Authorization: `bearer ${token}` } };
  return axios.post(baseUrl + "hidden", { hidden }, config);
};

const storyServices = { getAll, getHidden, addHidden };

export default storyServices;
