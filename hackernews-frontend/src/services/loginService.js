import axios from "axios";
const baseUrl = "/api/v1/";

const login = async (form) => {
  const response = await axios.post(baseUrl + "login", form);
  return response.data;
};

const logout = async () => {
  const response = await axios.post(baseUrl + "logout");
  return response.data;
};

const getMe = async () => {
  const response = await axios.get(baseUrl + "me");
  return response.data;
};

const loginService = { login, logout, getMe };

export default loginService;
