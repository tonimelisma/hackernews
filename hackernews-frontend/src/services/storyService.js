import axios from "axios";
const baseUrl =
  process.env.NODE_ENV === "production"
    ? "https://besthackernews.herokuapp.com/api/v1/"
    : "http://localhost:3000/api/v1/";

const getAll = (timespan) => {
  return timespan
    ? axios.get(baseUrl + `get?timespan=${timespan}`)
    : axios.get(baseUrl + `get`);
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
